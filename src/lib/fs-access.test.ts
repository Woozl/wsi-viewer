import { describe, expect, it } from 'vitest';
import { isCompanionDirectoryName } from './fs-access';

describe('isCompanionDirectoryName', () => {
  it('matches the Olympus "<full filename>.files" convention', () => {
    // The layout of the sample in images/: the whole filename is kept,
    // extension included, before ".files".
    expect(isCompanionDirectoryName('40X UPSC 43000 1.oif.files', '40X UPSC 43000 1.oif')).toBe(
      true,
    );
  });

  it('matches the "<stem>.files" variant', () => {
    expect(isCompanionDirectoryName('scan.files', 'scan.oif')).toBe(true);
  });

  it('matches a bare stem, as MIRAX uses', () => {
    expect(isCompanionDirectoryName('specimen', 'specimen.mrxs')).toBe(true);
  });

  it('matches the underscore-wrapped stem VSI uses', () => {
    expect(isCompanionDirectoryName('_specimen_', 'specimen.vsi')).toBe(true);
  });

  it('ignores case, which is not stable across exports', () => {
    expect(isCompanionDirectoryName('SCAN.OIF.FILES', 'scan.oif')).toBe(true);
  });

  it('rejects unrelated folders', () => {
    expect(isCompanionDirectoryName('thumbnails', 'scan.oif')).toBe(false);
    expect(isCompanionDirectoryName('other.oif.files', 'scan.oif')).toBe(false);
  });
});
