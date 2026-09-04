import { useMemo } from 'react';
import { EmptyState } from './empty-state';
import type { SlideModel } from '@/lib/slide';

export function FormatMetadataPanel({
  model,
}: {
  readonly model: SlideModel | null;
}): React.JSX.Element {
  // Aperio and friends pack a pipe-delimited blob into ImageDescription; the
  // parsed pairs are far more readable than the raw string.
  const entries = useMemo(() => {
    const source = model?.series[0]?.metadata ?? {};
    const parsed = new Map<string, string>();
    for (const [key, value] of Object.entries(source)) {
      if (key === 'ImageDescription' && value.includes('|')) {
        for (const part of value.split('|')) {
          const split = part.indexOf('=');
          if (split > 0) parsed.set(part.slice(0, split).trim(), part.slice(split + 1).trim());
        }
        continue;
      }
      parsed.set(key, value);
    }
    return [...parsed.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [model]);

  if (model === null) return <EmptyState>No slide open.</EmptyState>;
  if (entries.length === 0) return <EmptyState>This format reports no metadata.</EmptyState>;

  return (
    <dl className="space-y-1.5 p-3 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="grid min-w-0 grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-2">
          <dt className="truncate text-muted-foreground" title={key}>
            {key}
          </dt>
          {/* Values such as OME-XML have no spaces to break on. */}
          <dd className="min-w-0 break-all font-mono text-[11px]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
