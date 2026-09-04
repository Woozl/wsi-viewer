import { Fd, Inode, wasi } from '@bjorn3/browser_wasi_shim';

/**
 * A WASI file descriptor backed by a browser `File`, read on demand.
 *
 * Whole-slide images routinely run to many gigabytes and `bioformats` seeks all
 * over the file while parsing IFDs, so bytes are sliced out of the `File` per
 * read instead of being buffered into linear memory. Memory use is therefore a
 * function of the tile being decoded, not of slide size.
 *
 * WASI's read operations are synchronous, which is why this only works inside a
 * worker: `FileReaderSync` has no main-thread equivalent.
 */
/**
 * Bytes pulled in when a small read misses the window.
 *
 * A `FileReaderSync` call costs roughly the same whatever its size, and some
 * readers walk their index structures one scalar at a time: MIRAX issues over
 * half a million 4-byte reads while mapping a slide's tiles, which is instant
 * against a native descriptor but takes minutes one `Blob` slice at a time.
 * Buffering makes that cost scale with bytes touched rather than read count.
 */
const WINDOW_BYTES = 256 * 1024;

class LazyFileFd extends Fd {
  private position = 0n;
  private readonly reader = new FileReaderSync();
  /** Bytes cached from the file, starting at `windowStart`. */
  private window: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private windowStart = 0;

  constructor(
    private readonly file: File,
    private readonly ino: bigint,
  ) {
    super();
  }

  private slice(start: number, end: number): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.reader.readAsArrayBuffer(this.file.slice(start, end)));
  }

  private readAt(offset: bigint, size: number): Uint8Array {
    const start = Number(offset);
    if (!Number.isFinite(start) || start < 0 || start >= this.file.size) {
      return new Uint8Array(0);
    }
    const end = Math.min(start + size, this.file.size);
    // Anything larger than the window goes straight through: tile payloads are
    // big enough that per-call overhead is already negligible, and buffering
    // them would only copy the bytes a second time.
    if (end - start > WINDOW_BYTES) return this.slice(start, end);
    if (start < this.windowStart || end > this.windowStart + this.window.length) {
      this.windowStart = start;
      this.window = this.slice(start, Math.min(start + WINDOW_BYTES, this.file.size));
    }
    return this.window.slice(start - this.windowStart, end - this.windowStart);
  }

  override fd_pread(size: number, offset: bigint): { ret: number; data: Uint8Array } {
    return { ret: wasi.ERRNO_SUCCESS, data: this.readAt(offset, size) };
  }

  override fd_read(size: number): { ret: number; data: Uint8Array } {
    const data = this.readAt(this.position, size);
    this.position += BigInt(data.length);
    return { ret: wasi.ERRNO_SUCCESS, data };
  }

  override fd_seek(offset: bigint, whence: number): { ret: number; offset: bigint } {
    const size = BigInt(this.file.size);
    let next: bigint;
    switch (whence) {
      case wasi.WHENCE_SET:
        next = offset;
        break;
      case wasi.WHENCE_CUR:
        next = this.position + offset;
        break;
      case wasi.WHENCE_END:
        next = size + offset;
        break;
      default:
        return { ret: wasi.ERRNO_INVAL, offset: this.position };
    }
    if (next < 0n) return { ret: wasi.ERRNO_INVAL, offset: this.position };
    this.position = next;
    return { ret: wasi.ERRNO_SUCCESS, offset: this.position };
  }

  override fd_tell(): { ret: number; offset: bigint } {
    return { ret: wasi.ERRNO_SUCCESS, offset: this.position };
  }

  override fd_filestat_get(): { ret: number; filestat: wasi.Filestat } {
    return {
      ret: wasi.ERRNO_SUCCESS,
      filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_REGULAR_FILE, BigInt(this.file.size)),
    };
  }

  override fd_fdstat_get(): { ret: number; fdstat: wasi.Fdstat | null } {
    return {
      ret: wasi.ERRNO_SUCCESS,
      fdstat: new wasi.Fdstat(wasi.FILETYPE_REGULAR_FILE, 0),
    };
  }

  override fd_close(): number {
    return wasi.ERRNO_SUCCESS;
  }
}

/** Read-only inode exposing a browser `File` to the guest. */
export class LazyFileInode extends Inode {
  constructor(private readonly file: File) {
    super();
  }

  override path_open(
    _oflags: number,
    _fsRightsBase: bigint,
    _fdFlags: number,
  ): { ret: number; fd_obj: Fd | null } {
    return { ret: wasi.ERRNO_SUCCESS, fd_obj: new LazyFileFd(this.file, this.ino) };
  }

  override stat(): wasi.Filestat {
    return new wasi.Filestat(this.ino, wasi.FILETYPE_REGULAR_FILE, BigInt(this.file.size));
  }
}
