import { useCallback, useState } from 'react';
import { Dock } from './dock';
import { cn } from '@/lib/utils';
import { useLayoutStore } from '@/store/layout-store';
import {
  DOCK_SIDES,
  PANEL_DRAG_TYPE,
  panelsIn,
  type DockSide,
  type PanelId,
} from '@/lib/layout';

interface DockFrameProps {
  readonly content: Readonly<Record<PanelId, React.ReactNode>>;
  /** The viewport, which takes whatever space the docks leave. */
  readonly children: React.ReactNode;
}

const ZONE_CLASSES: Readonly<Record<DockSide, string>> = {
  left: 'left-0 top-0 h-full w-1/4',
  right: 'right-0 top-0 h-full w-1/4',
  top: 'left-0 top-0 w-full h-1/4',
  bottom: 'left-0 bottom-0 w-full h-1/4',
};

const ZONE_LABELS: Readonly<Record<DockSide, string>> = {
  left: 'Dock panel to the left',
  right: 'Dock panel to the right',
  top: 'Dock panel to the top',
  bottom: 'Dock panel to the bottom',
};

/**
 * Arranges the docked panels around the viewport.
 *
 * Top and bottom span the full width and the side docks fill the band between
 * them, which keeps the viewport rectangular whatever the arrangement.
 */
export function DockFrame({ content, children }: DockFrameProps): React.JSX.Element {
  const layout = useLayoutStore((state) => state.layout);
  const move = useLayoutStore((state) => state.move);
  const toggle = useLayoutStore((state) => state.toggle);
  const resize = useLayoutStore((state) => state.resize);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<DockSide | null>(null);

  const onDrop = useCallback(
    (side: DockSide) =>
      (event: React.DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        const id = event.dataTransfer.getData(PANEL_DRAG_TYPE);
        const panel = (['folders', 'slide', 'pyramid', 'associated', 'metadata'] as const).find(
          (known) => known === id,
        );
        if (panel !== undefined) move(panel, side);
        setDragging(false);
        setHovered(null);
      },
    [move],
  );

  const dockFor = (side: DockSide): React.JSX.Element => (
    <Dock
      side={side}
      panels={panelsIn(layout, side)}
      size={layout.sizes[side]}
      collapsed={layout.collapsed}
      content={content}
      onToggle={toggle}
      onMove={move}
      onResize={(size): void => {
        resize(side, size);
      }}
      onDragStateChange={setDragging}
    />
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {dockFor('top')}

      <div className="flex min-h-0 flex-1">
        {dockFor('left')}
        <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
        {dockFor('right')}
      </div>

      {dockFor('bottom')}

      {/* Drop targets only exist mid-drag, so they never intercept a click. */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20">
          {DOCK_SIDES.map((side) => (
            // Drop targets exist only while a drag is in flight. Keyboard users
            // move panels through the "Move to" menu on each panel header, so
            // these never need to be reachable.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div
              key={side}
              aria-label={ZONE_LABELS[side]}
              onDragOver={(event): void => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setHovered(side);
              }}
              onDragLeave={(): void => {
                setHovered((current) => (current === side ? null : current));
              }}
              onDrop={onDrop(side)}
              className={cn(
                'pointer-events-auto absolute border-2 border-dashed transition-colors',
                ZONE_CLASSES[side],
                hovered === side
                  ? 'border-ring bg-ring/20'
                  : 'border-transparent bg-foreground/5',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
