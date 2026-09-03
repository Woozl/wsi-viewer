/**
 * UI-side slide state.
 *
 * The `File` itself is deliberately not persisted: the brief calls for
 * remembering *which* slide was open, not for copying gigabytes into browser
 * storage, and a `File` cannot be revived across a reload anyway.
 */
import { create } from 'zustand';

export interface RecentSlide {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  readonly openedAt: number;
}

interface SlideState {
  file: File | null;
  /** Series currently shown in the sidebar's detail panel. */
  inspectedSeries: number | null;
  sidebarOpen: boolean;
  setFile: (file: File | null) => void;
  setInspectedSeries: (series: number | null) => void;
  toggleSidebar: () => void;
}

export const useSlideStore = create<SlideState>((set) => ({
  file: null,
  inspectedSeries: null,
  sidebarOpen: true,
  setFile: (file): void => {
    set({ file, inspectedSeries: null });
  },
  setInspectedSeries: (inspectedSeries): void => {
    set({ inspectedSeries });
  },
  toggleSidebar: (): void => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },
}));
