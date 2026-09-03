//! C-ABI surface over the `bioformats` crate for use in the browser.
//!
//! # Why WASI rather than `wasm32-unknown-unknown` + wasm-bindgen
//!
//! `bioformats` reaches for `std::fs` in ~558 places across 75 modules and its
//! entry point is `ImageReader::open(&Path)`. Rewriting that to a byte-source
//! trait would mean forking a 220k-line crate, so instead this targets
//! `wasm32-wasip1` and the host supplies the slide through a WASI preopen backed
//! by a lazily-sliced `File`. Whole-slide images run to many gigabytes, so the
//! file is never copied into linear memory.
//!
//! # Conventions
//!
//! Functions that return a buffer return a packed `u64` of `ptr << 32 | len`
//! (valid because the target is 32-bit), or `0` on failure, in which case
//! [`bf_last_error`] holds the reason. Every returned buffer is owned by the
//! caller and must be released with [`bf_free`].
//!
//! Every entry point catches panics: `bioformats` is a mechanical translation of
//! Java and will panic on some malformed inputs, which would otherwise poison
//! the whole WASM instance for the rest of the session.

mod candidates;

use std::cell::RefCell;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

use bioformats::{
    CompressedBytes, CompressedExtractionSupport, CompressedTileMode, ImageMetadata, ImageReader,
};

/// A reader plus the resolution level it is currently parked on. `ImageReader`
/// exposes `set_resolution` but no getter, so the level is tracked here.
struct Slide {
    reader: ImageReader,
    level: usize,
}

thread_local! {
    static SLIDES: RefCell<HashMap<u32, Slide>> = RefCell::new(HashMap::new());
    static NEXT_HANDLE: RefCell<u32> = const { RefCell::new(1) };
    static LAST_ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

fn set_error(message: impl Into<String>) {
    LAST_ERROR.with(|e| *e.borrow_mut() = message.into());
}

fn clear_error() {
    LAST_ERROR.with(|e| e.borrow_mut().clear());
}

/// Runs `body`, converting both `Err` and panics into `fallback` plus a recorded
/// error string.
fn guard<T>(fallback: T, body: impl FnOnce() -> Result<T, String>) -> T {
    clear_error();
    match catch_unwind(AssertUnwindSafe(body)) {
        Ok(Ok(value)) => value,
        Ok(Err(message)) => {
            set_error(message);
            fallback
        }
        Err(payload) => {
            let detail = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_owned())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".to_owned());
            set_error(format!("panic in bioformats: {detail}"));
            fallback
        }
    }
}

fn with_slide<T>(handle: u32, body: impl FnOnce(&mut Slide) -> Result<T, String>) -> Result<T, String> {
    SLIDES.with(|slides| {
        let mut slides = slides.borrow_mut();
        let slide = slides
            .get_mut(&handle)
            .ok_or_else(|| format!("no open slide for handle {handle}"))?;
        body(slide)
    })
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/// Allocates `len` bytes for the host to write into. Release with [`bf_free`].
#[no_mangle]
pub extern "C" fn bf_alloc(len: u32) -> *mut u8 {
    // `vec![0u8; n]` allocates with capacity exactly `n`, keeping this symmetric
    // with the `from_raw_parts` in `bf_free`.
    let mut buffer = vec![0u8; len as usize];
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Releases a buffer previously handed out by this module.
///
/// # Safety
/// `ptr`/`len` must be exactly as returned by [`bf_alloc`] or a packed buffer.
#[no_mangle]
pub unsafe extern "C" fn bf_free(ptr: *mut u8, len: u32) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, len as usize, len as usize));
    }
}

/// Copies `data` into a freshly allocated buffer and packs it as `ptr << 32 | len`.
fn pack(data: &[u8]) -> u64 {
    let len = data.len();
    let ptr = bf_alloc(len as u32);
    // SAFETY: `bf_alloc` just returned a `len`-byte allocation and the regions
    // cannot overlap because it is brand new.
    unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), ptr, len) };
    ((ptr as u64) << 32) | len as u64
}

fn pack_json<T: serde::Serialize>(value: &T) -> Result<u64, String> {
    let encoded = serde_json::to_vec(value).map_err(|e| format!("serialising response: {e}"))?;
    Ok(pack(&encoded))
}

/// Reads a host-provided UTF-8 string.
///
/// # Safety
/// `ptr`/`len` must describe an initialised buffer inside linear memory.
unsafe fn read_str(ptr: *const u8, len: u32) -> Result<String, String> {
    if ptr.is_null() {
        return Err("null pointer".to_owned());
    }
    let bytes = std::slice::from_raw_parts(ptr, len as usize);
    String::from_utf8(bytes.to_vec()).map_err(|e| format!("invalid UTF-8: {e}"))
}

