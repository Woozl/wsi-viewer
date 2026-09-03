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
  /** Sibling files mounted with the slide, for index formats. */
  companions: ReadonlyMap<string, File>;
  /** Series currently shown in the sidebar's detail panel. */
  inspectedSeries: number | null;
  sidebarOpen: boolean;
  setFile: (file: File | null, companions?: ReadonlyMap<string, File>) => void;
  setInspectedSeries: (series: number | null) => void;
  toggleSidebar: () => void;
}

export const useSlideStore = create<SlideState>((set) => ({
  file: null,
  companions: new Map(),
  inspectedSeries: null,
  sidebarOpen: true,
  setFile: (file, companions = new Map()): void => {
    set({ file, companions, inspectedSeries: null });
  },
  setInspectedSeries: (inspectedSeries): void => {
    set({ inspectedSeries });
  },
  toggleSidebar: (): void => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },
}));
