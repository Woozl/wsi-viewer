/**
 * Dockable panel layout.
 *
 * Panels live in one of four edge docks and the viewport takes whatever is
 * left, so the arrangement is described by which dock each panel sits in plus a
 * single ordering. Keeping one global order rather than a list per dock means
 * moving a panel between docks never has to reconcile two arrays.
 */

export const DOCK_SIDES = ['left', 'right', 'top', 'bottom'] as const;
export type DockSide = (typeof DOCK_SIDES)[number];

export const PANEL_IDS = [
  'folders',
  'slide',
  'channels',
  'pyramid',
  'associated',
  'metadata',
] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const PANEL_TITLES: Readonly<Record<PanelId, string>> = {
  folders: 'Folders',
  slide: 'Slide',
  channels: 'Channels',
  pyramid: 'Pyramid',
  associated: 'Associated images',
  metadata: 'Format metadata',
};

/**
 * Panels that absorb spare space in their dock.
 *
 * The rest size to their content: "Slide" is five rows and "Pyramid" is a
 * handful, so giving every panel an equal share leaves most of a dock empty.
 */
export const PANEL_GROWS: Readonly<Record<PanelId, boolean>> = {
  folders: true,
  slide: false,
  channels: true,
  pyramid: false,
  associated: true,
  metadata: true,
};

export interface LayoutState {
  readonly placement: Readonly<Record<PanelId, DockSide>>;
  /** Global ordering; each dock renders its members in this sequence. */
  readonly order: readonly PanelId[];
  readonly collapsed: Readonly<Record<PanelId, boolean>>;
  /** Dock thickness in pixels: width for left/right, height for top/bottom. */
  readonly sizes: Readonly<Record<DockSide, number>>;
}

/** Below this a dock cannot show anything useful. */
export const MIN_DOCK_SIZE = 180;

/** A dock may never take more than this share of the window. */
const MAX_DOCK_FRACTION = 0.6;

export const DEFAULT_LAYOUT: LayoutState = {
  placement: {
    folders: 'left',
    slide: 'right',
    channels: 'right',
    pyramid: 'right',
    associated: 'right',
    metadata: 'right',
  },
  order: ['folders', 'slide', 'channels', 'pyramid', 'associated', 'metadata'],
  collapsed: {
    folders: false,
    slide: false,
    channels: false,
    pyramid: false,
    associated: false,
    metadata: false,
  },
  sizes: { left: 260, right: 320, top: 220, bottom: 220 },
};

/** Panels in one dock, in display order. */
export function panelsIn(layout: LayoutState, side: DockSide): PanelId[] {
  return layout.order.filter((id) => layout.placement[id] === side);
}

export function clampDockSize(size: number, available: number): number {
  const max = Math.max(MIN_DOCK_SIZE, Math.floor(available * MAX_DOCK_FRACTION));
  return Math.min(max, Math.max(MIN_DOCK_SIZE, Math.round(size)));
}

/**
 * Moves `panel` into `side`, placing it next to `before` when given.
 *
 * The panel is removed from the ordering and reinserted so that dropping it
 * onto a dock lands it where the pointer was, rather than always appending.
 */
export function movePanel(
  layout: LayoutState,
  panel: PanelId,
  side: DockSide,
  before?: PanelId,
): LayoutState {
  const order = layout.order.filter((id) => id !== panel);
  const target = before === undefined ? -1 : order.indexOf(before);
  if (target === -1) order.push(panel);
  else order.splice(target, 0, panel);

  return {
    ...layout,
    order,
    placement: { ...layout.placement, [panel]: side },
  };
}

export function toggleCollapsed(layout: LayoutState, panel: PanelId): LayoutState {
  return {
    ...layout,
    collapsed: { ...layout.collapsed, [panel]: !layout.collapsed[panel] },
  };
}

export function resizeDock(layout: LayoutState, side: DockSide, size: number): LayoutState {
  return { ...layout, sizes: { ...layout.sizes, [side]: Math.round(size) } };
}

/**
 * Repairs a layout loaded from storage.
 *
 * The shape is whatever a previous version of the app wrote, so unknown panels
 * are dropped, missing ones are restored to their defaults, and sizes are
 * bounded. Without this, renaming a panel would strand users with a layout that
 * never shows it again.
 */
export function reconcileLayout(stored: unknown): LayoutState {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_LAYOUT;
  const candidate: Record<string, unknown> = { ...stored };

  const placement: Record<PanelId, DockSide> = { ...DEFAULT_LAYOUT.placement };
  const storedPlacement = candidate['placement'];
  if (typeof storedPlacement === 'object' && storedPlacement !== null) {
    const entries: Record<string, unknown> = { ...storedPlacement };
    for (const id of PANEL_IDS) {
      const stored = entries[id];
      const side = DOCK_SIDES.find((known) => known === stored);
      if (side !== undefined) placement[id] = side;
    }
  }

  const storedOrder = candidate['order'];
  const order: PanelId[] = [];
  if (Array.isArray(storedOrder)) {
    for (const entry of storedOrder) {
      const id = PANEL_IDS.find((known) => known === entry);
      if (id !== undefined && !order.includes(id)) order.push(id);
    }
  }
  // Panels added since the layout was written reappear at the end.
  for (const id of PANEL_IDS) if (!order.includes(id)) order.push(id);

  const collapsed: Record<PanelId, boolean> = { ...DEFAULT_LAYOUT.collapsed };
  const storedCollapsed = candidate['collapsed'];
  if (typeof storedCollapsed === 'object' && storedCollapsed !== null) {
    const entries: Record<string, unknown> = { ...storedCollapsed };
    for (const id of PANEL_IDS) {
      if (typeof entries[id] === 'boolean') collapsed[id] = entries[id];
    }
  }

  const sizes: Record<DockSide, number> = { ...DEFAULT_LAYOUT.sizes };
  const storedSizes = candidate['sizes'];
  if (typeof storedSizes === 'object' && storedSizes !== null) {
    const entries: Record<string, unknown> = { ...storedSizes };
    for (const side of DOCK_SIDES) {
      const value = entries[side];
      if (typeof value === 'number' && Number.isFinite(value)) {
        sizes[side] = Math.max(MIN_DOCK_SIZE, Math.round(value));
      }
    }
  }

  return { placement, order, collapsed, sizes };
}

/** One panel's extent along its dock's main axis, in client pixels. */
export interface PanelExtent {
  readonly id: PanelId;
  readonly start: number;
  readonly end: number;
}

/**
 * Which panel a drop at `position` should land before, or null to append.
 *
 * Compares against each panel's midpoint so the insertion point flips as the
 * pointer passes the middle of a panel, which is what makes the indicator feel
 * like it is tracking the cursor rather than snapping late.
 */
export function insertionTarget(
  extents: readonly PanelExtent[],
  position: number,
): PanelId | null {
  for (const extent of extents) {
    if (position < (extent.start + extent.end) / 2) return extent.id;
  }
  return null;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The edge of `frame` nearest to `pointer`.
 *
 * Used when a panel is dragged over the viewport rather than over an existing
 * dock, so releasing there docks it to the side being approached.
 */
export function nearestSide(frame: Rect, pointer: { x: number; y: number }): DockSide {
  const distances: Readonly<Record<DockSide, number>> = {
    left: pointer.x - frame.x,
    right: frame.x + frame.width - pointer.x,
    top: pointer.y - frame.y,
    bottom: frame.y + frame.height - pointer.y,
  };
  return DOCK_SIDES.reduce((closest, side) =>
    distances[side] < distances[closest] ? side : closest,
  );
}
