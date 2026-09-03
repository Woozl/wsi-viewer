// Exercises the compiled core against a real slide using Node's WASI, which
// supports preopens just like the browser shim does. Fastest way to tell
// whether a reader works at runtime rather than merely compiling.
//
//   node scripts/smoke-wasm.mjs images/image.svs

import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { WASI } from 'node:wasi';

const input = resolve(process.argv[2] ?? 'images/image.svs');
const mountPoint = '/slides';
const guestPath = `${mountPoint}/${basename(input)}`;

// /tmp mirrors what the browser mounts: readers that hand a path to another
// reader stage bytes there, because std::env::temp_dir() panics on wasm.
const scratch = mkdtempSync(join(tmpdir(), 'wsi-smoke-'));
const wasi = new WASI({
  version: 'preview1',
  preopens: { [mountPoint]: dirname(input), '/tmp': scratch },
});

const module = await WebAssembly.compile(await readFile('public/wasm/wsi_core.wasm'));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
wasi.initialize(instance);

const api = instance.exports;
const memory = api.memory;

const unpack = (packed) => ({
  ptr: Number(BigInt.asUintN(64, packed) >> 32n),
  len: Number(BigInt.asUintN(64, packed) & 0xffffffffn),
});

function take(packed) {
  const { ptr, len } = unpack(packed);
  if (ptr === 0) return null;
  const bytes = new Uint8Array(memory.buffer, ptr, len).slice();
  api.bf_free(ptr, len);
  return bytes;
}

const decoder = new TextDecoder();
const takeString = (packed) => {
  const bytes = take(packed);
  return bytes === null ? null : decoder.decode(bytes);
};

function lastError() {
  return takeString(api.bf_last_error()) ?? '(none)';
}

function writeString(text) {
  const bytes = new TextEncoder().encode(text);
  const ptr = api.bf_alloc(bytes.length);
  new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

console.log(`opening ${guestPath}`);
const path = writeString(guestPath);
const started = performance.now();
const handle = api.bf_open(path.ptr, path.len);
api.bf_free(path.ptr, path.len);

if (handle === 0) {
  console.error(`bf_open failed: ${lastError()}`);
  process.exit(1);
}
console.log(`opened in ${(performance.now() - started).toFixed(0)} ms (handle ${handle})`);

const info = JSON.parse(takeString(api.bf_metadata_json(handle)));
console.log(`series ${info.series + 1}/${info.seriesCount}, levels ${info.resolutionCount}`);
console.log(`base ${info.width} x ${info.height}, ${info.pixelType}, rgb=${info.isRgb}`);

const levels = JSON.parse(takeString(api.bf_levels_json(handle)));
console.log('pyramid:');
for (const level of levels) console.log(`  L${level.level}: ${level.width} x ${level.height}`);

const keys = Object.keys(info.metadata ?? {});
console.log(`series metadata keys: ${keys.length}`);
console.log(`  sample: ${keys.slice(0, 8).join(', ')}`);

const tiling = JSON.parse(takeString(api.bf_level_tiling_json(handle, 0, 0)));
console.log('level 0 tiling:', JSON.stringify(tiling));

if (tiling.supported) {
  const tileStart = performance.now();
  const tile = JSON.parse(takeString(api.bf_compressed_tile_json(handle, 0, 0, 0n, 0n)));
  console.log(`tile (0,0) in ${(performance.now() - tileStart).toFixed(1)} ms:`, JSON.stringify(tile));
  if (tile.payload.kind === 'owned') api.bf_free(tile.payload.ptr, tile.payload.len);
} else {
  const regionStart = performance.now();
  const region = take(api.bf_read_region(handle, 0, 0, 0, 256, 256));
  console.log(
    region === null
      ? `bf_read_region failed: ${lastError()}`
      : `decoded 256x256 region: ${region.length} bytes in ${(performance.now() - regionStart).toFixed(1)} ms`,
  );
}

console.log(`bf_close -> ${api.bf_close(handle)}`);
