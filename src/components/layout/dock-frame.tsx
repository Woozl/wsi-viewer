import { useCallback } from 'react';
import { Dock } from './dock';
import { usePanelDrag } from './use-panel-drag';
import { cn } from '@/lib/utils';
import { useLayoutStore } from '@/store/layout-store';
import { panelsIn, PANEL_TITLES, type DockSide, type PanelId } from '@/lib/layout';

interface DockFrameProps {
  readonly content: Readonly<Record<PanelId, React.ReactNode>>;
  /** The viewport, which takes whatever space the docks leave. */
  readonly children: React.ReactNode;
}

/** Band highlighted along the edge a released panel would dock to. */
const EDGE_CLASSES: Readonly<Record<DockSide, string>> = {
  left: 'left-0 top-0 h-full w-24',
  right: 'right-0 top-0 h-full w-24',
  top: 'left-0 top-0 w-full h-20',
  bottom: 'left-0 bottom-0 w-full h-20',
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

  const onDrop = useCallback(
    (panel: PanelId, side: DockSide, before: PanelId | undefined): void => {
      move(panel, side, before);
    },
    [move],
  );
  const { drag, start } = usePanelDrag(onDrop);

  const dockFor = (side: DockSide): React.JSX.Element => (
    <Dock
      side={side}
      panels={panelsIn(layout, side)}
      size={layout.sizes[side]}
      collapsed={layout.collapsed}
      content={content}
      draggingPanel={drag?.panel ?? null}
      dropTarget={drag?.target ?? null}
      onToggle={toggle}
      onMove={move}
      onResize={(size): void => {
        resize(side, size);
      }}
      onDragStart={start}
    />
  );

  return (
    <div data-dock-frame className="relative flex h-full min-h-0 flex-col">
      {dockFor('top')}

      <div className="flex min-h-0 flex-1">
        {dockFor('left')}
        <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
        {dockFor('right')}
      </div>

      {dockFor('bottom')}

      {drag !== null && (
        // Purely decorative feedback, and never interactive: hit-testing reads
        // the element under the pointer, so an overlay that accepted events
        // would mask the docks underneath it.
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
          {drag.target !== null && (
            <div
              className={cn(
                'absolute border-2 border-dashed border-ring bg-ring/15',
                EDGE_CLASSES[drag.target.side],
              )}
            />
          )}
          <div
            className="absolute -translate-y-1/2 translate-x-3 rounded-md border bg-popover px-2 py-1 text-[11px] font-medium shadow-md"
            style={{ left: drag.x, top: drag.y }}
          >
            {PANEL_TITLES[drag.panel]}
          </div>
        </div>
      )}
    </div>
  );
}
