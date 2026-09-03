import { describe, expect, it } from 'vitest';
import { companionHint, extensionOf, isSupportedFile, SUPPORTED_COUNT } from './formats';

describe('extensionOf', () => {
  it('lowercases the extension', () => {
    expect(extensionOf('SLIDE.SVS')).toBe('svs');
  });

  it('uses the last extension of a compound name', () => {
    expect(extensionOf('image.ome.tif')).toBe('tif');
  });

  it('returns null when there is no usable extension', () => {
    expect(extensionOf('README')).toBeNull();
    expect(extensionOf('trailing.')).toBeNull();
    // A leading dot makes a hidden file, not an extension.
    expect(extensionOf('.gitignore')).toBeNull();
  });
});

describe('isSupportedFile', () => {
  it('accepts whole-slide formats the crate reports', () => {
    for (const name of ['a.svs', 'a.ndpi', 'a.scn', 'a.czi', 'a.tif']) {
      expect(isSupportedFile(name), name).toBe(true);
    }
  });

  it('rejects formats no reader claims', () => {
    for (const name of ['notes.docx', 'archive.rar', 'video.mkv']) {
      expect(isSupportedFile(name), name).toBe(false);
    }
  });

  it('exposes a non-trivial derived format list', () => {
    // Guards against the generated list silently becoming empty.
    expect(SUPPORTED_COUNT).toBeGreaterThan(100);
  });
});

describe('companionHint', () => {
  it('explains formats that need a sibling directory', () => {
    expect(companionHint('slide.mrxs')).toMatch(/folder/i);
    expect(companionHint('slide.vsi')).toMatch(/folder/i);
  });

  it('is silent for self-contained formats', () => {
    expect(companionHint('slide.svs')).toBeNull();
  });
});
