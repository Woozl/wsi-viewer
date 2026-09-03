/**
 * Upload filtering, derived from the crate's own reader predicates.
 * See scripts/build-wasm.mjs for how the extension list is produced.
 */
import { SUPPORTED_EXTENSIONS } from '@/generated/supported-extensions';

/**
 * Extensions whose readers verify file contents inside `is_this_type_by_name`.
 *
 * The generated list is produced by probing each reader with a synthetic path,
 * so a reader that also opens the file — `NdpiReader` checks for Hamamatsu TIFF
 * tags, for instance — always declines and its extension is missed. These are
 * recovered by inspecting which readers gate on `path` beyond its suffix; the
 * open call still decides whether the file is really readable.
 */
const CONTENT_GATED_EXTENSIONS = ['html', 'inf', 'ndpi', 'pds', 'set', 'spc'] as const;

const SUPPORTED = new Set<string>([...SUPPORTED_EXTENSIONS, ...CONTENT_GATED_EXTENSIONS]);

/**
 * Formats that arrive as a primary file plus a sibling directory of tiles.
 * Selecting only the primary file yields an unreadable slide, so the UI offers
 * directory selection when one of these is picked.
 */
const COMPANION_FORMATS = new Map<string, string>([
  ['mrxs', 'MIRAX slides keep their tile data in a folder named after the .mrxs file.'],
  ['vsi', 'Olympus VSI slides store pixel data in a sibling _<name>_ folder.'],
  ['afi', 'Aperio AFI files reference several .svs images stored alongside them.'],
  ['ndpis', 'NDPIS files index a set of .ndpi images stored alongside them.'],
  ['xlef', 'Leica XLEF projects reference image folders stored alongside them.'],
  ['vws', 'Leica VWS slides reference image data stored alongside them.'],
  ['lof', 'Leica LOF files are usually part of a multi-file project folder.'],
]);

/** Lowercase extension without the dot, or null when the name has none. */
export function extensionOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export function isSupportedFile(fileName: string): boolean {
  const extension = extensionOf(fileName);
  return extension !== null && SUPPORTED.has(extension);
}

/** Explains the companion-directory requirement, when there is one. */
export function companionHint(fileName: string): string | null {
  const extension = extensionOf(fileName);
  if (extension === null) return null;
  return COMPANION_FORMATS.get(extension) ?? null;
}

/** True when the format stores its pixel data in neighbouring files. */
export function needsCompanions(fileName: string): boolean {
  return companionHint(fileName) !== null;
}

/** `accept` attribute value for the file input. */
export const ACCEPT_ATTRIBUTE = [...SUPPORTED].map((ext) => `.${ext}`).join(',');

export const SUPPORTED_COUNT = SUPPORTED.size;
