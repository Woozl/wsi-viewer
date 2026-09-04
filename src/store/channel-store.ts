/**
 * Per-slide channel display settings.
 *
 * Deliberately not persisted: channels differ between slides, so carrying a
 * window or colour across from the last file would be misleading rather than
 * convenient. Layout is a preference; this is a property of the image.
 */
import { create } from 'zustand';
import { DEFAULT_BRIGHTFIELD, type BrightfieldAdjustment, type ChannelSettings } from '@/lib/channels';

interface ChannelStore {
  /** Slide these settings belong to, so a new file resets them. */
  slideKey: string | null;
  channels: readonly ChannelSettings[];
  brightfield: BrightfieldAdjustment;
  /** Kept so "reset" restores what the file suggested, not a blank window. */
  defaults: readonly ChannelSettings[];
  initialise: (slideKey: string, channels: readonly ChannelSettings[]) => void;
  updateChannel: (index: number, patch: Partial<ChannelSettings>) => void;
  updateBrightfield: (patch: Partial<BrightfieldAdjustment>) => void;
  reset: () => void;
}

export const useChannelStore = create<ChannelStore>((set) => ({
  slideKey: null,
  channels: [],
  brightfield: DEFAULT_BRIGHTFIELD,
  defaults: [],
  initialise: (slideKey, channels): void => {
    set({ slideKey, channels, defaults: channels, brightfield: DEFAULT_BRIGHTFIELD });
  },
  updateChannel: (index, patch): void => {
    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.index === index ? { ...channel, ...patch } : channel,
      ),
    }));
  },
  updateBrightfield: (patch): void => {
    set((state) => ({ brightfield: { ...state.brightfield, ...patch } }));
  },
  reset: (): void => {
    set((state) => ({ channels: state.defaults, brightfield: DEFAULT_BRIGHTFIELD }));
  },
}));
