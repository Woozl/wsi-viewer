/**
 * Panel layout, persisted per browser.
 *
 * Layout is a small, purely local preference, so it lives in localStorage
 * rather than in the URL: it should follow the person, not the link they share.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isRecord } from '@/lib/json';
import {
  DEFAULT_LAYOUT,
  movePanel,
  reconcileLayout,
  resizeDock,
  toggleCollapsed,
  type DockSide,
  type LayoutState,
  type PanelId,
} from '@/lib/layout';

interface LayoutStore {
  layout: LayoutState;
  move: (panel: PanelId, side: DockSide, before?: PanelId) => void;
  toggle: (panel: PanelId) => void;
  resize: (side: DockSide, size: number) => void;
  reset: () => void;
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      layout: DEFAULT_LAYOUT,
      move: (panel, side, before): void => {
        set((state) => ({ layout: movePanel(state.layout, panel, side, before) }));
      },
      toggle: (panel): void => {
        set((state) => ({ layout: toggleCollapsed(state.layout, panel) }));
      },
      resize: (side, size): void => {
        set((state) => ({ layout: resizeDock(state.layout, side, size) }));
      },
      reset: (): void => {
        set({ layout: DEFAULT_LAYOUT });
      },
    }),
    {
      name: 'wsi-viewer:layout',
      // Whatever an older version wrote is repaired rather than trusted, so a
      // renamed panel cannot strand someone with a layout that never shows it.
      merge: (persisted, current): LayoutStore => ({
        ...current,
        layout: reconcileLayout(isRecord(persisted) ? persisted['layout'] : undefined),
      }),
    },
  ),
);
