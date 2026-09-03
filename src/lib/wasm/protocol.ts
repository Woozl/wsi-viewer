/**
 * Message contract between the UI and the slide worker.
 *
 * One worker owns one slide. The core is a synchronous, stateful C ABI and its
 * reads block, so keeping it behind a worker is what allows the main thread to
 * stay responsive while tiles are decoded.
 */
import type { SeriesInfo, Tiling } from '../slide';

export interface DetectResult {
  readonly recognisedByName: boolean;
  readonly recognisedByBytes: boolean;
  /** False only when both checks matched readers but no reader matched both. */
  readonly agree: boolean;
}

export interface OpenResult {
  readonly series: readonly SeriesInfo[];
  /** Indexed by series. */
  readonly tilings: readonly Tiling[];
}

export type WorkerRequest =
  | { readonly id: number; readonly kind: 'detect'; readonly wasmUrl: string; readonly file: File }
  | { readonly id: number; readonly kind: 'open'; readonly wasmUrl: string; readonly file: File }
  | { readonly id: number; readonly kind: 'tile'; readonly series: number; readonly col: number; readonly row: number }
  | {
      readonly id: number;
      readonly kind: 'region';
      readonly series: number;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly id: number; readonly kind: 'close' };

export type WorkerResponse =
  | { readonly id: number; readonly ok: false; readonly error: string }
  | { readonly id: number; readonly ok: true; readonly kind: 'detect'; readonly value: DetectResult }
  | { readonly id: number; readonly ok: true; readonly kind: 'open'; readonly value: OpenResult }
  | { readonly id: number; readonly ok: true; readonly kind: 'tile'; readonly value: ImageBitmap | null }
  | { readonly id: number; readonly ok: true; readonly kind: 'region'; readonly value: Uint8Array<ArrayBuffer> }
  | { readonly id: number; readonly ok: true; readonly kind: 'close'; readonly value: null };

/** Maps a request kind to the payload its successful response carries. */
export interface ResultByKind {
  detect: DetectResult;
  open: OpenResult;
  tile: ImageBitmap | null;
  region: Uint8Array<ArrayBuffer>;
  close: null;
}
