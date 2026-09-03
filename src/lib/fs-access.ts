/**
 * File System Access API integration.
 *
 * Chromium exposes `showDirectoryPicker`, which lets the user grant access to a
 * whole folder of slides rather than picking one file at a time. Handles survive
 * in IndexedDB — they are structured-cloneable — so the sidebar can be restored
 * on a later visit. Permission does not survive with them: the browser demands a
 * fresh user gesture, which is why restoring is offered as a button rather than
 * done automatically.
 *
 * Everything here is progressive enhancement; Firefox and Safari fall back to
 * the ordinary file input.
 */
import { del, get, set } from 'idb-keyval';
import { isSupportedFile } from './formats';

const STORE_KEY = 'wsi-viewer:directories';

export interface DirectoryEntry {
  /** Stable identity for the tree, unique within a session. */
  readonly id: string;
  readonly name: string;
  readonly kind: 'file' | 'directory';
  readonly handle: FileSystemDirectoryHandle | FileSystemFileHandle;
  /** True when a bioformats reader claims this file's extension. */
  readonly supported: boolean;
}

/** Feature detection; the picker is Chromium-only at the time of writing. */
export function supportsDirectoryPicker(): boolean {
  return typeof globalThis.showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsDirectoryPicker()) return null;
  try {
    return await globalThis.showDirectoryPicker({ mode: 'read' });
  } catch (error) {
    // Dismissing the picker rejects with AbortError, which is not a failure.
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

/**
 * Lists one directory level. Listing is deliberately shallow: a slide archive
 * can hold thousands of files, and walking it eagerly would stall the sidebar.
 */
export async function listDirectory(
  handle: FileSystemDirectoryHandle,
  parentId: string,
): Promise<DirectoryEntry[]> {
  const entries: DirectoryEntry[] = [];
  for await (const [name, child] of handle.entries()) {
    entries.push({
      id: `${parentId}/${name}`,
      name,
      kind: child.kind,
      handle: child,
      supported: child.kind === 'file' && isSupportedFile(name),
    });
  }
  // Directories first, then names, so the ordering is predictable.
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

export function isDirectoryHandle(
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
): handle is FileSystemDirectoryHandle {
  return handle.kind === 'directory';
}

export function isFileHandle(
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
): handle is FileSystemFileHandle {
  return handle.kind === 'file';
}

/** Whether the page may still read this handle without prompting. */
export async function hasPermission(handle: FileSystemHandle): Promise<boolean> {
  return (await handle.queryPermission({ mode: 'read' })) === 'granted';
}

/** Must be called from a user gesture, or the browser rejects the prompt. */
export async function requestPermission(handle: FileSystemHandle): Promise<boolean> {
  if (await hasPermission(handle)) return true;
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}

export async function loadStoredDirectories(): Promise<FileSystemDirectoryHandle[]> {
  const stored: unknown = await get(STORE_KEY);
  if (!Array.isArray(stored)) return [];
  // Anything that is no longer a directory handle is silently dropped.
  return stored.filter(
    (entry): entry is FileSystemDirectoryHandle => entry instanceof FileSystemDirectoryHandle,
  );
}

export async function storeDirectories(handles: readonly FileSystemDirectoryHandle[]): Promise<void> {
  if (handles.length === 0) {
    await del(STORE_KEY);
    return;
  }
  await set(STORE_KEY, [...handles]);
}
