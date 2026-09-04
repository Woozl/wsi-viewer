/**
 * Message contract between the UI and the slide worker.
 *
 * One worker owns one slide. The core is a synchronous, stateful C ABI and its
 * reads block, so keeping it behind a worker is what allows the main thread to
 * stay responsive while tiles are decoded.
 */
import type { LevelCandidate, SeriesInfo } from '../slide';
import type { ChannelMetadata } from '../channels';
import type { DisplayRange } from '../pixels';

export interface DetectResult {
  readonly recognisedByName: boolean;
  readonly recognisedByBytes: boolean;
}

export interface OpenResult {
  readonly detection: DetectResult;
  /** Acquisition metadata for the base series' channels; empty if unrecorded. */
  readonly channels: readonly ChannelMetadata[];
  readonly series: readonly SeriesInfo[];
  /** Every (series, resolution) pair the file exposes, with its stored tiling. */
  readonly candidates: readonly LevelCandidate[];
}

/**
 * A tile is either an image the browser decoded, or interleaved float bands for
 * the shader to composite.
 */
export type TilePayload = ImageBitmap | Float32Array<ArrayBuffer>;

export type WorkerRequest =
  | { readonly id: number; readonly kind: 'detect'; readonly wasmUrl: string; readonly file: File }
  | {
      readonly id: number;
      readonly kind: 'open';
      readonly wasmUrl: string;
      readonly file: File;
      /** Sibling files to mount, keyed by path relative to the mount point. */
      readonly companions: ReadonlyMap<string, File>;
    }
  | {
      readonly id: number;
      readonly kind: 'tile';
      readonly series: number;
      readonly resolution: number;
      readonly col: number;
      readonly row: number;
      readonly tileWidth: number;
      readonly tileHeight: number;
      readonly levelWidth: number;
      readonly levelHeight: number;
      /**
       * Plane indices to read, one per band. Empty means the composited path:
       * a single decoded image rather than separate channels.
       */
      readonly planes: readonly number[];
      /** False when the level must be served by decoding a region. */
      readonly compressed: boolean;
    }
  | {
      readonly id: number;
      readonly kind: 'region';
      readonly series: number;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly id: number;
      readonly kind: 'thumbnail';
      readonly series: number;
      /** Longest edge of the result, in pixels. */
      readonly maxSize: number;
    }
  | {
      readonly id: number;
      readonly kind: 'channelRanges';
      readonly series: number;
      readonly resolution: number;
      readonly planes: readonly number[];
    }
  | { readonly id: number; readonly kind: 'close' };

export type WorkerResponse =
  | { readonly id: number; readonly ok: false; readonly error: string }
  | { readonly id: number; readonly ok: true; readonly kind: 'detect'; readonly value: DetectResult }
  | { readonly id: number; readonly ok: true; readonly kind: 'open'; readonly value: OpenResult }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: 'tile';
      readonly value: TilePayload | null;
    }
  | { readonly id: number; readonly ok: true; readonly kind: 'region'; readonly value: Uint8Array<ArrayBuffer> }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: 'thumbnail';
      readonly value: ImageBitmap | null;
    }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: 'channelRanges';
      readonly value: readonly DisplayRange[];
    }
  | { readonly id: number; readonly ok: true; readonly kind: 'close'; readonly value: null };

/** Maps a request kind to the payload its successful response carries. */
export interface ResultByKind {
  detect: DetectResult;
  open: OpenResult;
  tile: TilePayload | null;
  region: Uint8Array<ArrayBuffer>;
  thumbnail: ImageBitmap | null;
  channelRanges: readonly DisplayRange[];
  close: null;
}
