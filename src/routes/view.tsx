import { useCallback, useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { FormatWarning } from '@/components/sidebar/format-warning';
import { useSlideStore } from '@/store/slide-store';
import { useSlide } from '@/hooks/use-slide';
import { SlideViewer } from '@/components/viewer/slide-viewer';
import { MetadataPanel } from '@/components/sidebar/metadata-panel';
import { parseViewSearch, type ViewSearch } from '@/lib/view-state';
import type { CameraChange } from '@/components/viewer/use-slide-map';

export const Route = createFileRoute('/view')({
  component: ViewPage,
  validateSearch: (search: Record<string, unknown>): ViewSearch => parseViewSearch(search),
});

/** Panning fires continuously; the URL is only worth rewriting once it settles. */
const CAMERA_WRITE_DELAY_MS = 250;

function ViewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const file = useSlideStore((state) => state.file);
  const { client, query } = useSlide(file);

  // Only the first search value is restored into the map; later ones are written
  // by the map itself, so re-reading them would fight the user. A lazy state
  // initialiser captures it without reading a ref during render.
  const [initialCamera] = useState(search);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const onCameraChange = useCallback(
    (camera: CameraChange): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // `replace` keeps panning out of the back-button history.
        void navigate({ to: '/view', search: camera, replace: true });
      }, CAMERA_WRITE_DELAY_MS);
    },
    [navigate],
  );

  // A `File` cannot survive a reload, so a direct visit has nothing to show.
  useEffect(() => {
    if (file === null) void navigate({ to: '/', replace: true });
  }, [file, navigate]);

  if (file === null) return <Centered>Redirecting…</Centered>;

  if (query.isPending) {
    return (
      <Centered>
        <Loader2Icon className="size-5 animate-spin" aria-hidden />
        <span>Reading {file.name}…</span>
      </Centered>
    );
  }

  if (query.isError) {
    return (
      <Centered>
        <TriangleAlertIcon className="size-5 text-destructive" aria-hidden />
        <span className="max-w-md text-center">{query.error.message}</span>
      </Centered>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-72 shrink-0 border-r md:block" aria-label="Slide details">
        <MetadataPanel model={query.data.model} fileName={file.name} />
      </aside>
      <div className="relative min-w-0 flex-1">
        <FormatWarning detection={query.data.detection} fileName={file.name} />
        {client !== null && (
          <SlideViewer
            model={query.data.model}
            client={client}
            camera={initialCamera}
            onCameraChange={onCameraChange}
          />
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
