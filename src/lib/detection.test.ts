import { describe, expect, it } from 'vitest';
import { formatNotice } from './detection';

describe('formatNotice', () => {
  it('stays silent for a file recognised both ways', () => {
    // A genuine Aperio slide: claimed by name and by bytes, but by different
    // readers, so an intersection test would wrongly flag it.
    expect(
      formatNotice({ recognisedByName: true, recognisedByBytes: true }, 'svs'),
    ).toBeNull();
  });

  it('warns when no reader recognises the header', () => {
    const notice = formatNotice({ recognisedByName: true, recognisedByBytes: false }, 'svs');
    expect(notice?.tone).toBe('warning');
    expect(notice?.message).toMatch(/header/i);
  });

  it('explains an unrecognised extension whose contents are known', () => {
    const notice = formatNotice({ recognisedByName: false, recognisedByBytes: true }, 'dat');
    expect(notice?.tone).toBe('info');
    expect(notice?.message).toContain('.dat');
  });

  it('handles a file with no extension at all', () => {
    const notice = formatNotice({ recognisedByName: false, recognisedByBytes: true }, null);
    expect(notice?.message).toContain('no file extension');
  });
});
