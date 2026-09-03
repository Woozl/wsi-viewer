// Materialises the dependencies that need patching for the browser.
//
// Both are fetched from crates.io and patched here rather than vendored into
// the repository: together they are ~10 MB of source for a few dozen changed
// lines. Runs identically locally and in CI.
//
//   hdf5-pure-rust  Three guard constants are 4 * 1024 * 1024 * 1024, exactly
//                   2^32, which overflows a 32-bit usize at const-eval time.
//   bioformats      Readers that hand a path to another reader stage bytes via
//                   std::env::temp_dir(), which panics outright on wasm.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{ crate: string, version: string, patch: string }[]} */
const VENDORED = [
  { crate: 'hdf5-pure-rust', version: '0.3.10', patch: 'hdf5-pure-rust-wasm32.patch' },
  { crate: 'bioformats', version: '0.1.8', patch: 'bioformats-wasm-compat.patch' },
];

for (const { crate, version, patch } of VENDORED) {
  const patchFile = join(root, 'patches', patch);
  const vendorDir = join(root, 'vendor', crate);
  const stampFile = join(vendorDir, '.patched-stamp');

  // Re-patching is skipped only when the version and the patch both match.
  const patchHash = createHash('sha256').update(readFileSync(patchFile)).digest('hex').slice(0, 16);
  const stamp = `${version}:${patchHash}`;

  if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
    console.log(`[vendor] ${crate} ${version} already patched`);
    continue;
  }

  console.log(`[vendor] fetching ${crate} ${version}`);
  const url = `https://static.crates.io/crates/${crate}/${crate}-${version}.crate`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url}: ${String(response.status)} ${response.statusText}`);
  }

  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });

  const tarball = join(root, 'vendor', `${crate}.crate`);
  writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  // The tarball's single root directory is stripped so patch paths line up.
  execFileSync('tar', ['xzf', tarball, '-C', vendorDir, '--strip-components=1'], {
    stdio: 'inherit',
  });
  rmSync(tarball, { force: true });

  console.log(`[vendor] applying ${patch}`);
  // `git apply` fails loudly if upstream changes shape, which is the point.
  execFileSync('git', ['apply', '--unsafe-paths', `--directory=vendor/${crate}`, patchFile], {
    cwd: root,
    stdio: 'inherit',
  });

  writeFileSync(stampFile, stamp);
  console.log(`[vendor] ${crate} ${version} patched`);
}
