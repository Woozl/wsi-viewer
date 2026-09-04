import { EmptyState } from './empty-state';
import type { SlideModel } from '@/lib/slide';

interface SlidePanelProps {
  readonly model: SlideModel | null;
  readonly fileName: string | null;
}

/** Renders a pixel count in the units pathologists actually use. */
function describeSize(width: number, height: number): string {
  const gigapixels = (width * height) / 1e9;
  return gigapixels >= 1
    ? `${gigapixels.toFixed(2)} gigapixels`
    : `${((width * height) / 1e6).toFixed(0)} megapixels`;
}

export function SlidePanel({ model, fileName }: SlidePanelProps): React.JSX.Element {
  if (model === null || fileName === null) return <EmptyState>No slide open.</EmptyState>;

  const base = model.series[0];

  return (
    <div className="space-y-2 p-3">
      <p className="break-all text-sm font-medium">{fileName}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <Field
          label="Dimensions"
          value={`${model.width.toLocaleString()} x ${model.height.toLocaleString()}`}
        />
        <Field label="Size" value={describeSize(model.width, model.height)} />
        <Field label="Pyramid levels" value={String(model.levels.length)} />
        <Field label="Pixel type" value={base?.pixelType ?? 'unknown'} />
        <Field label="Series" value={String(model.series.length)} />
      </dl>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </>
  );
}
