import { EyeIcon, EyeOffIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { EmptyState } from './empty-state';
import { useChannelStore } from '@/store/channel-store';
import { hexToRgb, rgbToHex, type ChannelSettings, type DisplaySettings } from '@/lib/channels';
import { cn } from '@/lib/utils';

interface ChannelsPanelProps {
  readonly display: DisplaySettings;
  /** Largest value a sample can hold, which bounds the window sliders. */
  readonly ceiling: number;
  readonly hasSlide: boolean;
}

const GAMMA_MIN = 0.1;
const GAMMA_MAX = 3;

export function ChannelsPanel({
  display,
  ceiling,
  hasSlide,
}: ChannelsPanelProps): React.JSX.Element {
  const updateChannel = useChannelStore((state) => state.updateChannel);
  const updateBrightfield = useChannelStore((state) => state.updateBrightfield);
  const reset = useChannelStore((state) => state.reset);

  if (!hasSlide) return <EmptyState>No slide open.</EmptyState>;

  if (display.mode === 'brightfield') {
    const { min, max, gamma } = display.brightfield;
    return (
      <div className="space-y-3 p-3">
        <p className="text-[11px] text-muted-foreground">
          This slide is brightfield: its colour channels are already combined, so the whole image
          is adjusted together.
        </p>
        <Adjustment
          label="Range"
          value={[min, max]}
          min={0}
          max={1}
          step={0.01}
          format={(value): string => value.toFixed(2)}
          onChange={([low, high]): void => {
            updateBrightfield({ min: low ?? 0, max: high ?? 1 });
          }}
        />
        <Adjustment
          label="Gamma"
          value={[gamma]}
          min={GAMMA_MIN}
          max={GAMMA_MAX}
          step={0.05}
          format={(value): string => value.toFixed(2)}
          onChange={([value]): void => {
            updateBrightfield({ gamma: value ?? 1 });
          }}
        />
        <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={reset}>
          <RotateCcwIcon className="size-3" />
          Reset
        </Button>
      </div>
    );
  }

  if (display.channels.length === 0) {
    return <EmptyState>Reading channels…</EmptyState>;
  }

  return (
    <div className="space-y-3 p-3">
      {display.channels.map((channel) => (
        <ChannelRow
          key={channel.index}
          channel={channel}
          ceiling={ceiling}
          onChange={(patch): void => {
            updateChannel(channel.index, patch);
          }}
        />
      ))}
      <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={reset}>
        <RotateCcwIcon className="size-3" />
        Reset all channels
      </Button>
    </div>
  );
}

function ChannelRow({
  channel,
  ceiling,
  onChange,
}: {
  readonly channel: ChannelSettings;
  readonly ceiling: number;
  readonly onChange: (patch: Partial<ChannelSettings>) => void;
}): React.JSX.Element {
  const hex = rgbToHex(channel.color);

  return (
    <div className={cn('space-y-2 rounded-md border p-2', !channel.visible && 'opacity-60')}>
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-5"
          aria-pressed={channel.visible}
          aria-label={channel.visible ? `Hide ${channel.label}` : `Show ${channel.label}`}
          onClick={(): void => {
            onChange({ visible: !channel.visible });
          }}
        >
          {channel.visible ? <EyeIcon className="size-3" /> : <EyeOffIcon className="size-3" />}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{channel.label}</span>
        <input
          type="color"
          value={hex}
          aria-label={`Colour for ${channel.label}`}
          className="size-5 shrink-0 cursor-pointer rounded border bg-transparent p-0"
          onChange={(event): void => {
            const parsed = hexToRgb(event.target.value);
            if (parsed !== null) onChange({ color: parsed });
          }}
        />
      </div>

      <Adjustment
        label="Range"
        value={[channel.min, channel.max]}
        min={0}
        max={ceiling}
        step={Math.max(1, Math.round(ceiling / 1024))}
        format={(value): string => String(Math.round(value))}
        onChange={([low, high]): void => {
          onChange({ min: low ?? 0, max: high ?? ceiling });
        }}
      />
      <Adjustment
        label="Gamma"
        value={[channel.gamma]}
        min={GAMMA_MIN}
        max={GAMMA_MAX}
        step={0.05}
        format={(value): string => value.toFixed(2)}
        onChange={([value]): void => {
          onChange({ gamma: value ?? 1 });
        }}
      />
    </div>
  );
}

function Adjustment({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  readonly label: string;
  readonly value: readonly number[];
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
  readonly onChange: (value: number[]) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{value.map(format).join(' – ')}</span>
      </div>
      <Slider
        value={[...value]}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onValueChange={onChange}
      />
    </div>
  );
}
