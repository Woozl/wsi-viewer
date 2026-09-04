import { Panel } from './panel';
import { ResizeHandle } from './resize-handle';
import { cn } from '@/lib/utils';
import type { DockSide, PanelId } from '@/lib/layout';

interface DockProps {
  readonly side: DockSide;
  readonly panels: readonly PanelId[];
  readonly size: number;
  readonly collapsed: Readonly<Record<PanelId, boolean>>;
  readonly content: Readonly<Record<PanelId, React.ReactNode>>;
  readonly onToggle: (panel: PanelId) => void;
  readonly onMove: (panel: PanelId, side: DockSide) => void;
  readonly onResize: (size: number) => void;
  readonly onDragStateChange: (dragging: boolean) => void;
}

/** Whether the resize handle sits before or after the dock in DOM order. */
const HANDLE_AFTER: Readonly<Record<DockSide, boolean>> = {
  left: true,
  top: true,
  right: false,
  bottom: false,
};

/** A stack of panels along one edge, with the divider that resizes it. */
export function Dock({
  side,
  panels,
  size,
  collapsed,
  content,
  onToggle,
  onMove,
  onResize,
  onDragStateChange,
}: DockProps): React.JSX.Element | null {
  if (panels.length === 0) return null;

  const vertical = side === 'left' || side === 'right';
  const handle = <ResizeHandle side={side} size={size} onResize={onResize} />;

  const body = (
    <div
      className={cn('flex min-h-0 min-w-0 shrink-0 flex-col overflow-auto bg-card', vertical ? 'h-full' : 'w-full')}
      style={vertical ? { width: size } : { height: size }}
    >
      {panels.map((id) => (
        <Panel
          key={id}
          id={id}
          side={side}
          collapsed={collapsed[id]}
          onToggle={(): void => {
            onToggle(id);
          }}
          onMove={(target): void => {
            onMove(id, target);
          }}
          onDragStateChange={onDragStateChange}
        >
          {content[id]}
        </Panel>
      ))}
    </div>
  );

  return (
    <>
      {HANDLE_AFTER[side] ? body : handle}
      {HANDLE_AFTER[side] ? handle : body}
    </>
  );
}
