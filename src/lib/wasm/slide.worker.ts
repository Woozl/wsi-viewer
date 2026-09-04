/// <reference lib="webworker" />
/**
 * Worker hosting one slide's WASI core.
 *
 * The core's file reads are synchronous (WASI `fd_read` blocks), so it cannot
 * run on the main thread: `FileReaderSync` exists only in workers. Tiles are
 * decoded to `ImageBitmap` here and transferred, which keeps JPEG decoding off
 * the main thread entirely.
 */
import { SlideCore } from './core';
import {
  parseAllSeries,
  parseLevels,
  parseTiling,
  type LevelCandidate,
  type SeriesInfo,
} from '../slide';
import { bool, isRecord, parseRecord } from '../json';
import { parseChannels } from '../channels';
import {
  computeDisplayRange,
  FULL_8_BIT,
  readPlaneFloats,
  toRgba,
  type DisplayRange,
} from '../pixels';
import type { DetectResult, WorkerRequest, WorkerResponse } from './protocol';


let core: SlideCore | null = null;
/**
 * One handle per (series, resolution) pair. The reader is stateful, so a handle
 * per level avoids re-selecting series and resolution on every tile request.
 */
const handles = new Map<string, number>();
let compiled: Promise<WebAssembly.Module> | null = null;
/** Cached from `open`; needed to interpret raw pixels on the fallback path. */
let seriesInfo: readonly SeriesInfo[] = [];
let levelCandidates: readonly LevelCandidate[] = [];
/** Display range per series, computed once from a sample of the coarsest level. */
const displayRanges = new Map<number, DisplayRange>();

function compile(url: string): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compileStreaming(fetch(url));
  return compiled;
}

async function ensureCore(
  wasmUrl: string,
  file: File,
  companions: ReadonlyMap<string, File> = new Map(),
): Promise<SlideCore> {
  core ??= await SlideCore.create(await compile(wasmUrl), file, companions);
  return core;
}

function handleFor(active: SlideCore, series: number, resolution: number): number {
  const key = `${String(series)}:${String(resolution)}`;
  const existing = handles.get(key);
  if (existing !== undefined) return existing;
  const handle = active.open();
  active.setSeries(handle, series);
  // Selecting a series resets the level, so resolution is applied afterwards.
  if (resolution !== 0) active.setResolution(handle, resolution);
  handles.set(key, handle);
  return handle;
}

function closeAll(): void {
  if (core !== null) for (const handle of handles.values()) core.close(handle);
  handles.clear();
  core = null;
}

/**
 * Adobe APP14 segment declaring `transform = 0`, i.e. components are not
 * colour-transformed.
 */
