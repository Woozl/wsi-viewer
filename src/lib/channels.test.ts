import { describe, expect, it } from 'vitest';
import {
  channelLabel,
  hexToRgb,
  rgbToHex,
  defaultChannelColor,
  planeIndex,
  wavelengthToRgb,
  type ChannelMetadata,
} from './channels';

function channel(overrides: Partial<ChannelMetadata>): ChannelMetadata {
  return {
    index: 0,
    name: null,
    fluor: null,
    color: null,
    emissionWavelength: null,
    excitationWavelength: null,
    ...overrides,
  };
}

const dominant = ([r, g, b]: readonly [number, number, number]): string =>
  r >= g && r >= b ? 'red' : g >= b ? 'green' : 'blue';

describe('planeIndex', () => {
  const sizes = { sizeZ: 2, sizeC: 3, sizeT: 4 };

  it('varies the channel fastest for XYCZT', () => {
    expect(planeIndex('XYCZT', sizes, { z: 0, c: 0, t: 0 })).toBe(0);
    expect(planeIndex('XYCZT', sizes, { z: 0, c: 1, t: 0 })).toBe(1);
    expect(planeIndex('XYCZT', sizes, { z: 1, c: 0, t: 0 })).toBe(3);
    expect(planeIndex('XYCZT', sizes, { z: 0, c: 0, t: 1 })).toBe(6);
  });

  it('varies Z fastest for XYZCT', () => {
    expect(planeIndex('XYZCT', sizes, { z: 1, c: 0, t: 0 })).toBe(1);
    expect(planeIndex('XYZCT', sizes, { z: 0, c: 1, t: 0 })).toBe(2);
  });

  it('handles XYZTC, where the channel varies slowest', () => {
    expect(planeIndex('XYZTC', sizes, { z: 0, c: 1, t: 0 })).toBe(8);
  });

  it('treats a single-plane series as index zero', () => {
    const flat = { sizeZ: 1, sizeC: 1, sizeT: 1 };
    expect(planeIndex('XYCZT', flat, { z: 0, c: 0, t: 0 })).toBe(0);
  });
});

describe('wavelengthToRgb', () => {
  it('maps the usual fluorophore bands to recognisable hues', () => {
    expect(dominant(wavelengthToRgb(460))).toBe('blue'); // DAPI
    expect(dominant(wavelengthToRgb(520))).toBe('green'); // FITC / GFP
    expect(dominant(wavelengthToRgb(670))).toBe('red'); // Cy5
  });

  it('never returns an invisible colour at the spectrum edges', () => {
    for (const nm of [380, 400, 700, 780]) {
      const [r, g, b] = wavelengthToRgb(nm);
      expect(Math.max(r, g, b)).toBeGreaterThan(0.3);
    }
  });

  it('falls back to white outside the visible range', () => {
    expect(wavelengthToRgb(900)).toEqual([1, 1, 1]);
  });
});

describe('defaultChannelColor', () => {
  it('prefers an explicit colour recorded in the file', () => {
    // Packed RGBA: pure green.
    expect(defaultChannelColor(channel({ color: 0x00ff00ff }), 0)).toEqual([0, 1, 0]);
  });

  it('uses the emission wavelength when there is no colour', () => {
    expect(dominant(defaultChannelColor(channel({ emissionWavelength: 520 }), 0))).toBe('green');
  });

  it('shifts a bare excitation wavelength towards its emission', () => {
    // 405 nm excitation is DAPI: without the Stokes shift this reads violet
    // rather than the blue a microscopist expects.
    const [r, g, b] = defaultChannelColor(channel({ excitationWavelength: 405 }), 0);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('falls back to distinguishable palette colours', () => {
    const first = defaultChannelColor(channel({}), 0);
    const second = defaultChannelColor(channel({}), 1);
    expect(first).not.toEqual(second);
  });

  it('ignores a fully transparent black colour', () => {
    // Some writers emit 0 rather than omitting the attribute.
    const colour = defaultChannelColor(channel({ color: 0, excitationWavelength: 405 }), 0);
    expect(colour).not.toEqual([0, 0, 0]);
  });
});

describe('channelLabel', () => {
  it('prefers the recorded name, then the fluorophore', () => {
    expect(channelLabel(channel({ name: 'CH1' }), 0)).toBe('CH1');
    expect(channelLabel(channel({ fluor: 'DAPI' }), 0)).toBe('DAPI');
  });

  it('falls back to a one-based position', () => {
    expect(channelLabel(channel({}), 2)).toBe('Channel 3');
  });
});

describe('colour conversion', () => {
  it('round-trips a colour through hex', () => {
    const original = [1, 0.5, 0] as const;
    const parsed = hexToRgb(rgbToHex(original));
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    parsed.forEach((component, index) => {
      expect(component).toBeCloseTo(original[index] ?? 0, 2);
    });
  });

  it('clamps out-of-range components rather than wrapping', () => {
    expect(rgbToHex([2, -1, 0.5])).toBe('#ff0080');
  });

  it('rejects anything that is not a six-digit colour', () => {
    expect(hexToRgb('nonsense')).toBeNull();
    expect(hexToRgb('#fff')).toBeNull();
  });
});
