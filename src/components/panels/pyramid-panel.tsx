import { Badge } from '@/components/ui/badge';
import { EmptyState } from './empty-state';
import type { SlideModel } from '@/lib/slide';

export function PyramidPanel({ model }: { readonly model: SlideModel | null }): React.JSX.Element {
  if (model === null) return <EmptyState>No slide open.</EmptyState>;

  return (
    <ul className="space-y-1 p-3">
      {model.levels.map((level) => (
        <li
          key={`${String(level.series)}:${String(level.resolution)}`}
          className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs"
        >
          <span className="truncate font-mono">
            {level.width.toLocaleString()} x {level.height.toLocaleString()}
          </span>
          <Badge variant="outline" className="shrink-0">
            {level.downsample === 1 ? '1x' : `${level.downsample.toFixed(0)}x down`}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
