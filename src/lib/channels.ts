/**
 * Multichannel display model.
 *
 * Fluorescence formats store each channel as its own plane, and a viewer has to
 * decide what colour each becomes. The approach here is the one QuPath, napari,
 * OMERO and ImageJ all use: give every channel a colour and a display window,
 * then add the contributions together. There is no cleverer general answer —
 * spectral unmixing and PCA pseudocolour solve narrower problems and produce
 * images a pathologist would not recognise.
 */
import { isRecord, num, parseArray } from './json';
import type { SeriesInfo } from './slide';

export interface ChannelMetadata {
  readonly index: number;
  readonly name: string | null;
  readonly fluor: string | null;
  /** Packed RGBA from OME-XML, sign-extended. */
  readonly color: number | null;
  readonly emissionWavelength: number | null;
  readonly excitationWavelength: number | null;
}

export type Rgb = readonly [number, number, number];

export interface ChannelSettings {
  readonly index: number;
  readonly label: string;
  readonly visible: boolean;
  readonly color: Rgb;
  /** Display window in raw sample values. */
  readonly min: number;
  readonly max: number;
  readonly gamma: number;
}

/**
 * Channels beyond this are not uploaded to the GPU.
 *
 * Every channel costs a texture band and a handful of uniforms, and no one
 * reads more than a few markers at once. Highly multiplexed panels choose which
 * subset to display instead.
 */
export const MAX_DISPLAYED_CHANNELS = 8;

/** Window applied to an image whose channels are already composited into RGB. */
export interface BrightfieldAdjustment {
  readonly min: number;
  readonly max: number;
  readonly gamma: number;
}

export interface DisplaySettings {
  /** Whether channels arrive as separate planes or already composited. */
  readonly mode: 'fluorescence' | 'brightfield';
  readonly channels: readonly ChannelSettings[];
  readonly brightfield: BrightfieldAdjustment;
}

export const DEFAULT_BRIGHTFIELD: BrightfieldAdjustment = { min: 0, max: 1, gamma: 1 };

function optionalString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseChannels(text: string): ChannelMetadata[] {
  return parseArray(text, 'channels').map((entry, index) => {
    const context = `channels[${String(index)}]`;
    if (!isRecord(entry)) throw new Error(`${context}: expected an object`);
    return {
      index: num(entry, 'index', context),
      name: optionalString(entry, 'name'),
      fluor: optionalString(entry, 'fluor'),
      color: optionalNumber(entry, 'color'),
      emissionWavelength: optionalNumber(entry, 'emissionWavelength'),
      excitationWavelength: optionalNumber(entry, 'excitationWavelength'),
    };
  });
}

/**
 * Approximate visible-spectrum colour for a wavelength in nanometres.
 *
 * Follows the usual piecewise approximation of the CIE curves. It only needs to
 * be recognisable — a 488 nm channel should look green — not colorimetrically
 * exact.
 */
export function wavelengthToRgb(nm: number): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;

  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / 60;
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / 20;
  } else if (nm < 580) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = -(nm - 645) / 65;
  } else if (nm <= 780) {
    r = 1;
  } else {
    // Outside the visible range there is no meaningful colour; grey keeps the
    // channel visible rather than hiding it.
    return [1, 1, 1];
  }

  // Intensity falls off at the ends of the visible range; clamped so a channel
  // never becomes invisible.
  const falloff =
    nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1;
  const scale = Math.max(0.35, falloff);
  return [r * scale, g * scale, b * scale];
}

/**
 * Colours used when a channel carries no usable metadata.
 *
 * Ordered so the first few are the ones microscopists expect, and chosen to stay
 * distinguishable when several are composited.
 */
const FALLBACK_PALETTE: readonly Rgb[] = [
  [0, 1, 0],
  [1, 0, 1],
  [0, 0.7, 1],
  [1, 0.6, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 1],
  [1, 1, 1],
];

/**
 * Typical Stokes shift, in nanometres.
 *
 * Formats often record only the excitation wavelength, which is shorter than
 * what the eye would see. Shifting it gives a hue much closer to the emission
 * the channel actually represents: 405 nm excitation is a blue DAPI channel,
 * not violet.
 */
const STOKES_SHIFT_NM = 45;

export function defaultChannelColor(channel: ChannelMetadata, position: number): Rgb {
  // An explicit colour from the file always wins.
  if (channel.color !== null) {
    const packed = channel.color >>> 0;
    const r = (packed >>> 24) & 0xff;
    const g = (packed >>> 16) & 0xff;
    const b = (packed >>> 8) & 0xff;
    if (r + g + b > 0) return [r / 255, g / 255, b / 255];
  }

  const nm =
    channel.emissionWavelength ??
    (channel.excitationWavelength === null ? null : channel.excitationWavelength + STOKES_SHIFT_NM);
  if (nm !== null) return wavelengthToRgb(nm);

  return FALLBACK_PALETTE[position % FALLBACK_PALETTE.length] ?? [1, 1, 1];
}

export function channelLabel(channel: ChannelMetadata, position: number): string {
  return channel.name ?? channel.fluor ?? `Channel ${String(position + 1)}`;
}

/**
 * Plane index for a (z, c, t) coordinate.
 *
 * Mirrors Bio-Formats' `FormatTools.getIndex`: the dimension order names the
 * rasterisation, so "XYCZT" varies channel fastest. Reading plane 0 regardless
 * would show only the first channel of a fluorescence stack.
 */
export function planeIndex(
  dimensionOrder: string,
  sizes: { sizeZ: number; sizeC: number; sizeT: number },
  position: { z: number; c: number; t: number },
): number {
  const order = dimensionOrder.slice(2);
  const lengths: number[] = [];
  const offsets: number[] = [];

  for (const axis of order) {
    if (axis === 'Z') {
      lengths.push(Math.max(1, sizes.sizeZ));
      offsets.push(position.z);
    } else if (axis === 'C') {
      lengths.push(Math.max(1, sizes.sizeC));
      offsets.push(position.c);
    } else if (axis === 'T') {
      lengths.push(Math.max(1, sizes.sizeT));
      offsets.push(position.t);
    }
  }

  let index = 0;
  let stride = 1;
  for (let axis = 0; axis < lengths.length; axis += 1) {
    index += (offsets[axis] ?? 0) * stride;
    stride *= lengths[axis] ?? 1;
  }
  return index;
}

/** True when a series stores its channels as separate planes. */
export function isMultiplane(series: SeriesInfo): boolean {
  return !series.isRgb && series.sizeC > 1;
}

const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

export function rgbToHex([r, g, b]: Rgb): string {
  const byte = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** Parses a colour input's value; returns null rather than guessing. */
export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_PATTERN.exec(hex);
  if (match === null) return null;
  const digits = match[1];
  if (digits === undefined) return null;
  const value = Number.parseInt(digits, 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}
