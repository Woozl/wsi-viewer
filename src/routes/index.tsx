import { useCallback, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { FolderOpenIcon, ImageIcon, TriangleAlertIcon, UploadIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DirectoryTree } from '@/components/sidebar/directory-tree';
import { useDirectories } from '@/hooks/use-directories';
import { useSlideStore } from '@/store/slide-store';
import { supportsDirectoryPicker } from '@/lib/fs-access';
import { ACCEPT_ATTRIBUTE, companionHint, isSupportedFile, SUPPORTED_COUNT } from '@/lib/formats';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/')({ component: UploadPage });

function UploadPage(): React.JSX.Element {
  const navigate = useNavigate();
  const setFile = useSlideStore((state) => state.setFile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<{ message: string; hint: string | null } | null>(null);
  const directories = useDirectories();
  const canPickFolders = supportsDirectoryPicker();

  const open = useCallback(
    (file: File): void => {
      if (!isSupportedFile(file.name)) {
        setProblem({
          message:
            `"${file.name}" is not a format this viewer can read. It supports ` +
            `${String(SUPPORTED_COUNT)} extensions, including .svs, .scn, .czi and .tif.`,
          hint: companionHint(file.name),
        });
        return;
      }
      setProblem(null);
      setFile(file);
      void navigate({ to: '/view' });
    },
    [navigate, setFile],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files.item(0);
      if (file !== null) open(file);
    },
    [open],
  );

  const showTree = directories.granted.length > 0 || directories.pending.length > 0;

  return (
    <div className="flex h-full">
      {showTree && (
        <aside className="hidden w-64 shrink-0 border-r md:flex md:flex-col" aria-label="Slide folders">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Folders
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add a folder"
              onClick={(): void => {
                void directories.add();
              }}
            >
              <FolderOpenIcon />
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-2">
              {directories.pending.map((handle) => (
                <div key={handle.name} className="space-y-1 rounded-md bg-muted/50 p-2">
                  <p className="truncate text-xs font-medium">{handle.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Access needs to be granted again after a reload.
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
              {directories.granted.length > 0 && (
                <DirectoryTree roots={directories.granted} onOpenFile={open} />
              )}
            </div>
          </ScrollArea>
          {directories.granted.length > 0 && (
            <div className="border-t p-2">
              {directories.granted.map((handle) => (
                <div key={handle.name} className="flex items-center gap-1 text-[11px]">
                  <span className="truncate text-muted-foreground">{handle.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto size-6"
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
        </aside>
      )}

      <div className="mx-auto flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="max-w-2xl space-y-1.5 text-center">
          <h2 className="text-xl font-semibold">Open a whole-slide image</h2>
          <p className="text-sm text-muted-foreground">
            Slides are read entirely in your browser. Nothing is uploaded to a server.
          </p>
        </div>

        {/* Drag and drop is a pointer-only enhancement: the same action is fully
            available from the keyboard via the "Choose file" button below, so this
            element deliberately carries no interactive role. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          onDragOver={(event): void => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(): void => {
            setDragging(false);
          }}
          onDrop={onDrop}
          className={cn(
            'flex w-full max-w-2xl flex-col items-center gap-4 rounded-lg border-2 border-dashed p-10 transition-colors',
            dragging ? 'border-ring bg-accent/40' : 'border-border',
          )}
        >
          <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Drag a slide here, or</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              onClick={(): void => {
                inputRef.current?.click();
              }}
            >
              <UploadIcon />
              Choose file
            </Button>
            {canPickFolders && (
              <Button
                variant="outline"
                onClick={(): void => {
                  void directories.add();
                }}
              >
                <FolderOpenIcon />
                Open folder
              </Button>
            )}
          </div>
          {!canPickFolders && (
            <p className="text-center text-xs text-muted-foreground">
              Opening a whole folder needs the File System Access API, which this browser
              doesn&apos;t support. Chrome and Edge do.
            </p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            aria-label="Choose a whole-slide image"
            onChange={(event): void => {
              const file = event.target.files?.item(0) ?? null;
              if (file !== null) open(file);
              event.target.value = '';
            }}
          />
        </div>

        {problem !== null && (
          <div
            role="alert"
            className="flex w-full max-w-2xl items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div className="space-y-1">
              <p>{problem.message}</p>
              {problem.hint !== null && (
                <p className="text-muted-foreground">{problem.hint}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Badge variant="outline">{SUPPORTED_COUNT} formats supported</Badge>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-xs text-muted-foreground">Reads run locally in WebAssembly</span>
        </div>
      </div>
    </div>
  );
}
