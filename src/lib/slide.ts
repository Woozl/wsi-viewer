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

export interface PyramidLevel {
  /** Series index this level is served from. */
  readonly series: number;
  readonly width: number;
  readonly height: number;
  /** Linear downsample relative to the base image; 1 at full resolution. */
  readonly downsample: number;
  readonly tiling: Tiling;
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
 * Tiles shorter than this are strip-encoded rather than tiled. Such a series
 * would need dozens of requests to paint a tiny image, so it is kept out of the
 * tile pyramid and used as the overview thumbnail instead.
 */
const MIN_TILE_HEIGHT = 64;

function aspect(info: { width: number; height: number }): number {
  return info.height === 0 ? 0 : info.width / info.height;
}

/**
 * Reconstructs the viewable pyramid.
 *
 * `tilings` must be indexed by series. Series are classified against the largest
 * series' aspect ratio: matching ones form the pyramid (or the thumbnail, if
 * they are strip-encoded), and the rest are associated images.
 */
export function buildSlideModel(
  series: readonly SeriesInfo[],
  tilings: readonly Tiling[],
): SlideModel {
  if (series.length === 0) throw new Error('slide contains no series');

  const bySize = [...series].sort((a, b) => b.width * b.height - a.width * a.height);
  const base = bySize[0];
  if (base === undefined) throw new Error('slide contains no series');
  const baseAspect = aspect(base);

  const sameShape = bySize.filter(
    (info) => baseAspect > 0 && Math.abs(aspect(info) - baseAspect) / baseAspect <= ASPECT_TOLERANCE,
  );
  const associated = bySize.filter((info) => !sameShape.includes(info));

  const levels: PyramidLevel[] = [];
  const strips: SeriesInfo[] = [];
  for (const info of sameShape) {
    const tiling = tilings[info.series];
    if (!tiling?.supported) continue;
    if (tiling.tileHeight < MIN_TILE_HEIGHT || tiling.tileWidth < MIN_TILE_HEIGHT) {
      strips.push(info);
      continue;
    }
    levels.push({
      series: info.series,
      width: info.width,
      height: info.height,
      downsample: info.width === 0 ? 1 : base.width / info.width,
      tiling,
    });
  }

  if (levels.length === 0) {
    throw new Error('no series in this slide exposes usable tiling');
  }

  // Prefer a strip-encoded small series for the overview; otherwise the
  // coarsest real level stands in.
  const smallestStrip = strips.at(-1);
  const coarsest = levels.at(-1);
  const thumbnailSeries = smallestStrip?.series ?? coarsest?.series ?? null;

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
