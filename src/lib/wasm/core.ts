/**
 * Typed binding to the `wsi-core` WASI module.
 *
 * The module is a plain WASI reactor rather than a wasm-bindgen bundle, so the
 * ABI is hand-written: buffers come back packed as `ptr << 32 | len` and must be
 * released with `bf_free`. Every buffer read here is copied out of linear memory
 * before any further guest call, because growing the heap detaches the backing
 * `ArrayBuffer` and would invalidate a retained view.
 */
import {
  ConsoleStdout,
  Directory,
  File as WasiFile,
  type Inode,
  OpenFile,
  PreopenDirectory,
  WASI,
  wasi,
} from '@bjorn3/browser_wasi_shim';
import { LazyFileInode } from './lazy-file';

/** Directory the slide is mounted under inside the guest. */
const MOUNT = '/slides';

/** Scratch directory the patched crate uses in place of the system temp dir. */
const TEMP_MOUNT = '/tmp';

interface CoreExports {
  readonly memory: WebAssembly.Memory;
  /** WASI reactor entry point; must run before any other export is called. */
  _initialize?: () => void;
  bf_alloc(len: number): number;
  bf_free(ptr: number, len: number): void;
  bf_last_error(): bigint;
  bf_open(pathPtr: number, pathLen: number): number;
  bf_close(handle: number): number;
  bf_metadata_json(handle: number): bigint;
  bf_all_series_json(handle: number): bigint;
  bf_levels_json(handle: number): bigint;
  bf_series_count(handle: number): number;
  bf_set_series(handle: number, series: number): number;
  bf_resolution_count(handle: number): number;
  bf_set_resolution(handle: number, level: number): number;
  bf_read_region(handle: number, plane: number, x: number, y: number, w: number, h: number): bigint;
  bf_level_tiling_json(handle: number, plane: number, level: number): bigint;
  bf_compressed_tile_json(
    handle: number,
    plane: number,
    level: number,
    col: bigint,
    row: bigint,
  ): bigint;
  bf_detect_json(
    namePtr: number,
    nameLen: number,
    headerPtr: number,
    headerLen: number,
  ): bigint;
}

const REQUIRED_FUNCTIONS = [
  'bf_alloc',
  'bf_free',
  'bf_last_error',
  'bf_open',
  'bf_close',
  'bf_metadata_json',
  'bf_all_series_json',
  'bf_levels_json',
  'bf_series_count',
  'bf_set_series',
  'bf_resolution_count',
  'bf_set_resolution',
  'bf_read_region',
  'bf_level_tiling_json',
  'bf_compressed_tile_json',
  'bf_detect_json',
] as const;

/**
 * Narrows the untyped export bag by checking it at runtime, which keeps the ABI
 * mismatch a startup error rather than an inscrutable failure at the first call.
 */
