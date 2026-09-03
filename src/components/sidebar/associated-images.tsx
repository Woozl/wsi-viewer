import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import type { SeriesInfo } from '@/lib/slide';
import type { SlideClient } from '@/lib/wasm/client';

/** Longest edge requested for a sidebar preview. */
const THUMBNAIL_SIZE = 256;

interface AssociatedImagesProps {
  readonly series: readonly SeriesInfo[];
  readonly client: SlideClient;
  readonly slideKey: string;
}

/**
 * Label and macro photographs that accompany a slide.
 *
 * These are the series whose shape does not match the specimen scan, so they
 * are never part of the pyramid. They are small enough to decode whole.
 */
export function AssociatedImages({
  series,
  client,
  slideKey,
}: AssociatedImagesProps): React.JSX.Element | null {
  if (series.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Associated images
      </h2>
      <ul className="space-y-2">
        {series.map((info) => (
          <li key={info.series} className="space-y-1">
            <AssociatedImage info={info} client={client} slideKey={slideKey} />
            <p className="text-[11px] text-muted-foreground">
              Series {info.series} — {info.width.toLocaleString()} x{' '}
              {info.height.toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AssociatedImage({
  info,
  client,
  slideKey,
}: {
  readonly info: SeriesInfo;
  readonly client: SlideClient;
  readonly slideKey: string;
}): React.JSX.Element {
  const query = useQuery({
    queryKey: ['associated', slideKey, info.series],
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<ImageBitmap | null> =>
      client.thumbnail(info.series, THUMBNAIL_SIZE),
  });

  if (query.isPending) return <Skeleton className="aspect-[4/3] w-full" />;
  if (query.isError || query.data === null) {
    return (
      <p className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
        This image could not be decoded.
      </p>
    );
  }

  return <BitmapCanvas bitmap={query.data} label={`Series ${String(info.series)} preview`} />;
}

/**
 * An `ImageBitmap` cannot be handed to `<img>`, so it is painted into a canvas.
 *
 * Painting happens in the ref callback rather than an effect, which keeps the
 * element out of component state and runs as soon as the node exists. The bitmap
 * is closed on unmount to release its backing memory promptly.
 */
function BitmapCanvas({
  bitmap,
  label,
}: {
  readonly bitmap: ImageBitmap;
  readonly label: string;
}): React.JSX.Element {
  const paint = useCallback(
    (node: HTMLCanvasElement | null): void => {
      if (node === null) return;
      node.width = bitmap.width;
      node.height = bitmap.height;
      node.getContext('2d')?.drawImage(bitmap, 0, 0);
    },
    [bitmap],
  );

  useEffect(
    () => (): void => {
      bitmap.close();
    },
    [bitmap],
  );

  return (
    // The role and label sit on a wrapper: a canvas is an interactive element,
    // so giving it role="img" directly is invalid.
    <span role="img" aria-label={label} className="block">
      <canvas ref={paint} aria-hidden className="w-full rounded-md border bg-muted" />
    </span>
  );
}
