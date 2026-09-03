/**
 * Creates and owns the OpenLayers map for a slide.
 *
 * The slide is treated as a flat pixel raster rather than a geographic layer: a
 * custom projection in `pixels` spans `[0, -height, width, 0]`, so map
 * coordinates are image pixels with y increasing downwards from the top-left.
 * Tile resolutions come from the reconstructed pyramid, so OpenLayers requests
 * exactly the levels the file actually stores and interpolates between them.
 */
import { useEffect, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/WebGLTile';
import DataTileSource from 'ol/source/DataTile';
import TileGrid from 'ol/tilegrid/TileGrid';
import Projection from 'ol/proj/Projection';
import { levelResolutions, type SlideModel } from '@/lib/slide';
import type { SlideClient } from '@/lib/wasm/client';

export interface SlideMapHandle {
  readonly map: Map | null;
}

export function useSlideMap(
  container: HTMLDivElement | null,
  model: SlideModel | null,
  client: SlideClient | null,
): SlideMapHandle {
  // The map is an external resource created in an effect and published to
  // state. A ref would not re-render the controls when the map appears, and
  // reading `ref.current` during render is not allowed.
  const [map, setMap] = useState<Map | null>(null);

  useEffect(() => {
    if (container === null || model === null || client === null) return;

    const extent: [number, number, number, number] = [0, -model.height, model.width, 0];
    const projection = new Projection({ code: 'slide-pixels', units: 'pixels', extent });

    // Coarsest first, as TileGrid requires; `levels` is finest first.
    const resolutions = levelResolutions(model);
    const reversed = [...model.levels].reverse();
    const tileSizes = reversed.map((level): [number, number] => [
      level.tileWidth,
      level.tileHeight,
    ]);

    const tileGrid = new TileGrid({
      extent,
      origin: [0, 0],
      resolutions,
      tileSizes,
    });

    const source = new DataTileSource({
      tileGrid,
      projection,
      // Tiles arrive as decoded ImageBitmaps from the worker.
      loader: async (z, x, y) => {
        const level = reversed[z];
        if (level === undefined) throw new Error(`no pyramid level for zoom ${String(z)}`);
        if (x < 0 || y < 0 || x >= level.tilesAcross || y >= level.tilesDown) {
          throw new Error('tile out of range');
        }
        const bitmap = await client.tile({
          series: level.series,
          resolution: level.resolution,
          col: x,
          row: y,
          tileWidth: level.tileWidth,
          tileHeight: level.tileHeight,
          levelWidth: level.width,
          levelHeight: level.height,
          compressed: level.compressed,
        });
        if (bitmap === null) throw new Error('tile unavailable');
        return bitmap;
      },
      // Slide tiles are opaque JPEG; skipping alpha avoids a needless blend.
      transition: 120,
    });

    const view = new View({
      projection,
      extent,
      resolutions,
      constrainOnlyCenter: false,
      showFullExtent: true,
      // Allow zooming past the finest stored level; OpenLayers upsamples.
      maxResolution: resolutions[0],
      minResolution: (resolutions.at(-1) ?? 1) / 4,
    });

    const olMap = new Map({
      target: container,
      layers: [new TileLayer({ source })],
      view,
      // The default controls are replaced with themed React components.
      controls: [],
    });
    view.fit(extent, { padding: [24, 24, 24, 24] });

    // eslint-disable-next-line react-hooks/set-state-in-effect -- resource handoff
    setMap(olMap);

    return (): void => {
      olMap.setTarget(undefined);
      olMap.dispose();
      source.dispose();
      setMap((current) => (current === olMap ? null : current));
    };
  }, [container, model, client]);

  return { map };
}