function isCoreExports(
  exports: WebAssembly.Exports,
): exports is WebAssembly.Exports & CoreExports {
  if (!(exports['memory'] instanceof WebAssembly.Memory)) return false;
  return REQUIRED_FUNCTIONS.every((name) => typeof exports[name] === 'function');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One instantiated core bound to a single slide file. */
export class SlideCore {
  private constructor(
    private readonly exports: CoreExports,
    private readonly guestPath: string,
  ) {}

  /**
   * @param companions Sibling files to mount alongside the slide, keyed by path
   * relative to the mount point. Formats such as .afi and .ndpis are only an
   * index: the pixel data lives in neighbouring files, and the reader opens them
   * by name, so they must be present in the guest filesystem too. A path may
   * contain one `/` to place a file inside a companion subdirectory.
   */
  static async create(
    module: WebAssembly.Module,
    file: File,
    companions: ReadonlyMap<string, File> = new Map(),
  ): Promise<SlideCore> {
    // The original filename is preserved: bioformats detects several formats by
    // extension, so renaming the mounted file changes which reader wins.
    const contents = new Map<string, Inode>([[file.name, new LazyFileInode(file)]]);
    const subdirectories = new Map<string, Map<string, Inode>>();
    for (const [path, companion] of companions) {
      const slash = path.indexOf('/');
      if (slash === -1) {
        if (path !== file.name) contents.set(path, new LazyFileInode(companion));
        continue;
      }
      const directory = path.slice(0, slash);
      const name = path.slice(slash + 1);
      if (directory === '' || name === '' || name.includes('/')) continue;
      let entries = subdirectories.get(directory);
      if (entries === undefined) {
        entries = new Map<string, Inode>();
        subdirectories.set(directory, entries);
      }
      entries.set(name, new LazyFileInode(companion));
    }
    for (const [name, entries] of subdirectories) {
      contents.set(name, new Directory(entries));
    }
    // Descriptors 0-2 must be stdin/stdout/stderr: WASI preopens are discovered
    // by scanning from fd 3, so a preopen placed earlier is invisible to the
    // guest and every path resolution fails with ENOENT before path_open runs.
    const fds = [
      new OpenFile(new WasiFile([])),
      ConsoleStdout.lineBuffered((line) => {
        console.warn(`[wsi-core stdout] ${line}`);
      }),
      ConsoleStdout.lineBuffered((line) => {
        console.warn(`[wsi-core stderr] ${line}`);
      }),
      new PreopenDirectory(MOUNT, contents),
      // Writable scratch space. Several readers stage bytes through a temporary
      // file because they must hand a path to another reader; the patched crate
      // points those at /tmp rather than std::env::temp_dir(), which panics on
      // wasm. Nothing here outlives the worker.
      new PreopenDirectory(TEMP_MOUNT, new Map<string, Inode>()),
    ];
    const instance = new WASI([], [], fds);
    const wasmInstance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: instance.wasiImport,
    });
    if (!isCoreExports(wasmInstance.exports)) {
      throw new Error('wsi-core module does not expose the expected ABI');
    }
    // Passing the real exports matters: `initialize` invokes `_initialize`,
    // which runs the module's static constructors. Handing over a stub with only
    // `memory` leaves the guest half-initialised.
    instance.initialize({
      exports: {
        memory: wasmInstance.exports.memory,
        ...(wasmInstance.exports._initialize === undefined
          ? {}
          : { _initialize: wasmInstance.exports._initialize }),
      },
    });
    return new SlideCore(wasmInstance.exports, `${MOUNT}/${file.name}`);
  }

  /**
   * Copies `len` bytes at `ptr` into a standalone array.
   *
   * The copy is allocated first and filled second, rather than using `.slice()`,
   * so the result is a `Uint8Array<ArrayBuffer>` and can therefore be
   * structured-cloned and transferred to the main thread.
   */
  private copyOut(ptr: number, len: number): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(len);
    copy.set(new Uint8Array(this.exports.memory.buffer, ptr, len));
    return copy;
  }

  /** Copies a packed buffer out of linear memory and frees the guest copy. */
  private take(packed: bigint): Uint8Array<ArrayBuffer> | null {
    const value = BigInt.asUintN(64, packed);
    const ptr = Number(value >> 32n);
    const len = Number(value & 0xffffffffn);
    if (ptr === 0) return null;
    const copy = this.copyOut(ptr, len);
    this.exports.bf_free(ptr, len);
    return copy;
  }

  private takeText(packed: bigint): string | null {
    const bytes = this.take(packed);
    return bytes === null ? null : decoder.decode(bytes);
  }

  private lastError(): string {
    return this.takeText(this.exports.bf_last_error()) ?? 'unknown error';
  }

  /** Copies `text` into guest memory; the caller must free the result. */
  private putText(text: string): { ptr: number; len: number } {
    const bytes = encoder.encode(text);
    const ptr = this.exports.bf_alloc(bytes.length);
    new Uint8Array(this.exports.memory.buffer, ptr, bytes.length).set(bytes);
    return { ptr, len: bytes.length };
  }

  private putBytes(bytes: Uint8Array): { ptr: number; len: number } {
    const ptr = this.exports.bf_alloc(bytes.length);
    new Uint8Array(this.exports.memory.buffer, ptr, bytes.length).set(bytes);
    return { ptr, len: bytes.length };
  }

  open(): number {
    const path = this.putText(this.guestPath);
    try {
      const handle = this.exports.bf_open(path.ptr, path.len);
      if (handle === 0) throw new Error(`could not open slide: ${this.lastError()}`);
      return handle;
    } finally {
      this.exports.bf_free(path.ptr, path.len);
    }
  }

  close(handle: number): void {
    this.exports.bf_close(handle);
  }

  seriesCount(handle: number): number {
    const count = this.exports.bf_series_count(handle);
    if (count < 0) throw new Error(`could not read series count: ${this.lastError()}`);
    return count;
  }

  setSeries(handle: number, series: number): void {
    if (this.exports.bf_set_series(handle, series) !== 0) {
      throw new Error(`could not select series ${String(series)}: ${this.lastError()}`);
    }
  }

  setResolution(handle: number, level: number): void {
    if (this.exports.bf_set_resolution(handle, level) !== 0) {
      throw new Error(`could not select level ${String(level)}: ${this.lastError()}`);
    }
  }

  metadataJson(handle: number): string {
    const text = this.takeText(this.exports.bf_metadata_json(handle));
    if (text === null) throw new Error(`could not read metadata: ${this.lastError()}`);
    return text;
  }

  allSeriesJson(handle: number): string {
    const text = this.takeText(this.exports.bf_all_series_json(handle));
    if (text === null) throw new Error(`could not read series list: ${this.lastError()}`);
    return text;
  }

  levelsJson(handle: number): string {
    const text = this.takeText(this.exports.bf_levels_json(handle));
    if (text === null) throw new Error(`could not read levels: ${this.lastError()}`);
    return text;
  }

  levelTilingJson(handle: number, plane: number, level: number): string {
    const text = this.takeText(this.exports.bf_level_tiling_json(handle, plane, level));
    if (text === null) throw new Error(`could not read tiling: ${this.lastError()}`);
    return text;
  }

  compressedTileJson(handle: number, plane: number, level: number, col: number, row: number): string {
    const text = this.takeText(
      this.exports.bf_compressed_tile_json(handle, plane, level, BigInt(col), BigInt(row)),
    );
    if (text === null) throw new Error(`could not read tile: ${this.lastError()}`);
    return text;
  }

  /** Reads owned tile bytes previously reported by `compressedTileJson`. */
  takeOwned(ptr: number, len: number): Uint8Array<ArrayBuffer> {
    const copy = this.copyOut(ptr, len);
    this.exports.bf_free(ptr, len);
    return copy;
  }

  readRegion(
    handle: number,
    plane: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): Uint8Array<ArrayBuffer> {
    const bytes = this.take(this.exports.bf_read_region(handle, plane, x, y, w, h));
    if (bytes === null) throw new Error(`could not read region: ${this.lastError()}`);
    return bytes;
  }

  detectJson(name: string, header: Uint8Array): string {
    const namePtr = this.putText(name);
    const headerPtr = this.putBytes(header);
    try {
      const text = this.takeText(
        this.exports.bf_detect_json(namePtr.ptr, namePtr.len, headerPtr.ptr, headerPtr.len),
      );
      if (text === null) throw new Error(`could not detect format: ${this.lastError()}`);
      return text;
    } finally {
      this.exports.bf_free(namePtr.ptr, namePtr.len);
      this.exports.bf_free(headerPtr.ptr, headerPtr.len);
    }
  }
}

export { MOUNT, wasi };
