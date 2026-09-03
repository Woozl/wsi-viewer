/**
 * Slide model: turns the core's flat list of series into a viewable pyramid.
 *
 * Bio-Formats exposes pyramidal slides with *flattened resolutions*, so an
 * Aperio SVS arrives as several independent series (full resolution, /4, /16, a
 * thumbnail) each reporting `resolutionCount === 1`, rather than as one series
 * with several levels. Associated images such as the label and macro photo are
 * mixed into the same list. The pyramid therefore has to be reconstructed by
 * grouping series that share the base image's aspect ratio.
 */
import { bool, num, parseArray, parseRecord, str, stringMap, isRecord } from './json';

export interface SeriesInfo {
  readonly series: number;
  readonly seriesCount: number;
  readonly width: number;
  readonly height: number;
  readonly sizeZ: number;
  readonly sizeC: number;
  readonly sizeT: number;
  readonly imageCount: number;
  readonly pixelType: string;
  readonly bitsPerPixel: number;
  readonly dimensionOrder: string;
  readonly isRgb: boolean;
  readonly isInterleaved: boolean;
  readonly isIndexed: boolean;
  readonly isLittleEndian: boolean;
  readonly resolutionCount: number;
  readonly thumbnail: boolean;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface Tiling {
  readonly supported: boolean;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly tilesAcross: number;
  readonly tilesDown: number;
  readonly codec: string;
  readonly reason?: string;
}

/** One candidate level: a (series, resolution) pair with its stored tiling. */
export interface LevelCandidate {
  readonly series: number;
  readonly resolution: number;
  readonly width: number;
  readonly height: number;
  readonly tiling: Tiling;
}

export interface PyramidLevel {
  /** Series index this level is served from. */
  readonly series: number;
  /** Resolution index within that series. */
  readonly resolution: number;
  readonly width: number;
  readonly height: number;
  /** Linear downsample relative to the base image; 1 at full resolution. */
  readonly downsample: number;
  readonly tiling: Tiling;
  /** Grid the viewer requests, which is the stored tiling when there is one. */
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly tilesAcross: number;
  readonly tilesDown: number;
  /**
   * True when tiles come back as stored compressed blocks. Otherwise the level
   * is served by decoding regions, which is slower but works for any reader.
   */
  readonly compressed: boolean;
}

export interface SlideModel {
  readonly width: number;
  readonly height: number;
  /** Full resolution first, coarsest last. */
  readonly levels: readonly PyramidLevel[];
  /** Small same-aspect series suitable for an overview map, if any. */
  readonly thumbnailSeries: number | null;
  /** Series whose shape differs from the base image: label, macro, and friends. */
  readonly associated: readonly SeriesInfo[];
  readonly series: readonly SeriesInfo[];
}

export function parseSeriesInfo(value: unknown, context: string): SeriesInfo {
  if (!isRecord(value)) throw new Error(`${context}: expected an object`);
  return {
    series: num(value, 'series', context),
    seriesCount: num(value, 'seriesCount', context),
    width: num(value, 'width', context),
    height: num(value, 'height', context),
    sizeZ: num(value, 'sizeZ', context),
    sizeC: num(value, 'sizeC', context),
    sizeT: num(value, 'sizeT', context),
    imageCount: num(value, 'imageCount', context),
    pixelType: str(value, 'pixelType', context),
    bitsPerPixel: num(value, 'bitsPerPixel', context),
    dimensionOrder: str(value, 'dimensionOrder', context),
    isRgb: bool(value, 'isRgb', context),
    isInterleaved: bool(value, 'isInterleaved', context),
    isIndexed: bool(value, 'isIndexed', context),
    isLittleEndian: bool(value, 'isLittleEndian', context),
    resolutionCount: num(value, 'resolutionCount', context),
    thumbnail: bool(value, 'thumbnail', context),
    metadata: stringMap(value, 'metadata', context),
  };
}

export function parseAllSeries(text: string): SeriesInfo[] {
  return parseArray(text, 'series list').map((entry, index) =>
    parseSeriesInfo(entry, `series[${String(index)}]`),
  );
}

export interface LevelDims {
  readonly level: number;
  readonly width: number;
  readonly height: number;
}

export function parseLevels(text: string): LevelDims[] {
  return parseArray(text, 'levels').map((entry, index) => {
    const context = `levels[${String(index)}]`;
    if (!isRecord(entry)) throw new Error(`${context}: expected an object`);
    return {
      level: num(entry, 'level', context),
      width: num(entry, 'width', context),
      height: num(entry, 'height', context),
    };
  });
}

export function parseTiling(text: string): Tiling {
  const record = parseRecord(text, 'tiling');
  if (!bool(record, 'supported', 'tiling')) {
    const reason = typeof record['reason'] === 'string' ? record['reason'] : 'not supported';
    return {
      supported: false,
      tileWidth: 0,
      tileHeight: 0,
      tilesAcross: 0,
      tilesDown: 0,
      codec: 'none',
      reason,
    };
  }
  return {
    supported: true,
    tileWidth: num(record, 'tileWidth', 'tiling'),
    tileHeight: num(record, 'tileHeight', 'tiling'),
    tilesAcross: num(record, 'tilesAcross', 'tiling'),
    tilesDown: num(record, 'tilesDown', 'tiling'),
    codec: str(record, 'codec', 'tiling'),
  };
}

/** Aspect ratios within this relative tolerance are treated as the same image. */
const ASPECT_TOLERANCE = 0.02;

/**
 * Tiles shorter than this are strip-encoded rather than tiled. Painting from
 * strips would need one request per strip, so such a level is served by decoding
 * regions on a synthetic grid instead.
 */
const MIN_TILE_HEIGHT = 64;

/** Grid used for levels served by decoding regions. */
const FALLBACK_TILE_SIZE = 512;

function aspect(info: { width: number; height: number }): number {
  return info.height === 0 ? 0 : info.width / info.height;
}

/**
 * Reconstructs the viewable pyramid from every (series, resolution) candidate.
 *
 * Formats expose pyramids in two different ways and a viewer has to cope with
 * both. Aperio SVS arrives as several single-resolution series (Bio-Formats
 * flattens resolutions), whereas a pyramidal OME-TIFF arrives as one series
 * reporting three resolutions. Flattening both into candidates and then grouping
 * by aspect ratio handles them with one rule, and keeps label and macro images —
 * which do not share the specimen's shape — out of the pyramid.
 */
export function buildSlideModel(
  series: readonly SeriesInfo[],
  candidates: readonly LevelCandidate[],
): SlideModel {
  if (series.length === 0) throw new Error('slide contains no series');
  if (candidates.length === 0) throw new Error('slide exposes no readable levels');

  const bySize = [...candidates].sort((a, b) => b.width * b.height - a.width * a.height);
  const base = bySize[0];
  if (base === undefined) throw new Error('slide exposes no readable levels');
  const baseAspect = aspect(base);

  const sameShape = bySize.filter(
    (entry) => baseAspect > 0 && Math.abs(aspect(entry) - baseAspect) / baseAspect <= ASPECT_TOLERANCE,
  );
  const pyramidSeries = new Set(sameShape.map((entry) => entry.series));
  const associated = series.filter((info) => !pyramidSeries.has(info.series));

  const levels: PyramidLevel[] = sameShape.map((entry) => {
    const usable =
      entry.tiling.supported &&
      entry.tiling.tileWidth >= MIN_TILE_HEIGHT &&
      entry.tiling.tileHeight >= MIN_TILE_HEIGHT;

    const tileWidth = usable ? entry.tiling.tileWidth : FALLBACK_TILE_SIZE;
    const tileHeight = usable ? entry.tiling.tileHeight : FALLBACK_TILE_SIZE;

    return {
      series: entry.series,
      resolution: entry.resolution,
      width: entry.width,
      height: entry.height,
      downsample: entry.width === 0 ? 1 : base.width / entry.width,
      tiling: entry.tiling,
      tileWidth,
      tileHeight,
      tilesAcross: usable ? entry.tiling.tilesAcross : Math.ceil(entry.width / tileWidth),
      tilesDown: usable ? entry.tiling.tilesDown : Math.ceil(entry.height / tileHeight),
      compressed: usable,
    };
  });

  if (levels.length === 0) {
    throw new Error('no level in this slide can be displayed');
  }

  const coarsest = levels.at(-1);
  const thumbnailSeries = coarsest?.series ?? null;

  return {
    width: base.width,
    height: base.height,
    levels,
    thumbnailSeries,
    associated,
    series,
  };
}

/**
 * OpenLayers resolutions, coarsest first, as the tile grid expects. Resolution
 * is expressed in base-image pixels per screen pixel, which equals the level's
 * downsample factor.
 */
export function levelResolutions(model: SlideModel): number[] {
  return [...model.levels].reverse().map((level) => level.downsample);
}

/**
 * How far past the finest stored level the viewer may zoom, as a linear factor.
 * At 64 one image pixel covers a 64px block — well beyond where a slide holds
 * any more detail, but enough to inspect individual pixels.
 */
export const MAX_OVERZOOM = 64;

/** Resolution ratio between adjacent zoom levels; OpenLayers' own default. */
export const ZOOM_FACTOR = 2;

export interface ZoomBounds {
  readonly maxResolution: number;
  readonly minResolution: number;
}

/**
 * Resolution limits for the map view.
 *
 * Two subtleties, both of which otherwise make the viewer spring back when the
 * user zooms in past full resolution:
 *
 * 1. These must be given as bounds, never as a `resolutions` array on the view.
 *    An array makes OpenLayers snap to exactly those values and clamp at the
 *    finest one, so 1:1 becomes a hard floor.
 * 2. OpenLayers rounds the range down to a whole number of zoom-factor steps,
 *    so an arbitrary minimum is snapped back up. Rounding the exponent up here
 *    puts the floor at or beyond the requested overzoom.
 */
export function zoomBounds(resolutions: readonly number[]): ZoomBounds {
  const coarsest = resolutions[0] ?? 1;
  const finest = resolutions.at(-1) ?? 1;
  const steps = Math.ceil(
    Math.log(coarsest / (finest / MAX_OVERZOOM)) / Math.log(ZOOM_FACTOR),
  );
  return {
    maxResolution: coarsest,
    minResolution: coarsest / ZOOM_FACTOR ** steps,
  };
}
