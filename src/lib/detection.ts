/**
 * Interpretation of the core's format detection.
 *
 * Only emptiness of the two reader sets is meaningful. Readers implement their
 * name and byte checks independently, so a genuine Aperio slide is claimed by
 * `SvsReader` on name and by the generic TIFF readers on bytes, with no overlap
 * between the two sets — an intersection test would flag every real slide.
 */
import type { DetectResult } from './wasm/protocol';

export interface FormatNotice {
  readonly tone: 'warning' | 'info';
  readonly message: string;
}

export function formatNotice(
  detection: DetectResult,
  extension: string | null,
): FormatNotice | null {
  if (!detection.recognisedByBytes) {
    return {
      tone: 'warning',
      message:
        "Nothing in this file's header matches a known format signature. " +
        'It opened, but it may be truncated or stored unusually.',
    };
  }
  if (!detection.recognisedByName) {
    const suffix = extension === null ? 'no file extension' : `the extension .${extension}`;
    return {
      tone: 'info',
      message:
        `No reader claims ${suffix}, but this file's header matches a known format, ` +
        'so it was opened on its contents.',
    };
  }
  return null;
}
