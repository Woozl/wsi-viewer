import { Fragment } from 'react';
import { Panel } from './panel';
import { ResizeHandle } from './resize-handle';
import { cn } from '@/lib/utils';
import type { DropTarget } from './use-panel-drag';
import type { DockSide, PanelId } from '@/lib/layout';

interface DockProps {
  readonly side: DockSide;
  readonly panels: readonly PanelId[];
  readonly size: number;
  readonly collapsed: Readonly<Record<PanelId, boolean>>;
  readonly content: Readonly<Record<PanelId, React.ReactNode>>;
  readonly draggingPanel: PanelId | null;
  readonly dropTarget: DropTarget | null;
  readonly onToggle: (panel: PanelId) => void;
  readonly onMove: (panel: PanelId, side: DockSide) => void;
  readonly onResize: (size: number) => void;
  readonly onDragStart: (panel: PanelId, event: React.PointerEvent) => void;
}

/** Whether the resize handle sits before or after the dock in DOM order. */
const HANDLE_AFTER: Readonly<Record<DockSide, boolean>> = {
  left: true,
  top: true,
  right: false,
  bottom: false,
};

/** Marks where a released panel would be inserted. */
function DropLine({ vertical }: { readonly vertical: boolean }): React.JSX.Element {
  return (
    <div
      aria-hidden
      className={cn('shrink-0 rounded-full bg-ring', vertical ? 'h-0.5 w-full' : 'h-full w-0.5')}
    />
  );
}

/** A stack of panels along one edge, with the divider that resizes it. */
export function Dock({
  side,
  panels,
  size,
  collapsed,
  content,
  draggingPanel,
  dropTarget,
  onToggle,
  onMove,
  onResize,
  onDragStart,
}: DockProps): React.JSX.Element | null {
  if (panels.length === 0) return null;

  const vertical = side === 'left' || side === 'right';
  const handle = <ResizeHandle side={side} size={size} onResize={onResize} />;
  const showDrop = dropTarget !== null && dropTarget.side === side;

  const body = (
    <div
      data-dock-side={side}
      className={cn(
        'flex min-h-0 min-w-0 shrink-0 flex-col overflow-auto bg-card',
        vertical ? 'h-full' : 'w-full',
      )}
      style={vertical ? { width: size } : { height: size }}
    >
      {panels.map((id) => (
        <Fragment key={id}>
          {showDrop && dropTarget.before === id && <DropLine vertical={vertical} />}
          <Panel
            id={id}
            side={side}
            collapsed={collapsed[id]}
            dragging={draggingPanel === id}
            onToggle={(): void => {
              onToggle(id);
            }}
            onMove={(target): void => {
              onMove(id, target);
            }}
            onDragStart={(event): void => {
              onDragStart(id, event);
            }}
          >
            {content[id]}
          </Panel>
        </Fragment>
      ))}
      {showDrop && dropTarget.before === null && <DropLine vertical={vertical} />}
    </div>
  );

  return (
    <>
      {HANDLE_AFTER[side] ? body : handle}
      {HANDLE_AFTER[side] ? handle : body}
    </>
  );
}
