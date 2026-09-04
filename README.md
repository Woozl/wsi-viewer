# WSI Viewer

A whole-slide image viewer that runs entirely in the browser. Slides are decoded
locally by the [`bioformats`](https://crates.io/crates/bioformats) crate compiled
to WebAssembly; no server sees the data, and the build output is static files.

## What it does

- Opens slides in the formats bioformats' readers claim — Aperio SVS, pyramidal
  OME-TIFF, DICOM, CZI, 3DHISTECH MIRAX and others
- Pans and zooms a gigapixel pyramid at interactive speed
- Shows the slide's full format metadata, pyramid layout and associated images
- Overview map showing where the viewport sits, with click-to-navigate
- Dockable panels: drag any section to any edge, collapse it, or resize the dock
- Multichannel fluorescence: per-channel colour, display window and gamma,
  composited on the GPU
- Reads whole folders through the File System Access API, remembering them
  between visits
- Light, dark and system themes; keyboard-navigable throughout

## Running it

```sh
npm install
npm run build:wasm   # fetches and patches deps, builds the core, ~2 min cold
npm run dev
```

Requires Node 22+ and a Rust toolchain with the `wasm32-wasip1` target
(`rustup target add wasm32-wasip1`).

| Script | Purpose |
| --- | --- |
| `npm run build:wasm` | Build the Rust core and regenerate the format list |
| `npm run dev` | Vite dev server |
| `npm run build` | WASM + typecheck + production build |
| `npm test` | Unit tests |
| `npm run test:e2e` | Generate fixture slides and run Playwright |
| `WSI_SVS_FIXTURE=<path> npm run test:e2e` | Also check a real Aperio slide |
| `npm run smoke:wasm -- <slide>` | Open a slide through Node's WASI, outside the browser |

## How it works

**The core runs under WASI, not wasm-bindgen.** `bioformats` opens files by path
and touches `std::fs` in roughly 558 places across 75 modules. Rewriting that to
a byte-source trait would mean forking a 220,000-line crate, so the module
targets `wasm32-wasip1` and runs against
[`browser_wasi_shim`](https://github.com/bjorn3/browser_wasi_shim) with a custom
file descriptor backed by `File.slice()` and `FileReaderSync`. Opening a 208 MB
slide costs 48 reads and about 15 ms, and memory use does not grow with slide
size. The descriptors must start at fd 3 — WASI discovers preopens by scanning
from there, and a preopen placed earlier is invisible to the guest.

**Three dependencies had to be dealt with.** `hdf5-pure-rust` defines three guard
constants as `4 * 1024 * 1024 * 1024` — exactly 2³² — which overflows a 32-bit
`usize` during const evaluation. The `zarr` and `tissuefaxs` features pull in
`zstd-sys` and `libsqlite3-sys`, and are disabled. `openslide-pure-rs`, despite
its name, compiles 2,400 lines of C against system libjpeg, cairo and libopenjp2.
All three are fetched and patched at build time by `scripts/prepare-vendor.mjs`,
which keeps the patches reviewable in `patches/` instead of committing three
vendored crates.

**The openslide feature's C shims were ported to Rust.** Its sixteen `osr_*`
symbols are declared in `extern "C"` blocks and called from a dozen places, so
the port supplies them as `#[no_mangle] extern "C"` Rust functions and leaves
every call site untouched. Most are JPEG entry points, answered with `zune-jpeg`,
plus three cairo blits that reproduce cairo's `SATURATE` operator — with an
opaque source it reduces to first-writer-wins, which is how overlapping tile
edges avoid being painted twice. Seven remain stubs that return a clear error:
JPEG 2000, lossless JPEG, the sampled and byte-range readers, and the BGRA crops.
No reader reachable from the enabled feature set calls them.

WASI's `std` has gaps that this crate walks into. `std::env::temp_dir()` panics
outright, `std::process::id()` is unsupported, and `File::try_clone()` cannot
duplicate a descriptor — the last is patched to reopen by path, which every
caller tolerates because each one seeks before reading or hands the file to a
TIFF decoder that seeks itself.

**Pyramids are reconstructed, not read.** A format exposes its pyramid either as
several single-resolution series (Aperio) or as one series with several
resolutions (pyramidal OME-TIFF). Both are flattened into `(series, resolution)`
candidates and grouped by aspect ratio, which recovers the pyramid and leaves
label and macro images out of it.

**A `.mrxs` file has to be dispatched by suffix.** Its bytes are the slide's JPEG
overview, with the pixel data in a sibling directory, so byte sniffing hands it
to a JPEG reader that duly reports the overview's dimensions instead of the
slide's. The registry therefore matches the extension before it sniffs, the same
way it already special-cases file patterns and ICS.

**Small reads are buffered.** Reads are served by slicing a `File`, and a
`FileReaderSync` call costs about the same whatever its size, so a reader that
walks its index one scalar at a time is pathological: MIRAX issues over half a
million 4-byte reads — 2.2 MB in total — while mapping a slide's tiles, which
took three minutes one slice at a time. A 256 KB window makes the cost scale with
bytes touched rather than read count, and the same open now takes 0.8 s. Reads
larger than the window pass straight through, since a tile payload is already
big enough that per-call overhead is noise.

**Tiles avoid a decode where possible.** Stored JPEG blocks are handed straight
to the browser's decoder in a worker and transferred as `ImageBitmap`, so no
pixel data crosses the main thread. Aperio writes three-component tiles that are
already RGB but omits the JFIF and Adobe markers, and a decoder seeing three
components with no marker must assume YCbCr — the slide renders magenta and
green. An APP14 segment declaring `transform = 0` is injected to correct it.
Levels with no compressed blocks fall back to decoding regions — every
openslide-backed format composites its tiles rather than storing them whole, so
it only ever answers region reads, and the fallback is remembered per level so
it is paid once instead of once per tile.

The overview is built from the coarsest pyramid level for the same reason a
pyramid exists: this MIRAX slide's base level is 289,792 × 620,544, which decodes
to 539 GB and traps the allocator. A slide whose coarsest level is still enormous
gets no overview rather than a trap, because a trap would poison the instance for
every later read too.

**Panels dock to any edge.** The arrangement is described by which dock each
panel sits in plus one global ordering, so moving a panel between docks never
has to reconcile two arrays. Top and bottom span the full width and the side
docks fill the band between them, which keeps the viewport rectangular whatever
the arrangement. Dragging a header is the pointer affordance; a "Move to" menu
on each header is the keyboard equivalent. The layout persists to localStorage
and is repaired on load, so a renamed or newly added panel cannot strand anyone
with an arrangement that never shows it.

**Channels are composited on the GPU.** Fluorescence formats store each channel
as its own plane, so the viewer uploads one texture band per channel and lets a
WebGL style combine them. Colour, window and gamma are shader uniforms, which is
what makes dragging a slider a uniform update rather than a re-decode of every
visible tile. Compositing is additive, because that is what the instrument does:
two fluorophores in the same place emit together, so green over red reads yellow.

Default colours come from the file wherever it says anything — an explicit OME
channel colour first, then the emission wavelength, then a fallback palette.
Formats often record only the excitation wavelength, which is shorter than what
the eye would see, so it is shifted by a typical Stokes shift before being
converted; 405 nm excitation is a blue DAPI channel, not a violet one. Windows
are sampled from the image when it opens, so a slide is legible immediately.

Brightfield slides keep the compressed JPEG path and get one window over the
already-composited RGB, which is what keeps gigapixel brightfield usable.

**The format list is derived, not written by hand.** `scripts/build-wasm.mjs`
probes every registered reader with candidate extensions harvested from the crate
source and records the ones a reader claims. A documented supplement covers
readers such as `NdpiReader` that also inspect file contents inside
`is_this_type_by_name`, and so decline a synthetic probe path.

## Limitations

- MIRAX is the only format the `openslide` feature adds. The crate deliberately
  routes just `.mrxs` to its OpenSlide reader; Ventana, Trestle, Sakura, Philips
  and the rest go to native readers with fuller Bio-Formats metadata, and those
  readers are what limits them, not the port.
- A MIRAX slide's unscanned margin renders black. OpenSlide reports it as
  transparent, but the bridge into bioformats reads three channels and so drops
  the alpha that would say which pixels are background. Nothing distinguishes
  unscanned from genuinely black afterwards, so it is left as the reader
  reported it rather than guessed at.
- Formats whose data lives in a sibling folder (MIRAX, OIF, AFI, NDPIS) can only
  be opened through the Folders panel, since the file input hands over a single
  file with no way to reach its siblings.
- No Zarr/OME-Zarr or TissueFAXS: their features pull in C dependencies too.
- The folder tree needs the File System Access API, so it is Chromium-only.
  Everything else works everywhere; the file input is the fallback.
- The URL records the camera but cannot record the slide, because a `File`
  handle is not revivable. A shared link restores the view once the same slide
  is reopened.
- At most eight channels are displayed at once. Each costs a texture band and a
  set of uniforms, and highly multiplexed panels are read a few markers at a
  time; choosing which subset to show is not implemented yet.
- Z-stacks and time series are read at z = 0, t = 0. The plane indexing handles
  them, but nothing in the interface selects a plane.

## Licence

GPL-2.0-or-later, inherited from `bioformats`, which this project compiles and
distributes. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
