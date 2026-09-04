//! Generates the pyramidal OME-TIFF the end-to-end test opens.
//!
//! Built natively rather than for wasm so that fixture-generation code stays out
//! of the shipped module, and uses bioformats' own writer so the fixture
//! exercises the same code paths a real slide would.
//!
//! Usage: cargo run --release --bin make-fixture -- <output.ome.tif>

use std::path::Path;

use bioformats::tiff::PyramidOmeTiffWriter;
use bioformats::{FormatWriter, ImageMetadata, ImageWriter, PixelType};

const WIDTH: u32 = 1024;
const HEIGHT: u32 = 768;

/// Deterministic interleaved RGB: a red/green gradient with a blue grid, so a
/// test can assert on colour without depending on a real specimen.
///
/// The TIFF writer only accepts chunky RGB, so samples are interleaved rather
/// than stored as separate planes.
fn render(width: u32, height: u32) -> Vec<u8> {
    let mut pixels = vec![0u8; (width as usize) * (height as usize) * 3];
    for y in 0..height {
        for x in 0..width {
            let offset = ((y as usize) * (width as usize) + (x as usize)) * 3;
            let gridline = x % 64 < 2 || y % 64 < 2;
            pixels[offset] = ((x * 255) / width.max(1)) as u8;
            pixels[offset + 1] = ((y * 255) / height.max(1)) as u8;
            pixels[offset + 2] = if gridline { 255 } else { 32 };
        }
    }
    pixels
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let target = std::env::args().nth(1).ok_or("usage: make-fixture <output.ome.tif>")?;
    let path = Path::new(&target);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut meta = ImageMetadata::default();
    meta.size_x = WIDTH;
    meta.size_y = HEIGHT;
    meta.size_c = 3;
    meta.is_rgb = true;
    meta.is_interleaved = true;
    meta.pixel_type = PixelType::Uint8;
    meta.image_count = 1;
    meta.resolution_count = 3;

    let mut writer = PyramidOmeTiffWriter::new();
    writer.set_metadata(&meta)?;
    writer.set_id(path)?;
    // Level 0 goes in through save_bytes; coarser levels are appended.
    writer.save_bytes(0, &render(WIDTH, HEIGHT))?;
    writer.add_resolution_level(vec![render(WIDTH / 2, HEIGHT / 2)]);
    writer.add_resolution_level(vec![render(WIDTH / 4, HEIGHT / 4)]);
    writer.write_pyramid()?;

    println!("wrote {target} ({WIDTH}x{HEIGHT}, 3 levels)");

    write_multichannel(&path.with_file_name("multichannel.ome.tif"))?;
    Ok(())
}

/// Three 16-bit channels in separate planes, as a fluorescence file stores them.
///
/// Each channel occupies a different part of the frame and a different part of
/// the value range, so a test can tell them apart after compositing and can see
/// that the display window is doing something.
fn write_multichannel(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    const SIZE: u32 = 256;
    let pixels = (SIZE as usize) * (SIZE as usize);

    let planes: Vec<Vec<u8>> = (0..3u32)
        .map(|channel| {
            let mut plane = vec![0u8; pixels * 2];
            for y in 0..SIZE {
                for x in 0..SIZE {
                    // A band per channel: the first fills the top third, and so on.
                    let band = (y * 3) / SIZE;
                    let value: u16 = if band == channel { 3000 + (x as u16) * 4 } else { 40 };
                    let offset = ((y as usize) * (SIZE as usize) + (x as usize)) * 2;
                    plane[offset] = (value & 0xff) as u8;
                    plane[offset + 1] = (value >> 8) as u8;
                }
            }
            plane
        })
        .collect();

    let mut meta = ImageMetadata::default();
    meta.size_x = SIZE;
    meta.size_y = SIZE;
    meta.size_c = 3;
    // Separate planes rather than interleaved samples: this is what makes it a
    // multichannel image rather than an RGB one.
    meta.is_rgb = false;
    meta.pixel_type = PixelType::Uint16;
    meta.bits_per_pixel = 16;
    meta.image_count = 3;

    ImageWriter::save(path, &meta, &planes)?;
    println!("wrote {} ({SIZE}x{SIZE}, 3 channels)", path.display());
    Ok(())
}