/// Returns the most recent error as a packed buffer, or `0` if there is none.
#[no_mangle]
pub extern "C" fn bf_last_error() -> u64 {
    LAST_ERROR.with(|e| {
        let message = e.borrow();
        if message.is_empty() {
            0
        } else {
            pack(message.as_bytes())
        }
    })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/// Opens the slide at `path` (a WASI path inside a preopened directory).
/// Returns a handle, or `0` on failure.
///
/// # Safety
/// `path_ptr`/`path_len` must describe a valid UTF-8 buffer.
#[no_mangle]
pub unsafe extern "C" fn bf_open(path_ptr: *const u8, path_len: u32) -> u32 {
    guard(0, || {
        let path = read_str(path_ptr, path_len)?;
        let reader = ImageReader::open(Path::new(&path))
            .map_err(|e| format!("opening {path}: {e}"))?;
        let handle = NEXT_HANDLE.with(|n| {
            let mut n = n.borrow_mut();
            let handle = *n;
            *n = n.wrapping_add(1).max(1);
            handle
        });
        SLIDES.with(|slides| {
            slides.borrow_mut().insert(handle, Slide { reader, level: 0 });
        });
        Ok(handle)
    })
}

/// Closes a slide and releases its reader. Returns `0` on success.
#[no_mangle]
pub extern "C" fn bf_close(handle: u32) -> i32 {
    guard(-1, || {
        SLIDES.with(|slides| {
            let mut slides = slides.borrow_mut();
            match slides.remove(&handle) {
                Some(mut slide) => {
                    let _ = slide.reader.close();
                    Ok(0)
                }
                None => Err(format!("no open slide for handle {handle}")),
            }
        })
    })
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/// Stable, camelCase view of one series.
///
/// Deliberately not `ImageMetadata` itself: that type is the crate's internal
/// shape (snake_case, crate-specific enums) and would leak upstream churn into
/// the TypeScript contract.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SeriesInfo {
    series: usize,
    series_count: usize,
    width: u32,
    height: u32,
    size_z: u32,
    size_c: u32,
    size_t: u32,
    image_count: u32,
    pixel_type: String,
    bits_per_pixel: u8,
    dimension_order: String,
    is_rgb: bool,
    is_interleaved: bool,
    is_indexed: bool,
    is_little_endian: bool,
    resolution_count: usize,
    resolution: usize,
    thumbnail: bool,
    /// Format-specific key/values, stringified and sorted so the sidebar can
    /// render them directly. `MetadataValue::Bytes` renders as a byte count.
    metadata: std::collections::BTreeMap<String, String>,
}

fn series_info(reader: &ImageReader, level: usize) -> SeriesInfo {
    let m: &ImageMetadata = reader.metadata();
    SeriesInfo {
        series: reader.series(),
        series_count: reader.series_count(),
        width: m.size_x,
        height: m.size_y,
        size_z: m.size_z,
        size_c: m.size_c,
        size_t: m.size_t,
        image_count: m.image_count,
        pixel_type: format!("{:?}", m.pixel_type),
        bits_per_pixel: m.bits_per_pixel,
        dimension_order: format!("{:?}", m.dimension_order),
        is_rgb: m.is_rgb,
        is_interleaved: m.is_interleaved,
        is_indexed: m.is_indexed,
        is_little_endian: m.is_little_endian,
        resolution_count: reader.resolution_count(),
        resolution: level,
        thumbnail: m.thumbnail,
        metadata: m
            .series_metadata
            .iter()
            .map(|(key, value)| (key.clone(), value.to_string()))
            .collect(),
    }
}

/// Returns the current series' metadata as JSON.
#[no_mangle]
pub extern "C" fn bf_metadata_json(handle: u32) -> u64 {
    guard(0, || {
        with_slide(handle, |slide| {
            pack_json(&series_info(&slide.reader, slide.level))
        })
    })
}

/// Returns every series' metadata in one call, which is what the viewer needs to
/// reconstruct the pyramid. Restores the originally selected series.
#[no_mangle]
pub extern "C" fn bf_all_series_json(handle: u32) -> u64 {
    guard(0, || {
        with_slide(handle, |slide| {
            let count = slide.reader.series_count();
            let previous = slide.reader.series();
            let mut all = Vec::with_capacity(count);
            for series in 0..count {
                slide
                    .reader
                    .set_series(series)
                    .map_err(|e| format!("selecting series {series}: {e}"))?;
                all.push(series_info(&slide.reader, 0));
            }
            slide
                .reader
                .set_series(previous)
                .map_err(|e| format!("restoring series {previous}: {e}"))?;
            pack_json(&all)
        })
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LevelDims {
    level: usize,
    width: u32,
    height: u32,
}

/// Returns every resolution level's pixel dimensions, which is what the viewer
/// needs to build its tile grid. Restores the previously selected level.
#[no_mangle]
pub extern "C" fn bf_levels_json(handle: u32) -> u64 {
    guard(0, || {
        with_slide(handle, |slide| {
            let count = slide.reader.resolution_count();
            let previous = slide.level;
            let mut levels = Vec::with_capacity(count);
            for level in 0..count {
                slide
                    .reader
                    .set_resolution(level)
                    .map_err(|e| format!("selecting level {level}: {e}"))?;
                let metadata = slide.reader.metadata();
                levels.push(LevelDims {
                    level,
                    width: metadata.size_x,
                    height: metadata.size_y,
                });
            }
            slide
                .reader
                .set_resolution(previous)
                .map_err(|e| format!("restoring level {previous}: {e}"))?;
            pack_json(&levels)
        })
    })
}

/// Returns the number of series, or `-1` on failure.
#[no_mangle]
pub extern "C" fn bf_series_count(handle: u32) -> i32 {
    guard(-1, || with_slide(handle, |s| Ok(s.reader.series_count() as i32)))
}

/// Selects a series. Returns `0` on success.
#[no_mangle]
pub extern "C" fn bf_set_series(handle: u32, series: u32) -> i32 {
    guard(-1, || {
        with_slide(handle, |slide| {
            slide
                .reader
                .set_series(series as usize)
                .map_err(|e| format!("selecting series {series}: {e}"))?;
            // Series carry independent pyramids, so the level index resets.
            slide.level = 0;
            Ok(0)
        })
    })
}

/// Returns the resolution-level count for the current series, or `-1`.
#[no_mangle]
pub extern "C" fn bf_resolution_count(handle: u32) -> i32 {
    guard(-1, || {
        with_slide(handle, |s| Ok(s.reader.resolution_count() as i32))
    })
}

/// Selects a resolution level. Returns `0` on success.
#[no_mangle]
pub extern "C" fn bf_set_resolution(handle: u32, level: u32) -> i32 {
    guard(-1, || {
        with_slide(handle, |slide| {
            slide
                .reader
                .set_resolution(level as usize)
                .map_err(|e| format!("selecting level {level}: {e}"))?;
            slide.level = level as usize;
            Ok(0)
        })
    })
}

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

/// Decodes a rectangular region of the current series/level into raw pixels.
/// Used when the compressed fast path is unavailable.
#[no_mangle]
pub extern "C" fn bf_read_region(
    handle: u32,
    plane: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> u64 {
    guard(0, || {
        with_slide(handle, |slide| {
            let pixels = slide
                .reader
                .open_bytes_region(plane, x, y, width, height)
                .map_err(|e| format!("reading region {width}x{height}+{x}+{y}: {e}"))?;
            Ok(pack(&pixels))
        })
    })
}

#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum TilePayload {
    /// The tile is a contiguous byte range of the slide file, so the host can
    /// slice it straight out of the `File` and skip WASM entirely.
    FileRange { offset: u64, length: u64 },
    /// The tile had to be materialised; the host must read then `bf_free` it.
    Owned { ptr: u32, len: u32 },
    /// The tile is stitched from several ranges; not worth a partial fast path.
    Fragmented,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TileResponse {
    width: u32,
    height: u32,
    origin_x: u64,
    origin_y: u64,
    /// `"jpeg"`, `"jpeg2000"`, ... — tells the host whether the browser can decode it.
    codec: String,
    color_space: String,
    payload: TilePayload,
}

fn codec_name(codec: &bioformats::LossyCodec) -> String {
    match codec {
        bioformats::LossyCodec::Jpeg { .. } => "jpeg".to_owned(),
        bioformats::LossyCodec::Jpeg2000 { .. } => "jpeg2000".to_owned(),
        bioformats::LossyCodec::JpegXr => "jpegxr".to_owned(),
    }
}

/// The stored colour space, which decides whether the browser can decode the
/// original bytes directly. Aperio stores headerless tiles whose colour space is
/// only recorded in the container, so a mismatch here shows up as wrong colours.
fn codec_color_space(codec: &bioformats::LossyCodec) -> String {
    match codec {
        bioformats::LossyCodec::Jpeg { color_space, .. } => format!("{color_space:?}"),
        _ => "n/a".to_owned(),
    }
}

/// Describes a level's compressed tile layout, or reports why it is unavailable.
#[no_mangle]
pub extern "C" fn bf_level_tiling_json(handle: u32, plane: u32, level: u32) -> u64 {
    guard(0, || {
        with_slide(handle, |slide| {
            match slide
                .reader
                .compressed_level_info(plane, level)
                .map_err(|e| format!("querying tiling for level {level}: {e}"))?
            {
                CompressedExtractionSupport::Supported(info) => pack_json(&serde_json::json!({
                    "supported": true,
                    "width": info.width,
                    "height": info.height,
                    "tileWidth": info.tile_width,
                    "tileHeight": info.tile_height,
                    "tilesAcross": info.tiles_across,
                    "tilesDown": info.tiles_down,
                    "codec": codec_name(&info.codec),
                    "colorSpace": codec_color_space(&info.codec),
                })),
                CompressedExtractionSupport::NotSupported { reason } => {
                    pack_json(&serde_json::json!({ "supported": false, "reason": reason }))
                }
            }
        })
    })
}

/// Fetches one compressed tile, preferring the original stored bytes so the
/// browser's native image decoder can do the work off the main thread.
#[no_mangle]
pub extern "C" fn bf_compressed_tile_json(
    handle: u32,
    plane: u32,
    level: u32,
    col: u64,
    row: u64,
) -> u64 {
    guard(0, || {
        with_slide(handle, |slide| {
            let tile = slide
                .reader
                .read_compressed_tile(
                    plane,
                    level,
                    col,
                    row,
                    &[
                        CompressedTileMode::OriginalBytes,
                        CompressedTileMode::DerivedLosslessJpeg,
                    ],
                )
                .map_err(|e| format!("reading tile {col},{row} at level {level}: {e}"))?;

            let payload = match &tile.bytes {
                CompressedBytes::FileRange { offset, length, .. } => TilePayload::FileRange {
                    offset: *offset,
                    length: *length,
                },
                CompressedBytes::Owned(bytes) => {
                    let packed = pack(bytes);
                    TilePayload::Owned {
                        ptr: (packed >> 32) as u32,
                        len: packed as u32,
                    }
                }
                CompressedBytes::FileRanges { .. } => TilePayload::Fragmented,
            };

            pack_json(&TileResponse {
                width: tile.width,
                height: tile.height,
                origin_x: tile.origin_x,
                origin_y: tile.origin_y,
                codec: codec_name(&tile.codec),
                color_space: codec_color_space(&tile.codec),
                payload,
            })
        })
    })
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/// Reports which readers claim `filename` by extension and which claim `header`
/// by magic bytes. Drives the upload filter and the header sanity check.
///
/// Readers are reported as indices into the registry rather than names: the
/// trait has no name accessor, and the registry's ordering is built by filtering
/// an internal class list, so an externally reconstructed index-to-name map
/// would silently drift. Indices are enough to test the two sets for overlap.
///
/// # Safety
/// Both pointer/length pairs must describe initialised buffers.
#[no_mangle]
pub unsafe extern "C" fn bf_detect_json(
    name_ptr: *const u8,
    name_len: u32,
    header_ptr: *const u8,
    header_len: u32,
) -> u64 {
    guard(0, || {
        let name = read_str(name_ptr, name_len)?;
        let header: &[u8] = if header_ptr.is_null() || header_len == 0 {
            &[]
        } else {
            std::slice::from_raw_parts(header_ptr, header_len as usize)
        };

        let path = Path::new(&name);
        let mut by_name: Vec<u32> = Vec::new();
        let mut by_bytes: Vec<u32> = Vec::new();
        for (index, reader) in bioformats::registry::all_readers_pub().iter().enumerate() {
            let index = index as u32;
            if reader.is_this_type_by_name(path) {
                by_name.push(index);
            }
            if !header.is_empty() && reader.is_this_type_by_bytes(header) {
                by_bytes.push(index);
            }
        }

        // Deliberately no "these disagree" verdict. The two sets are not
        // comparable: readers implement the name and byte checks independently,
        // so a genuine Aperio slide reports only SvsReader by name while its
        // bytes are claimed by the generic TIFF readers, with no overlap. Only
        // whether each set is empty carries reliable meaning.
        pack_json(&serde_json::json!({
            "byName": by_name,
            "byBytes": by_bytes,
            "recognisedByName": !by_name.is_empty(),
            "recognisedByBytes": !by_bytes.is_empty(),
        }))
    })
}

/// Returns the file extensions that at least one reader claims by name.
///
/// Filters an over-inclusive harvested candidate list through each reader's own
/// `is_this_type_by_name`, so the upload filter reflects the crate's real
/// coverage instead of a hand-maintained list.
#[no_mangle]
pub extern "C" fn bf_supported_extensions_json() -> u64 {
    guard(0, || {
        let readers = bioformats::registry::all_readers_pub();
        let mut supported: Vec<&str> = candidates::CANDIDATES
            .iter()
            .copied()
            .filter(|extension| {
                let probe = format!("probe.{extension}");
                let path = Path::new(&probe);
                readers.iter().any(|reader| reader.is_this_type_by_name(path))
            })
            .collect();
        supported.sort_unstable();
        supported.dedup();
        pack_json(&supported)
    })
}
