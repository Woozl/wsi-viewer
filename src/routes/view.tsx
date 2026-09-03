import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { useSlideStore } from '@/store/slide-store';
import { useSlide } from '@/hooks/use-slide';
import { SlideViewer } from '@/components/viewer/slide-viewer';
import { MetadataPanel } from '@/components/sidebar/metadata-panel';

export const Route = createFileRoute('/view')({ component: ViewPage });

function ViewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const file = useSlideStore((state) => state.file);
  const { client, query } = useSlide(file);

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
        <MetadataPanel model={query.data} fileName={file.name} />
      </aside>
      <div className="min-w-0 flex-1">
        {client !== null && <SlideViewer model={query.data} client={client} />}
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
