import { useState } from 'react';
import { InfoIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { extensionOf } from '@/lib/formats';
import { formatNotice } from '@/lib/detection';
import { cn } from '@/lib/utils';
import type { DetectResult } from '@/lib/wasm/protocol';

interface FormatWarningProps {
  readonly detection: DetectResult;
  readonly fileName: string;
}

/**
 * Surfaces a header sanity check. Advisory only: the slide has already opened by
 * the time this renders, so it explains an oddity rather than blocking anything.
 */
export function FormatWarning({
  detection,
  fileName,
}: FormatWarningProps): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const notice = formatNotice(detection, extensionOf(fileName));
  if (dismissed || notice === null) return null;

  const Icon = notice.tone === 'warning' ? TriangleAlertIcon : InfoIcon;

  return (
    <div
      role="status"
      className={cn(
        'absolute inset-x-3 top-3 z-10 flex items-start gap-2 rounded-md border bg-card/95 p-3 text-sm shadow-sm backdrop-blur',
        notice.tone === 'warning' ? 'border-warning/50' : 'border-border',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          notice.tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <p className="min-w-0 flex-1">{notice.message}</p>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss format notice"
        onClick={(): void => {
          setDismissed(true);
        }}
      >
        <XIcon />
      </Button>
    </div>
  );
}
