/**
 * Creates and owns the OpenLayers map for a slide.
 *
 * The slide is treated as a flat pixel raster rather than a geographic layer: a
 * custom projection in `pixels` spans `[0, -height, width, 0]`, so map
 * coordinates are image pixels with y increasing downwards from the top-left.
 * Tile resolutions come from the reconstructed pyramid, so OpenLayers requests
 * exactly the levels the file actually stores and interpolates between them.
 */
import { useEffect, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/WebGLTile';
import DataTileSource from 'ol/source/DataTile';
import TileGrid from 'ol/tilegrid/TileGrid';
import Projection from 'ol/proj/Projection';
import { levelResolutions, zoomBounds, ZOOM_FACTOR, type SlideModel } from '@/lib/slide';
import { roundCamera, type ViewSearch } from '@/lib/view-state';
import type { SlideClient } from '@/lib/wasm/client';

export interface SlideMapHandle {
  readonly map: Map | null;
}

export interface CameraChange {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly rot: number;
}

export function useSlideMap(
  container: HTMLDivElement | null,
  model: SlideModel | null,
  client: SlideClient | null,
  camera: ViewSearch,
  onCameraChange: (camera: CameraChange) => void,
): SlideMapHandle {
  // The map is an external resource created in an effect and published to
  // state. A ref would not re-render the controls when the map appears, and
  // reading `ref.current` during render is not allowed.
  const [map, setMap] = useState<Map | null>(null);
  // The camera is read once, when the map is built, and written continuously
  // afterwards. Capturing the initial value in state and holding the callback in
  // a ref keeps both out of the effect's dependencies, so panning never tears
  // the map down and rebuilds it.
  const [initialCamera] = useState(camera);
  const notifyCamera = useRef(onCameraChange);
  useEffect(() => {
    notifyCamera.current = onCameraChange;
  }, [onCameraChange]);

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
      constrainOnlyCenter: false,
      showFullExtent: true,
      zoomFactor: ZOOM_FACTOR,
      // Deliberately no `resolutions` here, only on the tile grid: see
      // zoomBounds. The tile grid still picks the nearest stored level and
      // OpenLayers upsamples beyond it.
      ...zoomBounds(resolutions),
    });

    const olMap = new Map({
      target: container,
      layers: [new TileLayer({ source })],
      view,
      // The default controls are replaced with themed React components.
      controls: [],
    });
    const restored = initialCamera;
    if (restored.x !== undefined && restored.y !== undefined && restored.r !== undefined) {
      view.setCenter([restored.x, -restored.y]);
      view.setResolution(restored.r);
      view.setRotation(restored.rot ?? 0);
    } else {
      view.fit(extent, { padding: [24, 24, 24, 24] });
    }

    // `moveend` rather than `change:center`, so a pan writes one URL entry
    // instead of one per animation frame.
    const publishCamera = (): void => {
      const centre = view.getCenter();
      const resolution = view.getResolution();
      if (centre === undefined || resolution === undefined) return;
      const [cx, cy] = centre;
      if (cx === undefined || cy === undefined) return;
      notifyCamera.current({
        x: roundCamera(cx),
        // Map coordinates run negative downwards; the URL carries image pixels.
        y: roundCamera(-cy),
        r: roundCamera(resolution, 4),
        rot: roundCamera(view.getRotation(), 4),
      });
    };
    olMap.on('moveend', publishCamera);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- resource handoff
    setMap(olMap);

    return (): void => {
      olMap.un('moveend', publishCamera);
      olMap.setTarget(undefined);
      olMap.dispose();
      source.dispose();
      setMap((current) => (current === olMap ? null : current));
    };
  }, [container, model, client, initialCamera]);

  return { map };
}
