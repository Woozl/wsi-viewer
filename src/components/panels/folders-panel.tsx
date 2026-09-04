import { useCallback, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FolderPlusIcon, InfoIcon, Loader2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DirectoryTree } from '@/components/sidebar/directory-tree';
import { useDirectories } from '@/hooks/use-directories';
import { useSlideStore } from '@/store/slide-store';
import { collectCompanions, findCompanionDirectory, supportsDirectoryPicker } from '@/lib/fs-access';
import { companionHint, needsCompanions } from '@/lib/formats';

/** A slide waiting for the user to point at its data folder. */
interface AwaitingFolder {
  readonly file: File;
  readonly parent: FileSystemDirectoryHandle;
  readonly hint: string;
}

export function FoldersPanel(): React.JSX.Element {
  const navigate = useNavigate();
  const setFile = useSlideStore((state) => state.setFile);
  const directories = useDirectories();
  const [awaiting, setAwaiting] = useState<AwaitingFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const canPick = supportsDirectoryPicker();

  const openWith = useCallback(
    (file: File, companions: ReadonlyMap<string, File>): void => {
      setAwaiting(null);
      setFile(file, companions);
      void navigate({ to: '/view' });
    },
    [navigate, setFile],
  );

  const onOpenFile = useCallback(
    (file: File, parent: FileSystemDirectoryHandle | null): void => {
      if (parent === null || !needsCompanions(file.name)) {
        openWith(file, new Map());
        return;
      }
      setBusy(true);
      void (async (): Promise<void> => {
        try {
          // Match the data folder by name first; that covers every export that
          // follows one of the usual conventions.
          const found = await findCompanionDirectory(parent, file.name);
          if (found === null) {
            setAwaiting({
              file,
              parent,
              hint: companionHint(file.name) ?? 'This format stores its data in a separate folder.',
            });
            return;
          }
          openWith(file, await collectCompanions(parent, file.name, found));
        } finally {
          setBusy(false);
        }
      })();
    },
    [openWith],
  );

  const onChooseFolder = useCallback(
    (handle: FileSystemDirectoryHandle): void => {
      if (awaiting === null) return;
      setBusy(true);
      void (async (): Promise<void> => {
        try {
          openWith(
            awaiting.file,
            await collectCompanions(awaiting.parent, awaiting.file.name, handle),
          );
        } finally {
          setBusy(false);
        }
      })();
    },
    [awaiting, openWith],
  );

  const hasFolders = directories.granted.length > 0 || directories.pending.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-full justify-start gap-1.5 text-xs"
          disabled={!canPick}
          onClick={(): void => {
            void directories.add();
          }}
        >
          <FolderPlusIcon className="size-3.5" />
          Add folder
        </Button>
        {!canPick && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Opening folders needs the File System Access API. Chrome and Edge support it.
          </p>
        )}
      </div>

      {awaiting !== null && (
        <div role="status" className="space-y-2 border-b bg-muted/40 p-2 text-[11px]">
          <div className="flex items-start gap-1.5">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">
                Pick the data folder for {awaiting.file.name}
              </p>
              <p className="text-muted-foreground">{awaiting.hint}</p>
              <p className="text-muted-foreground">
                No folder beside it matched the expected name, so choose it in the tree below.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-full text-[11px]"
            onClick={(): void => {
              setAwaiting(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {busy && (
        <p className="flex items-center gap-1.5 border-b p-2 text-[11px] text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" aria-hidden />
          Gathering the slide&apos;s files…
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {directories.pending.map((handle) => (
          <div key={handle.name} className="mb-2 space-y-1 rounded-md bg-muted/50 p-2">
            <p className="truncate text-xs font-medium">{handle.name}</p>
            <p className="text-[11px] text-muted-foreground">
              Access needs granting again after a reload.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full text-xs"
              onClick={(): void => {
                void directories.restore(handle);
              }}
            >
              Restore access
            </Button>
          </div>
        ))}

        {directories.granted.length > 0 ? (
          <DirectoryTree
            roots={directories.granted}
            onOpenFile={onOpenFile}
            choosingFolderFor={awaiting?.file.name ?? null}
            onChooseFolder={onChooseFolder}
          />
        ) : (
          !hasFolders && (
            <p className="p-1 text-xs text-muted-foreground">
              Add a folder to browse slides without picking files one at a time.
            </p>
          )
        )}
      </div>

      {directories.granted.length > 0 && (
        <div className="border-t p-1.5">
          {directories.granted.map((handle) => (
            <div key={handle.name} className="flex items-center gap-1 text-[11px]">
              <span className="truncate text-muted-foreground">{handle.name}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto size-5 shrink-0"
                aria-label={`Remove ${handle.name}`}
                onClick={(): void => {
                  directories.remove(handle);
                }}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
