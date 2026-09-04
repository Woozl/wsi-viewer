import { useCallback, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { FolderOpenIcon, ImageIcon, InfoIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useSlideStore } from '@/store/slide-store';
import { useDirectories } from '@/hooks/use-directories';
import { supportsDirectoryPicker } from '@/lib/fs-access';
import {
  ACCEPT_ATTRIBUTE,
  companionHint,
  isSupportedFile,
  needsCompanions,
  SUPPORTED_COUNT,
} from '@/lib/formats';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/')({ component: UploadPage });

function UploadPage(): React.JSX.Element {
  const navigate = useNavigate();
  const setFile = useSlideStore((state) => state.setFile);
  const directories = useDirectories();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<{ file: File; hint: string } | null>(null);
  const canPickFolders = supportsDirectoryPicker();

  const open = useCallback(
    (file: File): void => {
      if (!isSupportedFile(file.name)) {
        setIncomplete(null);
        setProblem(
          `"${file.name}" is not a format this viewer can read. It supports ` +
            `${String(SUPPORTED_COUNT)} extensions, including .svs, .scn, .oif and .czi.`,
        );
        return;
      }

      // The file input hands over one file with no way to reach its siblings,
      // so index formats are steered towards the folder picker instead of
      // failing to open for reasons the user cannot see.
      const hint = companionHint(file.name);
      if (needsCompanions(file.name) && hint !== null) {
        setProblem(null);
        setIncomplete({ file, hint });
        return;
      }

      setProblem(null);
      setIncomplete(null);
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

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 overflow-auto p-6">
      <div className="max-w-xl space-y-1.5 text-center">
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
          'flex w-full max-w-xl flex-col items-center gap-4 rounded-lg border-2 border-dashed p-10 transition-colors',
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
              Add folder
            </Button>
          )}
        </div>
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

      {incomplete !== null && (
        <div role="status" className="w-full max-w-xl space-y-3 rounded-md border bg-card p-4 text-sm">
          <div className="flex items-start gap-2">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">{incomplete.file.name} needs the files stored beside it</p>
              <p className="text-muted-foreground">{incomplete.hint}</p>
              <p className="text-muted-foreground">
                Add its containing folder, then open the slide from the Folders panel so the data
                folder can be found automatically.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canPickFolders ? (
              <Button
                size="sm"
                onClick={(): void => {
                  setIncomplete(null);
                  void directories.add();
                }}
              >
                <FolderOpenIcon />
                Add the containing folder
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                This browser cannot open folders, so this format needs Chrome or Edge.
              </p>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={(): void => {
                const file = incomplete.file;
                setIncomplete(null);
                setFile(file);
                void navigate({ to: '/view' });
              }}
            >
              Open without them
            </Button>
          </div>
        </div>
      )}

      {problem !== null && (
        <div
          role="alert"
          className="flex w-full max-w-xl items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <p>{problem}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Badge variant="outline">{SUPPORTED_COUNT} formats supported</Badge>
        <Separator orientation="vertical" className="h-4" />
        <span className="text-xs text-muted-foreground">Reads run locally in WebAssembly</span>
      </div>
    </div>
  );
}
