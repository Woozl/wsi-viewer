/**
 * Folders the user has granted access to.
 *
 * Handles persist in IndexedDB, but their permission grant does not: on a new
 * visit the browser reports `prompt` and only restores access from a user
 * gesture. Stored folders are therefore listed immediately and re-authorised on
 * click, rather than silently on load.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  hasPermission,
  loadStoredDirectories,
  pickDirectory,
  requestPermission,
  storeDirectories,
} from '@/lib/fs-access';

export interface DirectoriesState {
  /** Folders readable right now. */
  readonly granted: readonly FileSystemDirectoryHandle[];
  /** Remembered folders still awaiting a permission prompt. */
  readonly pending: readonly FileSystemDirectoryHandle[];
  readonly add: () => Promise<void>;
  readonly restore: (handle: FileSystemDirectoryHandle) => Promise<void>;
  readonly remove: (handle: FileSystemDirectoryHandle) => void;
}

export function useDirectories(): DirectoriesState {
  const [granted, setGranted] = useState<readonly FileSystemDirectoryHandle[]>([]);
  const [pending, setPending] = useState<readonly FileSystemDirectoryHandle[]>([]);

  useEffect(() => {
    // An AbortController rather than a captured boolean: TypeScript cannot see
    // the cleanup's write to a closed-over flag and narrows the guard away.
    const controller = new AbortController();
    void (async (): Promise<void> => {
      const stored = await loadStoredDirectories();
      const checks = await Promise.all(stored.map(async (handle) => hasPermission(handle)));
      if (controller.signal.aborted) return;
      setGranted(stored.filter((_, index) => checks[index] === true));
      setPending(stored.filter((_, index) => checks[index] !== true));
    })();
    return (): void => {
      controller.abort();
    };
  }, []);

  const persist = useCallback(
    async (next: readonly FileSystemDirectoryHandle[], stillPending: readonly FileSystemDirectoryHandle[]) => {
      await storeDirectories([...next, ...stillPending]);
    },
    [],
  );

  const add = useCallback(async (): Promise<void> => {
    const handle = await pickDirectory();
    if (handle === null) return;
    setGranted((current) => {
      // `isSameEntry` is async, so identity plus name is the practical guard
      // against listing the same folder twice.
      if (current.some((entry) => entry.name === handle.name)) return current;
      const next = [...current, handle];
      void persist(next, pending);
      return next;
    });
  }, [pending, persist]);

  const restore = useCallback(
    async (handle: FileSystemDirectoryHandle): Promise<void> => {
      if (!(await requestPermission(handle))) return;
      setPending((currentPending) => {
        const nextPending = currentPending.filter((entry) => entry !== handle);
        setGranted((current) => {
          const next = [...current, handle];
          void persist(next, nextPending);
          return next;
        });
        return nextPending;
      });
    },
    [persist],
  );

  const remove = useCallback(
    (handle: FileSystemDirectoryHandle): void => {
      setGranted((current) => {
        const next = current.filter((entry) => entry !== handle);
        void persist(
          next,
          pending.filter((entry) => entry !== handle),
        );
        return next;
      });
      setPending((current) => current.filter((entry) => entry !== handle));
    },
    [pending, persist],
  );

  return { granted, pending, add, restore, remove };
}
