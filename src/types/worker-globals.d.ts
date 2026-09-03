/**
 * `FileReaderSync` lives in lib.webworker, which cannot be combined with lib.dom
 * without duplicate-identifier errors. The WASM core needs synchronous reads to
 * satisfy WASI's blocking `fd_read`/`fd_pread`, so it is declared here and only
 * ever constructed inside a worker.
 */
declare class FileReaderSync {
  readAsArrayBuffer(blob: Blob): ArrayBuffer;
}
