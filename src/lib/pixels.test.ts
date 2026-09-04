import { describe, expect, it } from 'vitest';
import { computeDisplayRange, FULL_8_BIT, toRgba } from './pixels';
import type { SeriesInfo } from './slide';

function info(overrides: Partial<SeriesInfo>): SeriesInfo {
  return {
    series: 0,
    seriesCount: 1,
    width: 2,
    height: 1,
    sizeZ: 1,
    sizeC: 1,
    sizeT: 1,
    imageCount: 1,
    pixelType: 'Uint8',
    bitsPerPixel: 8,
    dimensionOrder: 'XYCZT',
    isRgb: false,
    isInterleaved: false,
    isIndexed: false,
    isLittleEndian: true,
    resolutionCount: 1,
    thumbnail: false,
    metadata: {},
    ...overrides,
  };
}

describe('computeDisplayRange', () => {
  it('leaves already-composited 8-bit RGB alone', () => {
    // Windowing a brightfield image's channels separately would shift its
    // colour balance, and it is already scaled for display.
    expect(computeDisplayRange(new Uint8Array([0, 255]), info({ isRgb: true }), 2)).toEqual(
      FULL_8_BIT,
    );
  });

  it('windows an 8-bit fluorescence channel', () => {
    // Akoya QPTIFF stores 8-bit planes whose signal sits far below full scale;
    // at 0-255 the slide renders black.
    const pixels = new Uint8Array([2, 9, 20, 33, 47, 61, 74, 88]);
    const range = computeDisplayRange(pixels, info({ width: 8 }), pixels.length);
    expect(range.max).toBeLessThanOrEqual(88);
    expect(range.max).toBeGreaterThan(range.min);
  });

  it('finds the range actually used by 16-bit data', () => {
    // Fluorescence detectors fill the low bits: values here span 100..300 of a
    // possible 65535, which is exactly the case that renders black without this.
    const values = [100, 150, 200, 250, 300];
    const pixels = new Uint8Array(values.length * 2);
    values.forEach((value, index) => {
      pixels[index * 2] = value & 0xff;
      pixels[index * 2 + 1] = value >> 8;
    });

    const range = computeDisplayRange(pixels, info({ bitsPerPixel: 16 }), values.length);
    expect(range.min).toBeGreaterThanOrEqual(100);
    expect(range.max).toBeLessThanOrEqual(300);
  });

  it('never returns a zero-width range', () => {
    const flat = new Uint8Array([7, 0, 7, 0]);
    const range = computeDisplayRange(flat, info({ bitsPerPixel: 16 }), 2);
    expect(range.max).toBeGreaterThan(range.min);
  });
});

describe('toRgba', () => {
  it('expands greyscale to opaque RGBA', () => {
    const rgba = toRgba(new Uint8Array([0, 255]), info({}), 2, 1, FULL_8_BIT);
    expect([...rgba]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('reads planar RGB, which is the layout Aperio reports', () => {
    // Planar: all reds, then all greens, then all blues.
    const pixels = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const rgba = toRgba(pixels, info({ isRgb: true, sizeC: 3, width: 2 }), 2, 1, FULL_8_BIT);
    expect([...rgba.slice(0, 4)]).toEqual([10, 30, 50, 255]);
    expect([...rgba.slice(4, 8)]).toEqual([20, 40, 60, 255]);
  });

  it('reads interleaved RGB', () => {
    const pixels = new Uint8Array([10, 30, 50, 20, 40, 60]);
    const series = info({ isRgb: true, sizeC: 3, isInterleaved: true, width: 2 });
    const rgba = toRgba(pixels, series, 2, 1, FULL_8_BIT);
    expect([...rgba.slice(0, 4)]).toEqual([10, 30, 50, 255]);
  });

  it('stretches a narrow 16-bit range across the full output', () => {
    // Without the stretch these would all land in the bottom 1% and look black.
    const values = [100, 300];
    const pixels = new Uint8Array(4);
    values.forEach((value, index) => {
      pixels[index * 2] = value & 0xff;
      pixels[index * 2 + 1] = value >> 8;
    });

    const rgba = toRgba(pixels, info({ bitsPerPixel: 16 }), 2, 1, { min: 100, max: 300 });
    expect(rgba[0]).toBe(0);
    expect(rgba[4]).toBe(255);
  });

  it('clamps samples outside the chosen range', () => {
    const pixels = new Uint8Array([50, 0, 255, 1]);
    const rgba = toRgba(pixels, info({ bitsPerPixel: 16 }), 2, 1, { min: 100, max: 300 });
    expect(rgba[0]).toBe(0);
    expect(rgba[4]).toBe(255);
  });
});
