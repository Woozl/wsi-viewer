// Materialises the one dependency that needs patching for 32-bit targets.
//
// hdf5-pure-rust defines three guard constants as `4 * 1024 * 1024 * 1024`,
// which is exactly 2^32 and so fails const-evaluation on wasm32. Rather than
// commit an 8.7 MB vendored copy for a three-line change, the crate is fetched
// from crates.io and patched here. Runs identically locally and in CI.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = 'hdf5-pure-rust';
const VERSION = '0.3.10';
const patchFile = join(root, 'patches', `${CRATE}-wasm32.patch`);
const vendorDir = join(root, 'vendor', CRATE);
const stampFile = join(vendorDir, '.patched-stamp');

// Re-patching is only skipped when both the version and the patch itself match.
const patchHash = createHash('sha256').update(readFileSync(patchFile)).digest('hex').slice(0, 16);
const stamp = `${VERSION}:${patchHash}`;

if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
  console.log(`[vendor] ${CRATE} ${VERSION} already patched`);
  process.exit(0);
}

console.log(`[vendor] fetching ${CRATE} ${VERSION}`);
const url = `https://static.crates.io/crates/${CRATE}/${CRATE}-${VERSION}.crate`;
const response = await fetch(url);
if (!response.ok) {
  throw new Error(`failed to download ${url}: ${response.status} ${response.statusText}`);
}

rmSync(vendorDir, { recursive: true, force: true });
mkdirSync(vendorDir, { recursive: true });

const tarball = join(root, 'vendor', `${CRATE}.crate`);
writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
// The tarball's single root directory is stripped so the patch paths line up.
execFileSync('tar', ['xzf', tarball, '-C', vendorDir, '--strip-components=1'], { stdio: 'inherit' });
rmSync(tarball, { force: true });

console.log('[vendor] applying wasm32 patch');
// `git apply` fails loudly if upstream changes shape, which is the point.
execFileSync('git', ['apply', '--unsafe-paths', `--directory=vendor/${CRATE}`, patchFile], {
  cwd: root,
  stdio: 'inherit',
});

writeFileSync(stampFile, stamp);
console.log(`[vendor] ${CRATE} ${VERSION} patched`);