const ADOBE_APP14_RGB = new Uint8Array([
  0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/** True if the stream already carries an APP14 segment. */
function hasAdobeMarker(jpeg: Uint8Array): boolean {
  // APP14 appears in the header, well before the first scan.
  const limit = Math.min(jpeg.length - 1, 4096);
  for (let i = 2; i < limit; i += 1) {
    if (jpeg[i] === 0xff && jpeg[i + 1] === 0xee) return true;
  }
  return false;
}

/**
 * Makes a stored JPEG tile safe for the browser's decoder.
 *
 * Aperio writes three-component tiles whose samples are already RGB, but omits
 * both the JFIF and Adobe markers. A decoder seeing three components and no
 * marker must assume YCbCr, so it applies a colour transform to data that needs
 * none, and the slide renders magenta and green. Declaring `transform = 0` via
 * an APP14 segment tells the decoder to leave the samples alone.
 */
function tagJpegColorSpace(jpeg: Uint8Array, colorSpace: string): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(jpeg.length);
  copy.set(jpeg);
  if (colorSpace !== 'Rgb' || hasAdobeMarker(jpeg) || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    return copy;
  }
  const tagged = new Uint8Array(jpeg.length + ADOBE_APP14_RGB.length);
  tagged.set(jpeg.subarray(0, 2), 0);
  tagged.set(ADOBE_APP14_RGB, 2);
  tagged.set(jpeg.subarray(2), 2 + ADOBE_APP14_RGB.length);
  return tagged;
}

/** Header size sampled for magic-byte detection. */
const HEADER_BYTES = 64 * 1024;

/** Longest edge read when sampling a series to choose its display range. */
const SAMPLE_EXTENT = 512;

async function detect(active: SlideCore, file: File): Promise<DetectResult> {
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const record = parseRecord(active.detectJson(file.name, header), 'detect');
  return {
    recognisedByName: bool(record, 'recognisedByName', 'detect'),
    recognisedByBytes: bool(record, 'recognisedByBytes', 'detect'),
  };
}

async function readTile(
  active: SlideCore,
  series: number,
  resolution: number,
  col: number,
  row: number,
): Promise<ImageBitmap | null> {
  const handle = handleFor(active, series, resolution);
  const record = parseRecord(
    active.compressedTileJson(handle, 0, resolution, col, row),
    'tile',
  );
  const payload = record['payload'];
  if (!isRecord(payload)) throw new Error('tile: missing payload');

  if (payload['kind'] === 'owned') {
    const ptr = payload['ptr'];
    const len = payload['len'];
    if (typeof ptr !== 'number' || typeof len !== 'number') {
      throw new Error('tile: malformed owned payload');
    }
    const bytes = active.takeOwned(ptr, len);
    const colorSpace = record['colorSpace'];
    const decodable = tagJpegColorSpace(bytes, typeof colorSpace === 'string' ? colorSpace : '');
    // `decodable` is detached from linear memory already, so the Blob is safe.
    return await createImageBitmap(new Blob([decodable]));
  }

  // FileRange and Fragmented are not produced by the readers exercised so far;
  // falling back to a decoded region keeps the viewer correct if they appear.
  return null;
}

/**
 * Display range for a series, computed once and reused.
 *
 * Every tile of a level must share one range: deriving it per tile would make
 * each tile stretch differently and put visible seams across the image.
 */
function displayRangeFor(active: SlideCore, series: number, info: SeriesInfo): DisplayRange {
  const cached = displayRanges.get(series);
  if (cached !== undefined) return cached;

  if (info.bitsPerPixel <= 8) {
    displayRanges.set(series, FULL_8_BIT);
    return FULL_8_BIT;
  }

  // Sample the coarsest level of this series, which is the cheapest read that
  // still covers the whole field of view.
  const levels = levelCandidates.filter((entry) => entry.series === series);
  const coarsest = levels.reduce<LevelCandidate | null>(
    (best, entry) => (best === null || entry.width * entry.height < best.width * best.height ? entry : best),
    null,
  );

  let range = FULL_8_BIT;
  try {
    const width = Math.min(SAMPLE_EXTENT, coarsest?.width ?? info.width);
    const height = Math.min(SAMPLE_EXTENT, coarsest?.height ?? info.height);
    const handle = handleFor(active, series, coarsest?.resolution ?? 0);
    const pixels = active.readRegion(handle, 0, 0, 0, width, height);
    range = computeDisplayRange(pixels, info, width * height);
  } catch {
    // A reader that cannot serve the sample still gets a usable, if flat, range.
    range = { min: 0, max: 65535 };
  }

  displayRanges.set(series, range);
  return range;
}

/**
 * Samples each channel to pick a sensible starting window.
 *
 * Read from a coarse level so it costs one small decode per channel: the point
 * is a usable default the moment a slide opens, which is what the "auto" button
 * in a microscopy viewer does.
 */
function channelRanges(
  active: SlideCore,
  series: number,
  resolution: number,
  planes: readonly number[],
): DisplayRange[] {
  const info = seriesInfo.find((entry) => entry.series === series);
  if (info === undefined) throw new Error(`unknown series ${String(series)}`);

  const level = levelCandidates.find(
    (entry) => entry.series === series && entry.resolution === resolution,
  );
  const width = Math.min(SAMPLE_EXTENT, level?.width ?? info.width);
  const height = Math.min(SAMPLE_EXTENT, level?.height ?? info.height);
  const handle = handleFor(active, series, resolution);

  return planes.map((plane) => {
    const pixels = active.readRegion(handle, plane, 0, 0, width, height);
    return computeDisplayRange(pixels, info, width * height);
  });
}

/**
 * Serves a tile as interleaved float bands, one per channel.
 *
 * Values are left in the file's own units: the display window is applied on the
 * GPU, so changing it must not require re-reading the slide.
 */
function readBandTile(
  active: SlideCore,
  request: {
    series: number;
    resolution: number;
    col: number;
    row: number;
    tileWidth: number;
    tileHeight: number;
    levelWidth: number;
    levelHeight: number;
    planes: readonly number[];
  },
): Float32Array<ArrayBuffer> | null {
  const info = seriesInfo.find((entry) => entry.series === request.series);
  if (info === undefined) throw new Error(`unknown series ${String(request.series)}`);

  const x = request.col * request.tileWidth;
  const y = request.row * request.tileHeight;
  if (x >= request.levelWidth || y >= request.levelHeight) return null;

  const width = Math.min(request.tileWidth, request.levelWidth - x);
  const height = Math.min(request.tileHeight, request.levelHeight - y);
  const bands = request.planes.length;
  const handle = handleFor(active, request.series, request.resolution);

  // Always full tile size: OpenLayers expects every tile to match the grid, so
  // a clipped edge tile is written into the corner and the rest left at zero.
  const out = new Float32Array(request.tileWidth * request.tileHeight * bands);
  for (const [band, plane] of request.planes.entries()) {
    const pixels = active.readRegion(handle, plane, x, y, width, height);
    const values = readPlaneFloats(pixels, info, width * height);
    for (let row = 0; row < height; row += 1) {
      const source = row * width;
      const destination = row * request.tileWidth * bands + band;
      for (let column = 0; column < width; column += 1) {
        out[destination + column * bands] = values[source + column] ?? 0;
      }
    }
  }
  return out;
}

/** Serves a tile by decoding a region, for levels with no compressed blocks. */
async function readRegionTile(
  active: SlideCore,
  request: {
    series: number;
    resolution: number;
    col: number;
    row: number;
    tileWidth: number;
    tileHeight: number;
    levelWidth: number;
    levelHeight: number;
  },
): Promise<ImageBitmap | null> {
  const info = seriesInfo.find((entry) => entry.series === request.series);
  if (info === undefined) throw new Error(`unknown series ${String(request.series)}`);

  const x = request.col * request.tileWidth;
  const y = request.row * request.tileHeight;
  if (x >= request.levelWidth || y >= request.levelHeight) return null;

  // Edge tiles are clipped to the level, then composited onto a full-size tile
  // so every tile handed to OpenLayers has the grid's dimensions.
  const width = Math.min(request.tileWidth, request.levelWidth - x);
  const height = Math.min(request.tileHeight, request.levelHeight - y);
  const handle = handleFor(active, request.series, request.resolution);
  const pixels = active.readRegion(handle, 0, x, y, width, height);

  const range = displayRangeFor(active, request.series, info);
  const image = new ImageData(toRgba(pixels, info, width, height, range), width, height);
  if (width === request.tileWidth && height === request.tileHeight) {
    return await createImageBitmap(image);
  }
  const canvas = new OffscreenCanvas(request.tileWidth, request.tileHeight);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('could not create a 2d context for an edge tile');
  context.putImageData(image, 0, 0);
  return await createImageBitmap(canvas);
}

/**
 * Decodes an entire series and scales it down for the sidebar.
 *
 * Only used for associated images — label and macro photographs — which are
 * small enough to decode whole. Pyramid levels are never read this way.
 */
async function readThumbnail(
  active: SlideCore,
  series: number,
  maxSize: number,
): Promise<ImageBitmap | null> {
  const info = seriesInfo.find((entry) => entry.series === series);
  if (info === undefined || info.width === 0 || info.height === 0) return null;

  const handle = handleFor(active, series, 0);
  const pixels = active.readRegion(handle, 0, 0, 0, info.width, info.height);
  const range = displayRangeFor(active, series, info);
  const image = new ImageData(
    toRgba(pixels, info, info.width, info.height, range),
    info.width,
    info.height,
  );

  const scale = Math.min(1, maxSize / Math.max(info.width, info.height));
  if (scale === 1) return await createImageBitmap(image);
  return await createImageBitmap(image, {
    resizeWidth: Math.max(1, Math.round(info.width * scale)),
    resizeHeight: Math.max(1, Math.round(info.height * scale)),
    resizeQuality: 'high',
  });
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data;
  void (async (): Promise<void> => {
    try {
      switch (request.kind) {
        case 'detect': {
          const active = await ensureCore(request.wasmUrl, request.file);
          reply({
            id: request.id,
            ok: true,
            kind: 'detect',
            value: await detect(active, request.file),
          });
          return;
        }
        case 'open': {
          const active = await ensureCore(request.wasmUrl, request.file, request.companions);
          // Detection reuses the already-loaded core, so the magic-byte check
          // costs one header read rather than a second worker and compile.
          const detection = await detect(active, request.file);
          const probe = active.open();
          // Channels are read from the base series; every pyramid level of a
          // given image shares them.
          const channels = parseChannels(active.channelsJson(probe));
          const series = parseAllSeries(active.allSeriesJson(probe));
          seriesInfo = series;
          displayRanges.clear();
          // A pyramid may be spread across series (Aperio) or across resolutions
          // within one series (pyramidal OME-TIFF), so both axes are enumerated.
          const candidates: LevelCandidate[] = [];
          for (const info of series) {
            active.setSeries(probe, info.series);
            for (const level of parseLevels(active.levelsJson(probe))) {
              candidates.push({
                series: info.series,
                resolution: level.level,
                width: level.width,
                height: level.height,
                tiling: parseTiling(active.levelTilingJson(probe, 0, level.level)),
              });
            }
          }
          levelCandidates = candidates;
          active.close(probe);
          reply({
            id: request.id,
            ok: true,
            kind: 'open',
            value: { detection, channels, series, candidates },
          });
          return;
        }
        case 'tile': {
          if (core === null) throw new Error('no slide is open');
          const value =
            request.planes.length > 0
              ? readBandTile(core, request)
              : request.compressed
                ? await readTile(core, request.series, request.resolution, request.col, request.row)
                : await readRegionTile(core, request);
          reply(
            { id: request.id, ok: true, kind: 'tile', value },
            value === null ? [] : [value instanceof Float32Array ? value.buffer : value],
          );
          return;
        }
        case 'region': {
          if (core === null) throw new Error('no slide is open');
          const handle = handleFor(core, request.series, 0);
          const pixels = core.readRegion(
            handle,
            0,
            request.x,
            request.y,
            request.width,
            request.height,
          );
          reply({ id: request.id, ok: true, kind: 'region', value: pixels }, [pixels.buffer]);
          return;
        }
        case 'thumbnail': {
          if (core === null) throw new Error('no slide is open');
          const bitmap = await readThumbnail(core, request.series, request.maxSize);
          reply(
            { id: request.id, ok: true, kind: 'thumbnail', value: bitmap },
            bitmap === null ? [] : [bitmap],
          );
          return;
        }
        case 'channelRanges': {
          if (core === null) throw new Error('no slide is open');
          reply({
            id: request.id,
            ok: true,
            kind: 'channelRanges',
            value: channelRanges(core, request.series, request.resolution, request.planes),
          });
          return;
        }
        case 'close': {
          closeAll();
          reply({ id: request.id, ok: true, kind: 'close', value: null });
          return;
        }
      }
    } catch (error) {
      reply({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};

function reply(response: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer });
}
