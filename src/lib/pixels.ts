/**
 * Conversion of a reader's raw samples into displayable RGBA.
 *
 * Readers hand back the file's own layout, so data may be planar or
 * interleaved, one channel or three, and 8 or 16 bits deep.
 */
import type { SeriesInfo } from './slide';

export interface DisplayRange {
  readonly min: number;
  readonly max: number;
}

/** 8-bit data already spans its display range. */
export const FULL_8_BIT: DisplayRange = { min: 0, max: 255 };

/**
 * Fraction of samples trimmed from each end when choosing a display range.
 *
 * A handful of hot pixels or a saturated speck would otherwise set the white
 * point and flatten everything else to black.
 */
const TAIL_FRACTION = 0.002;

function bytesPerSample(info: SeriesInfo): number {
  return Math.max(1, Math.ceil(info.bitsPerPixel / 8));
}

function channelCount(info: SeriesInfo): number {
  return info.isRgb ? Math.min(3, info.sizeC) : 1;
}

/**
 * Reads one sample at its full precision.
 *
 * Taking only the high byte of a 16-bit image would be far simpler, but
 * fluorescence detectors fill the low 12 bits and leave the top four empty, so
 * that renders the image almost entirely black.
 */
function sampleAt(
  pixels: Uint8Array,
  info: SeriesInfo,
  pixelCount: number,
  channel: number,
  index: number,
): number {
  const width = bytesPerSample(info);
  const channels = channelCount(info);
  const start = info.isInterleaved
    ? (index * channels + channel) * width
    : (channel * pixelCount + index) * width;

  if (width === 1) return pixels[start] ?? 0;

  // Wider samples are reduced to their most significant 16 bits, which is more
  // precision than an 8-bit display can show anyway.
  const highOffset = info.isLittleEndian ? width - 1 : 0;
  const lowOffset = info.isLittleEndian ? width - 2 : 1;
  return ((pixels[start + highOffset] ?? 0) << 8) | (pixels[start + lowOffset] ?? 0);
}

/**
 * Chooses a display range from a sample of the image.
 *
 * Scaling by the full 16-bit range would be as dark as taking the high byte, so
 * the range comes from the data itself, with the extreme tails trimmed.
 */
export function computeDisplayRange(
  pixels: Uint8Array,
  info: SeriesInfo,
  pixelCount: number,
): DisplayRange {
  if (bytesPerSample(info) === 1) return FULL_8_BIT;

  const histogram = new Uint32Array(65536);
  const channels = channelCount(info);
  let counted = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = sampleAt(pixels, info, pixelCount, channel, index);
      histogram[value] = (histogram[value] ?? 0) + 1;
      counted += 1;
    }
  }
  if (counted === 0) return { min: 0, max: 65535 };

  const cut = Math.floor(counted * TAIL_FRACTION);
  let low = 0;
  let seen = 0;
  while (low < 65535 && seen + (histogram[low] ?? 0) <= cut) {
    seen += histogram[low] ?? 0;
    low += 1;
  }
  let high = 65535;
  seen = 0;
  while (high > low && seen + (histogram[high] ?? 0) <= cut) {
    seen += histogram[high] ?? 0;
    high -= 1;
  }

  // A flat image would give a zero-width range and divide by zero downstream.
  return high > low ? { min: low, max: high } : { min: low, max: low + 1 };
}

/** Expands raw samples into RGBA, stretching `range` across the output. */
export function toRgba(
  pixels: Uint8Array,
  info: SeriesInfo,
  width: number,
  height: number,
  range: DisplayRange,
): Uint8ClampedArray<ArrayBuffer> {
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  const channels = channelCount(info);
  const span = Math.max(1, range.max - range.min);
  const scale = 255 / span;

  for (let index = 0; index < pixelCount; index += 1) {
    const out = index * 4;
    if (channels === 1) {
      const value = (sampleAt(pixels, info, pixelCount, 0, index) - range.min) * scale;
      rgba[out] = value;
      rgba[out + 1] = value;
      rgba[out + 2] = value;
    } else {
      rgba[out] = (sampleAt(pixels, info, pixelCount, 0, index) - range.min) * scale;
      rgba[out + 1] = (sampleAt(pixels, info, pixelCount, 1, index) - range.min) * scale;
      rgba[out + 2] = (sampleAt(pixels, info, pixelCount, 2, index) - range.min) * scale;
    }
    rgba[out + 3] = 255;
  }
  return rgba;
}
