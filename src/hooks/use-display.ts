/**
 * Builds the display settings the viewer renders with.
 *
 * Defaults come from the file wherever it says anything: an explicit channel
 * colour, then the emission wavelength, then a fallback palette. Windows are
 * sampled from the image itself, so a fluorescence slide is legible the moment
 * it opens rather than after a hunt through sliders.
 */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useChannelStore } from '@/store/channel-store';
import {
  channelLabel,
  defaultChannelColor,
  isMultiplane,
  MAX_DISPLAYED_CHANNELS,
  planeIndex,
  type ChannelMetadata,
  type ChannelSettings,
  type DisplaySettings,
} from '@/lib/channels';
import { sampleCeiling } from '@/lib/pixels';
import type { SlideModel } from '@/lib/slide';
import type { SlideClient } from '@/lib/wasm/client';

export function useDisplay(
  model: SlideModel | null,
  client: SlideClient | null,
  channels: readonly ChannelMetadata[],
  slideKey: string,
): DisplaySettings {
  const base = model?.series[0] ?? null;
  const fluorescence = base !== null && isMultiplane(base);
  const stored = useChannelStore((state) => state.channels);
  const brightfield = useChannelStore((state) => state.brightfield);
  const storedKey = useChannelStore((state) => state.slideKey);
  const initialise = useChannelStore((state) => state.initialise);

  // Only the first few channels are uploaded; a highly multiplexed panel would
  // otherwise cost a texture band each.
  const displayed = useMemo(
    () =>
      fluorescence
        ? Array.from({ length: Math.min(base.sizeC, MAX_DISPLAYED_CHANNELS) }, (_, index) => index)
        : [],
    [fluorescence, base],
  );

  const planes = useMemo(
    () =>
      base === null
        ? []
        : displayed.map((index) =>
            planeIndex(
              base.dimensionOrder,
              { sizeZ: base.sizeZ, sizeC: base.sizeC, sizeT: base.sizeT },
              { z: 0, c: index, t: 0 },
            ),
          ),
    [base, displayed],
  );

  // Sampled from the coarsest level, so this costs one small read per channel.
  const coarsest = model?.levels.at(-1) ?? null;
  const ranges = useQuery({
    queryKey: ['channel-ranges', slideKey, planes.join(',')],
    enabled: fluorescence && client !== null && coarsest !== null && planes.length > 0,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      if (client === null || coarsest === null) throw new Error('no slide open');
      return client.channelRanges(coarsest.series, coarsest.resolution, planes);
    },
  });

  const ceiling = base === null ? 255 : sampleCeiling(base);

  useEffect(() => {
    if (base === null) return;
    if (storedKey === slideKey) return;

    if (!fluorescence) {
      initialise(slideKey, []);
      return;
    }
    // Wait for the sampled windows: initialising twice would flash the slide at
    // a default window before settling on the real one.
    if (ranges.data === undefined) return;

    const settings: ChannelSettings[] = displayed.map((index, position) => {
      const metadata = channels[index] ?? {
        index,
        name: null,
        fluor: null,
        color: null,
        emissionWavelength: null,
        excitationWavelength: null,
      };
      const range = ranges.data[position] ?? { min: 0, max: ceiling };
      return {
        index,
        label: channelLabel(metadata, position),
        visible: true,
        color: defaultChannelColor(metadata, position),
        min: range.min,
        max: range.max,
        gamma: 1,
      };
    });
    initialise(slideKey, settings);
  }, [base, channels, ceiling, displayed, fluorescence, initialise, ranges.data, slideKey, storedKey]);

  return useMemo(
    () => ({
      mode: fluorescence ? 'fluorescence' : 'brightfield',
      channels: storedKey === slideKey ? stored : [],
      brightfield,
    }),
    [fluorescence, stored, storedKey, slideKey, brightfield],
  );
}
