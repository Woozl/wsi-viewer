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
import type { WorkerRequest, WorkerResponse } from './protocol';


let core: SlideCore | null = null;
/**
 * One handle per (series, resolution) pair. The reader is stateful, so a handle
 * per level avoids re-selecting series and resolution on every tile request.
 */
const handles = new Map<string, number>();
let compiled: Promise<WebAssembly.Module> | null = null;
/** Cached from `open`; needed to interpret raw pixels on the fallback path. */
let seriesInfo: readonly SeriesInfo[] = [];

function compile(url: string): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compileStreaming(fetch(url));
  return compiled;
}

async function ensureCore(wasmUrl: string, file: File): Promise<SlideCore> {
  core ??= await SlideCore.create(await compile(wasmUrl), file);
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
 * Expands raw pixels into RGBA.
 *
 * Readers hand back the file's own layout, so the data may be planar or
 * interleaved and may carry one or three channels. Values wider than 8 bits are
 * reduced by taking the high byte, which is enough for display but is not a
 * substitute for real windowing on high-bit-depth microscopy data.
 */
function toRgba(
  pixels: Uint8Array,
  info: SeriesInfo,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  const bytesPerSample = Math.max(1, Math.ceil(info.bitsPerPixel / 8));
  const channels = info.isRgb ? Math.min(3, info.sizeC) : 1;
  // Little-endian samples put the most significant byte last.
  const sampleOffset = info.isLittleEndian ? bytesPerSample - 1 : 0;

  const sampleAt = (channel: number, index: number): number => {
    const position = info.isInterleaved
      ? (index * channels + channel) * bytesPerSample
      : (channel * pixelCount + index) * bytesPerSample;
    return pixels[position + sampleOffset] ?? 0;
  };

  for (let index = 0; index < pixelCount; index += 1) {
    const out = index * 4;
    if (channels === 1) {
      const value = sampleAt(0, index);
      rgba[out] = value;
      rgba[out + 1] = value;
      rgba[out + 2] = value;
    } else {
      rgba[out] = sampleAt(0, index);
      rgba[out + 1] = sampleAt(1, index);
      rgba[out + 2] = sampleAt(2, index);
    }
    rgba[out + 3] = 255;
  }
  return rgba;
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

  const image = new ImageData(toRgba(pixels, info, width, height), width, height);
  if (width === request.tileWidth && height === request.tileHeight) {
    return await createImageBitmap(image);
  }
  const canvas = new OffscreenCanvas(request.tileWidth, request.tileHeight);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('could not create a 2d context for an edge tile');
  context.putImageData(image, 0, 0);
  return await createImageBitmap(canvas);
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data;
  void (async (): Promise<void> => {
    try {
      switch (request.kind) {
        case 'detect': {
          const active = await ensureCore(request.wasmUrl, request.file);
          const header = new Uint8Array(
            await request.file.slice(0, 64 * 1024).arrayBuffer(),
          );
          const record = parseRecord(active.detectJson(request.file.name, header), 'detect');
          reply({
            id: request.id,
            ok: true,
            kind: 'detect',
            value: {
              recognisedByName: bool(record, 'recognisedByName', 'detect'),
              recognisedByBytes: bool(record, 'recognisedByBytes', 'detect'),
              agree: bool(record, 'agree', 'detect'),
            },
          });
          return;
        }
        case 'open': {
          const active = await ensureCore(request.wasmUrl, request.file);
          const probe = active.open();
          const series = parseAllSeries(active.allSeriesJson(probe));
          seriesInfo = series;
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
          active.close(probe);
          reply({ id: request.id, ok: true, kind: 'open', value: { series, candidates } });
          return;
        }
        case 'tile': {
          if (core === null) throw new Error('no slide is open');
          const bitmap = request.compressed
            ? await readTile(core, request.series, request.resolution, request.col, request.row)
            : await readRegionTile(core, request);
          reply(
            { id: request.id, ok: true, kind: 'tile', value: bitmap },
            bitmap === null ? [] : [bitmap],
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
