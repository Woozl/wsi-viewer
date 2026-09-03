import { describe, expect, it } from 'vitest';
import {
  buildSlideModel,
  levelResolutions,
  MAX_OVERZOOM,
  zoomBounds,
  type LevelCandidate,
  type SeriesInfo,
  type Tiling,
} from './slide';

function series(overrides: Partial<SeriesInfo> & { series: number; width: number; height: number }): SeriesInfo {
  return {
    seriesCount: 4,
    sizeZ: 1,
    sizeC: 3,
    sizeT: 1,
    imageCount: 1,
    pixelType: 'Uint8',
    bitsPerPixel: 8,
    dimensionOrder: 'XYCZT',
    isRgb: true,
    isInterleaved: false,
    isIndexed: false,
    isLittleEndian: true,
    resolutionCount: 1,
    thumbnail: false,
    metadata: {},
    ...overrides,
  };
}

function tiled(width: number, height: number, tile = 240): Tiling {
  return {
    supported: true,
    tileWidth: tile,
    tileHeight: tile,
    tilesAcross: Math.ceil(width / tile),
    tilesDown: Math.ceil(height / tile),
    codec: 'jpeg',
  };
}

const UNTILED: Tiling = {
  supported: false,
  tileWidth: 0,
  tileHeight: 0,
  tilesAcross: 0,
  tilesDown: 0,
  codec: 'none',
  reason: 'uncompressed strips',
};

function candidate(
  series: number,
  width: number,
  height: number,
  tiling: Tiling,
  resolution = 0,
): LevelCandidate {
  return { series, resolution, width, height, tiling };
}

/**
 * Shape of the Aperio SVS this project was developed against: Bio-Formats
 * flattens the pyramid into separate series, and one of them is strip-encoded.
 */
const APERIO = {
  series: [
    series({ series: 0, width: 25704, height: 47346 }),
    series({ series: 1, width: 416, height: 768 }),
    series({ series: 2, width: 6426, height: 11836 }),
    series({ series: 3, width: 1606, height: 2959 }),
  ],
  candidates: [
    candidate(0, 25704, 47346, tiled(25704, 47346)),
    candidate(1, 416, 768, {
      supported: true,
      tileWidth: 416,
      tileHeight: 16,
      tilesAcross: 1,
      tilesDown: 48,
      codec: 'jpeg',
    }),
    candidate(2, 6426, 11836, tiled(6426, 11836)),
    candidate(3, 1606, 2959, tiled(1606, 2959)),
  ],
};

describe('buildSlideModel', () => {
  it('reconstructs a pyramid from flattened series, largest first', () => {
    const model = buildSlideModel(APERIO.series, APERIO.candidates);

    expect(model.width).toBe(25704);
    expect(model.height).toBe(47346);
    expect(model.levels.map((level) => level.series)).toEqual([0, 2, 3, 1]);
    expect(model.levels.map((level) => Math.round(level.downsample))).toEqual([1, 4, 16, 62]);
  });

  it('serves strip-encoded levels by decoding regions rather than per-strip requests', () => {
    const model = buildSlideModel(APERIO.series, APERIO.candidates);

    const stripLevel = model.levels.find((level) => level.series === 1);
    expect(stripLevel?.compressed).toBe(false);
    expect(stripLevel?.tileWidth).toBe(512);

    const tiledLevel = model.levels.find((level) => level.series === 0);
    expect(tiledLevel?.compressed).toBe(true);
    expect(tiledLevel?.tileWidth).toBe(240);
  });

  it('treats series with a different aspect ratio as associated images', () => {
    // A label image is roughly square, unlike the tall specimen scan.
    const label = series({ series: 4, width: 600, height: 600 });
    const model = buildSlideModel(
      [...APERIO.series, label],
      [...APERIO.candidates, candidate(4, 600, 600, tiled(600, 600))],
    );

    expect(model.associated.map((info) => info.series)).toEqual([4]);
    expect(model.levels.some((level) => level.series === 4)).toBe(false);
  });

  it('still exposes a level when no compressed tiling is available at all', () => {
    const model = buildSlideModel(
      [series({ series: 0, width: 1024, height: 768 })],
      [candidate(0, 1024, 768, UNTILED)],
    );

    expect(model.levels).toHaveLength(1);
    expect(model.levels[0]?.compressed).toBe(false);
    expect(model.levels[0]?.tilesAcross).toBe(2);
    expect(model.levels[0]?.tilesDown).toBe(2);
  });

  it('builds a pyramid from resolutions within one series', () => {
    // A pyramidal OME-TIFF reports one series with several resolutions, the
    // opposite of how Aperio presents the same structure.
    const only = series({ series: 0, width: 1024, height: 768, resolutionCount: 3, seriesCount: 1 });
    const model = buildSlideModel(
      [only],
      [
        candidate(0, 1024, 768, UNTILED, 0),
        candidate(0, 512, 384, UNTILED, 1),
        candidate(0, 256, 192, UNTILED, 2),
      ],
    );

    expect(model.levels.map((level) => level.resolution)).toEqual([0, 1, 2]);
    expect(model.levels.map((level) => level.downsample)).toEqual([1, 2, 4]);
    expect(model.associated).toHaveLength(0);
  });

  it('rejects a slide with no series', () => {
    expect(() => buildSlideModel([], [])).toThrow(/no series/i);
  });
});

describe('levelResolutions', () => {
  it('returns resolutions coarsest first, as TileGrid requires', () => {
    const model = buildSlideModel(APERIO.series, APERIO.candidates);
    const resolutions = levelResolutions(model);

    expect(resolutions[0]).toBeGreaterThan(resolutions[resolutions.length - 1] ?? 0);
    expect(resolutions.at(-1)).toBe(1);
  });
});

describe('zoomBounds', () => {
  // The Aperio pyramid: 1x, 4x, 16x and a 62x thumbnail, coarsest first.
  const APERIO_RESOLUTIONS = [61.78846153846154, 16, 4, 1];

  it('allows zooming at least MAX_OVERZOOM past the finest level', () => {
    const { minResolution } = zoomBounds(APERIO_RESOLUTIONS);
    const finest = APERIO_RESOLUTIONS.at(-1) ?? 1;

    // Rounding up to a whole zoom step means the floor may go further, never
    // less far, than requested. Falling short is what made the viewer bounce.
    expect(minResolution).toBeLessThanOrEqual(finest / MAX_OVERZOOM);
  });

  it('lands the floor on a whole number of zoom steps below the coarsest level', () => {
    const { maxResolution, minResolution } = zoomBounds(APERIO_RESOLUTIONS);
    const steps = Math.log(maxResolution / minResolution) / Math.log(2);

    // OpenLayers floors this ratio, so a fractional value silently raises the
    // floor and cuts the zoom range short.
    expect(steps).toBeCloseTo(Math.round(steps), 10);
  });

  it('starts at the coarsest stored resolution', () => {
    expect(zoomBounds(APERIO_RESOLUTIONS).maxResolution).toBe(61.78846153846154);
  });

  it('handles a single-level image', () => {
    const { maxResolution, minResolution } = zoomBounds([1]);
    expect(maxResolution).toBe(1);
    expect(minResolution).toBeLessThanOrEqual(1 / MAX_OVERZOOM);
  });
});
