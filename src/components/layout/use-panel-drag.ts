/**
 * Pointer-driven dragging of panels between docks.
 *
 * Uses pointer events rather than HTML5 drag-and-drop so the drop target can be
 * recomputed on every move and shown live. Native dragging only reports enter
 * and leave on registered targets, which is not enough to draw an insertion
 * point between two panels.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DOCK_SIDES,
  insertionTarget,
  nearestSide,
  type DockSide,
  type PanelExtent,
  type PanelId,
} from '@/lib/layout';

export interface DropTarget {
  readonly side: DockSide;
  /** Panel to insert before, or null to append to the dock. */
  readonly before: PanelId | null;
}

export interface PanelDrag {
  readonly panel: PanelId;
  readonly x: number;
  readonly y: number;
  readonly target: DropTarget | null;
}

/** Movement before a press counts as a drag, so a click still reaches buttons. */
const DRAG_THRESHOLD_PX = 4;

function sideFromElement(element: Element | null): DockSide | null {
  const dock = element?.closest('[data-dock-side]') ?? null;
  const value = dock?.getAttribute('data-dock-side');
  return DOCK_SIDES.find((side) => side === value) ?? null;
}

function panelIdOf(element: Element): PanelId | null {
  const value = element.getAttribute('data-panel-id');
  return value === null ? null : (PANEL_ID_LOOKUP.get(value) ?? null);
}

const PANEL_ID_LOOKUP = new Map<string, PanelId>(
  (['folders', 'slide', 'pyramid', 'associated', 'metadata'] as const).map((id) => [id, id]),
);

/**
 * Works out where a release at this point would put the panel.
 *
 * Prefers the dock actually under the pointer; over the viewport it falls back
 * to the nearest edge, which is how a panel reaches a dock that is still empty.
 */
function resolveTarget(x: number, y: number, dragged: PanelId): DropTarget | null {
  const frame = document.querySelector('[data-dock-frame]');
  if (frame === null) return null;

  const hovered = sideFromElement(document.elementFromPoint(x, y));
  const side = hovered ?? nearestSide(frame.getBoundingClientRect(), { x, y });

  const vertical = side === 'left' || side === 'right';
  const extents: PanelExtent[] = [];
  for (const element of document.querySelectorAll(`[data-dock-side="${side}"] [data-panel-id]`)) {
    const id = panelIdOf(element);
    // The dragged panel is skipped so the indicator does not offer to drop it
    // back into the gap it is about to leave.
    if (id === null || id === dragged) continue;
    const rect = element.getBoundingClientRect();
    extents.push({
      id,
      start: vertical ? rect.top : rect.left,
      end: vertical ? rect.bottom : rect.right,
    });
  }

  return { side, before: insertionTarget(extents, vertical ? y : x) };
}

export function usePanelDrag(
  onDrop: (panel: PanelId, side: DockSide, before: PanelId | undefined) => void,
): {
  drag: PanelDrag | null;
  start: (panel: PanelId, event: React.PointerEvent) => void;
} {
  const [drag, setDrag] = useState<PanelDrag | null>(null);
  const commit = useRef(onDrop);
  useEffect(() => {
    commit.current = onDrop;
  }, [onDrop]);

  const start = useCallback((panel: PanelId, event: React.PointerEvent): void => {
    // Left button only; a right-click should open the browser's menu.
    if (event.button !== 0) return;
    event.preventDefault();

    const origin = { x: event.clientX, y: event.clientY };
    let active = false;

    const onMove = (move: PointerEvent): void => {
      if (!active) {
        const far =
          Math.abs(move.clientX - origin.x) > DRAG_THRESHOLD_PX ||
          Math.abs(move.clientY - origin.y) > DRAG_THRESHOLD_PX;
        if (!far) return;
        active = true;
      }
      setDrag({
        panel,
        x: move.clientX,
        y: move.clientY,
        target: resolveTarget(move.clientX, move.clientY, panel),
      });
    };

    const finish = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      if (!active) return;
      const target = resolveTarget(up.clientX, up.clientY, panel);
      if (target !== null) commit.current(panel, target.side, target.before ?? undefined);
      setDrag(null);
    };

    const cancel = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      setDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  }, []);

  return { drag, start };
}
