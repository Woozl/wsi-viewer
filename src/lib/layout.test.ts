import { describe, expect, it } from 'vitest';
import {
  clampDockSize,
  insertionTarget,
  nearestSide,
  DEFAULT_LAYOUT,
  MIN_DOCK_SIZE,
  movePanel,
  panelsIn,
  reconcileLayout,
  resizeDock,
  toggleCollapsed,
} from './layout';

describe('default layout', () => {
  it('puts folders on the left and the slide details on the right', () => {
    expect(panelsIn(DEFAULT_LAYOUT, 'left')).toEqual(['folders']);
    expect(panelsIn(DEFAULT_LAYOUT, 'right')).toEqual([
      'slide',
      'pyramid',
      'associated',
      'metadata',
    ]);
    expect(panelsIn(DEFAULT_LAYOUT, 'top')).toEqual([]);
  });
});

describe('movePanel', () => {
  it('moves a panel to another dock, appending by default', () => {
    const next = movePanel(DEFAULT_LAYOUT, 'folders', 'bottom');
    expect(panelsIn(next, 'left')).toEqual([]);
    expect(panelsIn(next, 'bottom')).toEqual(['folders']);
  });

  it('inserts before a given panel so a drop lands where the pointer was', () => {
    const next = movePanel(DEFAULT_LAYOUT, 'folders', 'right', 'pyramid');
    expect(panelsIn(next, 'right')).toEqual(['slide', 'folders', 'pyramid', 'associated', 'metadata']);
  });

  it('reorders within the same dock without duplicating', () => {
    const next = movePanel(DEFAULT_LAYOUT, 'metadata', 'right', 'slide');
    expect(panelsIn(next, 'right')).toEqual(['metadata', 'slide', 'pyramid', 'associated']);
  });
});

describe('toggleCollapsed', () => {
  it('flips one panel without touching the others', () => {
    const next = toggleCollapsed(DEFAULT_LAYOUT, 'pyramid');
    expect(next.collapsed.pyramid).toBe(true);
    expect(next.collapsed.slide).toBe(false);
  });
});

describe('clampDockSize', () => {
  it('keeps a dock usable', () => {
    expect(clampDockSize(20, 1000)).toBe(MIN_DOCK_SIZE);
  });

  it('stops a dock swallowing the viewport', () => {
    expect(clampDockSize(5000, 1000)).toBe(600);
  });

  it('leaves a reasonable size alone', () => {
    expect(clampDockSize(300, 1000)).toBe(300);
  });

  it('still yields a usable dock in a very small window', () => {
    // The minimum wins over the fraction, so the dock never collapses to zero.
    expect(clampDockSize(300, 100)).toBe(MIN_DOCK_SIZE);
  });
});

describe('resizeDock', () => {
  it('records a rounded size for one side only', () => {
    const next = resizeDock(DEFAULT_LAYOUT, 'left', 301.6);
    expect(next.sizes.left).toBe(302);
    expect(next.sizes.right).toBe(DEFAULT_LAYOUT.sizes.right);
  });
});

describe('reconcileLayout', () => {
  it('falls back to the default for junk', () => {
    expect(reconcileLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(reconcileLayout('nonsense')).toEqual(DEFAULT_LAYOUT);
  });

  it('drops panels that no longer exist', () => {
    const restored = reconcileLayout({
      ...DEFAULT_LAYOUT,
      order: ['metadata', 'a-removed-panel', 'folders'],
    });
    expect(restored.order).not.toContain('a-removed-panel');
    expect(restored.order).toContain('folders');
  });

  it('restores panels added since the layout was saved', () => {
    // A layout written before "associated" existed must still surface it.
    const restored = reconcileLayout({ ...DEFAULT_LAYOUT, order: ['folders', 'slide'] });
    expect(restored.order).toContain('associated');
    expect(new Set(restored.order).size).toBe(restored.order.length);
  });

  it('ignores an unknown dock side', () => {
    const restored = reconcileLayout({
      ...DEFAULT_LAYOUT,
      placement: { ...DEFAULT_LAYOUT.placement, folders: 'nowhere' },
    });
    expect(restored.placement.folders).toBe('left');
  });

  it('bounds a stored size that would hide the dock', () => {
    const restored = reconcileLayout({ ...DEFAULT_LAYOUT, sizes: { ...DEFAULT_LAYOUT.sizes, left: 5 } });
    expect(restored.sizes.left).toBe(MIN_DOCK_SIZE);
  });
});

describe('insertionTarget', () => {
  const extents = [
    { id: 'slide', start: 0, end: 100 },
    { id: 'pyramid', start: 100, end: 200 },
    { id: 'metadata', start: 200, end: 300 },
  ] as const;

  it('lands before a panel while above its midpoint', () => {
    expect(insertionTarget(extents, 10)).toBe('slide');
    expect(insertionTarget(extents, 49)).toBe('slide');
  });

  it('flips to the next panel past the midpoint', () => {
    expect(insertionTarget(extents, 51)).toBe('pyramid');
    expect(insertionTarget(extents, 149)).toBe('pyramid');
  });

  it('appends when dropped past the last midpoint', () => {
    expect(insertionTarget(extents, 260)).toBeNull();
  });

  it('appends into an empty dock', () => {
    expect(insertionTarget([], 42)).toBeNull();
  });
});

describe('nearestSide', () => {
  const frame = { x: 0, y: 0, width: 1000, height: 500 };

  it('picks the edge the pointer is closest to', () => {
    expect(nearestSide(frame, { x: 10, y: 250 })).toBe('left');
    expect(nearestSide(frame, { x: 990, y: 250 })).toBe('right');
    expect(nearestSide(frame, { x: 500, y: 5 })).toBe('top');
    expect(nearestSide(frame, { x: 500, y: 495 })).toBe('bottom');
  });

  it('accounts for the frame not starting at the origin', () => {
    const offset = { x: 200, y: 100, width: 400, height: 400 };
    expect(nearestSide(offset, { x: 210, y: 300 })).toBe('left');
  });

  it('resolves the centre of a wide frame to a vertical edge', () => {
    // Equidistant horizontally, but much closer to top or bottom.
    expect(nearestSide(frame, { x: 500, y: 250 })).toBe('top');
  });
});
