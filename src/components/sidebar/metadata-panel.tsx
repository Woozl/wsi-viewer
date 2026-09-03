import { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { SlideModel } from '@/lib/slide';

interface MetadataPanelProps {
  readonly model: SlideModel;
  readonly fileName: string;
}

function formatPixels(value: number): string {
  return value.toLocaleString();
}

/** Renders a megapixel count in the units pathologists actually use. */
function describeSize(width: number, height: number): string {
  const gigapixels = (width * height) / 1e9;
  return gigapixels >= 1
    ? `${gigapixels.toFixed(2)} gigapixels`
    : `${((width * height) / 1e6).toFixed(0)} megapixels`;
}

export function MetadataPanel({ model, fileName }: MetadataPanelProps): React.JSX.Element {
  const base = model.series[0];

  // Aperio and friends pack a pipe-delimited blob into ImageDescription; the raw
  // value is kept but the parsed pairs are far more readable.
  const entries = useMemo(() => {
    const source = base?.metadata ?? {};
    const parsed = new Map<string, string>();
    for (const [key, value] of Object.entries(source)) {
      if (key === 'ImageDescription' && value.includes('|')) {
        for (const part of value.split('|')) {
          const split = part.indexOf('=');
          if (split > 0) {
            parsed.set(part.slice(0, split).trim(), part.slice(split + 1).trim());
          }
        }
        continue;
      }
      parsed.set(key, value);
    }
    return [...parsed.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [base]);

  // `min-w-0` is applied throughout: OME-XML arrives as one very long unbroken
  // string, which would otherwise stretch the grid and push the panel's content
  // out of view instead of wrapping.
  return (
    <ScrollArea className="h-full w-full">
      <div className="w-full min-w-0 space-y-4 p-3">
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Slide
          </h2>
          <p className="break-all text-sm font-medium">{fileName}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
            <Field
              label="Dimensions"
              value={`${formatPixels(model.width)} x ${formatPixels(model.height)}`}
            />
            <Field label="Size" value={describeSize(model.width, model.height)} />
            <Field label="Pyramid levels" value={String(model.levels.length)} />
            <Field label="Pixel type" value={base?.pixelType ?? 'unknown'} />
          </dl>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pyramid
          </h2>
          <ul className="space-y-1">
            {model.levels.map((level) => (
              <li
                key={level.series}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs"
              >
                <span className="truncate font-mono">
                  {formatPixels(level.width)} x {formatPixels(level.height)}
                </span>
                <Badge variant="outline" className="shrink-0">
                  {level.downsample === 1 ? '1x' : `${level.downsample.toFixed(0)}x down`}
                </Badge>
              </li>
            ))}
          </ul>
        </section>

        {entries.length > 0 && (
          <>
            <Separator />
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Format metadata
              </h2>
              <dl className="space-y-1.5 text-xs">
                {entries.map(([key, value]) => (
                  <div
                    key={key}
                    className="grid min-w-0 grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-2"
                  >
                    <dt className="truncate text-muted-foreground" title={key}>
                      {key}
                    </dt>
                    {/* Values such as OME-XML have no spaces to break on. */}
                    <dd className="min-w-0 break-all font-mono text-[11px]">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </>
  );
}
