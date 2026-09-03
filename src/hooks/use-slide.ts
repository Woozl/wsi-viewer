/**
 * Opens a slide and exposes its reconstructed pyramid.
 *
 * The worker is created *inside* the effect that tears it down, so creation and
 * disposal are always paired. Creating it in `useMemo` instead would break under
 * StrictMode's mount/unmount/remount cycle: the cleanup would terminate the
 * worker while the memo still handed the same dead instance to the remount.
 */
import { useEffect, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { SlideClient } from '@/lib/wasm/client';
import { buildSlideModel, type SlideModel } from '@/lib/slide';

export function slideKey(file: File): readonly unknown[] {
  return ['slide', file.name, file.size, file.lastModified];
}

export function useSlide(file: File | null): {
  client: SlideClient | null;
  query: UseQueryResult<SlideModel>;
} {
  const [client, setClient] = useState<SlideClient | null>(null);

  useEffect(() => {
    if (file === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see note below
      setClient(null);
      return;
    }
    const next = new SlideClient();
    // A worker is an external resource whose creation and disposal must stay
    // paired, which means it has to be built inside the effect and published to
    // state from there. Creating it during render or in a lazy `useState`
    // initialiser would survive StrictMode's cleanup and hand the remount an
    // already-terminated worker.
    setClient(next);
    return (): void => {
      next.close();
      setClient((current) => (current === next ? null : current));
    };
  }, [file]);

  const query = useQuery({
    // Keyed on the client's stable id, never the client itself: a remount must
    // reopen against the live worker, but putting the mutable instance in the
    // key makes its request counter part of the hash and refetches forever.
    queryKey: file === null ? ['slide', 'none'] : [...slideKey(file), client?.id ?? null],
    enabled: file !== null && client !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<SlideModel> => {
      if (file === null || client === null) throw new Error('no slide selected');
      const { series, tilings } = await client.open(file);
      return buildSlideModel(series, tilings);
    },
  });

  return { client, query };
}
