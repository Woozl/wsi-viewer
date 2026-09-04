# WSI Viewer

A whole-slide image viewer that runs entirely in the browser. Slides are decoded
locally by the [`bioformats`](https://crates.io/crates/bioformats) crate compiled
to WebAssembly; no server sees the data, and the build output is static files.

## What it does

- Opens slides in the formats bioformats' readers claim — Aperio SVS, pyramidal
  OME-TIFF, DICOM, CZI and others
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
`usize` during const evaluation; it is fetched and patched at build time by
`scripts/prepare-vendor.mjs`. The `zarr` and `tissuefaxs` features pull in
`zstd-sys` and `libsqlite3-sys`, and the `openslide` feature pulls in
`openslide-pure-rs`, which despite its name compiles 2,400 lines of C against
system libjpeg, cairo and libopenjp2. All three are disabled.

**Pyramids are reconstructed, not read.** A format exposes its pyramid either as
several single-resolution series (Aperio) or as one series with several
resolutions (pyramidal OME-TIFF). Both are flattened into `(series, resolution)`
candidates and grouped by aspect ratio, which recovers the pyramid and leaves
label and macro images out of it.

**Tiles avoid a decode where possible.** Stored JPEG blocks are handed straight
to the browser's decoder in a worker and transferred as `ImageBitmap`, so no
pixel data crosses the main thread. Aperio writes three-component tiles that are
already RGB but omits the JFIF and Adobe markers, and a decoder seeing three
components with no marker must assume YCbCr — the slide renders magenta and
green. An APP14 segment declaring `transform = 0` is injected to correct it.
Levels with no compressed blocks fall back to decoding regions.

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

- No MIRAX, Ventana, Trestle, Sakura or Philips support: those come from the
  `openslide` feature, which cannot reach WebAssembly without porting its C
  shims to Rust.
- Formats whose data lives in a sibling folder (OIF, AFI, NDPIS) can only be
  opened through the Folders panel, since the file input hands over a single
  file with no way to reach its siblings.
- No Zarr/OME-Zarr or TissueFAXS, for the same reason.
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
