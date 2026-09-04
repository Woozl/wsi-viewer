/**
 * Main-thread handle to a slide worker.
 *
 * One client owns one worker owns one slide, so closing a slide is just
 * terminating the worker — there is no shared state to unwind.
 */
import type {
  DetectResult,
  OpenResult,
  TilePayload,
  WorkerRequest,
  WorkerResponse,
} from './protocol';
import type { DisplayRange } from '../pixels';

/** Public asset path, so it respects Vite's configured base. */
function wasmUrl(): string {
  return new URL('wasm/wsi_core.wasm', document.baseURI).href;
}

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (reason: Error) => void;
}

/** Distinguishes clients in query keys without exposing the mutable instance. */
let nextClientId = 1;

export class SlideClient {
  /**
   * Stable identity for cache keys.
   *
   * The instance itself must never appear in a TanStack Query key: keys are
   * hashed with JSON.stringify, and this object's request counter changes on
   * every call, which silently turns each request into a new query and loops.
   */
  readonly id: number = nextClientId++;
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private terminated = false;

  constructor() {
    this.worker = new Worker(new URL('./slide.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (pending === undefined) return;
      this.pending.delete(response.id);
      pending.resolve(response);
    };
    this.worker.onerror = (event: ErrorEvent): void => {
      this.failAll(new Error(event.message || 'slide worker failed'));
    };
  }

  private failAll(reason: Error): void {
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }

  private send(request: WorkerRequest): Promise<WorkerResponse> {
    if (this.terminated) return Promise.reject(new Error('slide worker has been closed'));
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private nextRequestId(): number {
    return this.nextId++;
  }

  /** Reports whether the file's magic bytes agree with its extension. */
  async detect(file: File): Promise<DetectResult> {
    const response = await this.send({ id: this.nextRequestId(), kind: 'detect', wasmUrl: wasmUrl(), file });
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== 'detect') throw new Error('unexpected response to detect');
    return response.value;
  }

  /**
   * Opens the slide and returns every series with its tiling.
   *
   * `companions` mounts sibling files alongside it, which index formats such as
   * .afi and .ndpis need in order to reach their pixel data.
   */
  async open(file: File, companions: ReadonlyMap<string, File> = new Map()): Promise<OpenResult> {
    const response = await this.send({
      id: this.nextRequestId(),
      kind: 'open',
      wasmUrl: wasmUrl(),
      file,
      companions,
    });
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== 'open') throw new Error('unexpected response to open');
    return response.value;
  }

  /** Returns a decoded tile, or null when the level cannot supply one. */
  async tile(request: {
    series: number;
    resolution: number;
    col: number;
    row: number;
    tileWidth: number;
    tileHeight: number;
    levelWidth: number;
    levelHeight: number;
    planes: readonly number[];
    compressed: boolean;
  }): Promise<TilePayload | null> {
    const response = await this.send({ id: this.nextRequestId(), kind: 'tile', ...request });
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== 'tile') throw new Error('unexpected response to tile');
    return response.value;
  }

  async region(
    series: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const response = await this.send({
      id: this.nextRequestId(),
      kind: 'region',
      series,
      x,
      y,
      width,
      height,
    });
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== 'region') throw new Error('unexpected response to region');
    return response.value;
  }

  /** Decoded preview of an associated image such as a label or macro photo. */
  async thumbnail(series: number, maxSize: number): Promise<ImageBitmap | null> {
    const response = await this.send({
      id: this.nextRequestId(),
      kind: 'thumbnail',
      series,
      maxSize,
    });
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== 'thumbnail') throw new Error('unexpected response to thumbnail');
    return response.value;
  }

  /** Starting display windows for the given planes. */
  async channelRanges(
    series: number,
    resolution: number,
    planes: readonly number[],
  ): Promise<readonly DisplayRange[]> {
    const response = await this.send({
      id: this.nextRequestId(),
      kind: 'channelRanges',
      series,
      resolution,
      planes,
    });
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== 'channelRanges') throw new Error('unexpected response to channelRanges');
    return response.value;
  }

  close(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
    this.failAll(new Error('slide worker has been closed'));
  }
}
