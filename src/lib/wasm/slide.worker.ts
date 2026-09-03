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
import { parseAllSeries, parseTiling } from '../slide';
import { bool, isRecord, parseRecord } from '../json';
import type { WorkerRequest, WorkerResponse } from './protocol';


let core: SlideCore | null = null;
/** One handle per series: the reader is stateful, and a handle per series
 *  avoids re-selecting the series on every tile request. */
const handles = new Map<number, number>();
let compiled: Promise<WebAssembly.Module> | null = null;

function compile(url: string): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compileStreaming(fetch(url));
  return compiled;
}

async function ensureCore(wasmUrl: string, file: File): Promise<SlideCore> {
  core ??= await SlideCore.create(await compile(wasmUrl), file);
  return core;
}

function handleForSeries(active: SlideCore, series: number): number {
  const existing = handles.get(series);
  if (existing !== undefined) return existing;
  const handle = active.open();
  active.setSeries(handle, series);
  handles.set(series, handle);
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
  col: number,
  row: number,
): Promise<ImageBitmap | null> {
  const handle = handleForSeries(active, series);
  const record = parseRecord(active.compressedTileJson(handle, 0, 0, col, row), 'tile');
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
          const tilings = series.map((info) => {
            active.setSeries(probe, info.series);
            return parseTiling(active.levelTilingJson(probe, 0, 0));
          });
          active.close(probe);
          reply({ id: request.id, ok: true, kind: 'open', value: { series, tilings } });
          return;
        }
        case 'tile': {
          if (core === null) throw new Error('no slide is open');
          const bitmap = await readTile(core, request.series, request.col, request.row);
          reply(
            { id: request.id, ok: true, kind: 'tile', value: bitmap },
            bitmap === null ? [] : [bitmap],
          );
          return;
        }
        case 'region': {
          if (core === null) throw new Error('no slide is open');
          const handle = handleForSeries(core, request.series);
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
