import { useCallback, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { FolderOpenIcon, ImageIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSlideStore } from '@/store/slide-store';
import { ACCEPT_ATTRIBUTE, companionHint, isSupportedFile, SUPPORTED_COUNT } from '@/lib/formats';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/')({ component: UploadPage });

function UploadPage(): React.JSX.Element {
  const navigate = useNavigate();
  const setFile = useSlideStore((state) => state.setFile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const accept = useCallback(
    (file: File): void => {
      if (!isSupportedFile(file.name)) {
        setProblem(
          `"${file.name}" is not a format this viewer can read. ` +
            `It supports ${String(SUPPORTED_COUNT)} extensions, including .svs, .ndpi, .scn and .czi.`,
        );
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
      if (file !== null) accept(file);
    },
    [accept],
  );

  const hint = problem === null ? null : companionHint(problem);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 p-6">
      <div className="space-y-1.5 text-center">
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
          'flex w-full flex-col items-center gap-4 rounded-lg border-2 border-dashed p-10 transition-colors',
          dragging ? 'border-ring bg-accent/40' : 'border-border',
        )}
      >
        <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">Drag a slide here, or</p>
        <div className="flex gap-2">
          <Button
            onClick={(): void => {
              inputRef.current?.click();
            }}
          >
            <UploadIcon />
            Choose file
          </Button>
          <Button variant="outline" disabled>
            <FolderOpenIcon />
            Open folder
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          aria-label="Choose a whole-slide image"
          onChange={(event): void => {
            const file = event.target.files?.item(0);
            if (file !== null && file !== undefined) accept(file);
            event.target.value = '';
          }}
        />
      </div>

      {problem !== null && (
        <div
          role="alert"
          className="flex w-full items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="space-y-1">
            <p>{problem}</p>
            {hint !== null && <p className="text-muted-foreground">{hint}</p>}
          </div>
        </div>
      )}

      <Badge variant="outline">{SUPPORTED_COUNT} formats supported</Badge>
    </div>
  );
}
