/**
 * Creates and owns the OpenLayers map for a slide.
 *
 * The slide is treated as a flat pixel raster rather than a geographic layer: a
 * custom projection in `pixels` spans `[0, -height, width, 0]`, so map
 * coordinates are image pixels with y increasing downwards from the top-left.
 * Tile resolutions come from the reconstructed pyramid, so OpenLayers requests
 * exactly the levels the file actually stores and interpolates between them.
 *
 * The map is built once per slide. Channel changes swap the layer's source and
 * style in place: recreating the map would drop the camera, refetch every tile
 * and flash the viewport each time a channel appeared.
 */
import { useEffect, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/WebGLTile';
import DataTileSource from 'ol/source/DataTile';
import TileGrid from 'ol/tilegrid/TileGrid';
import Projection from 'ol/proj/Projection';
import { defaults as defaultInteractions } from 'ol/interaction/defaults';
import { levelResolutions, zoomBounds, type PyramidLevel, type SlideModel } from '@/lib/slide';
import { planeIndex, type DisplaySettings } from '@/lib/channels';
import {
  brightfieldVariables,
  buildBrightfieldStyle,
  buildFluorescenceStyle,
  channelVariables,
} from '@/lib/channel-style';
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

/** Everything the source builder needs, captured when the map is created. */
interface Grid {
  readonly tileGrid: TileGrid;
  readonly projection: Projection;
  /** Coarsest first, matching the tile grid's resolutions. */
  readonly levels: readonly PyramidLevel[];
}

export function useSlideMap(
  container: HTMLDivElement | null,
  model: SlideModel | null,
  client: SlideClient | null,
  camera: ViewSearch,
  onCameraChange: (camera: CameraChange) => void,
  display: DisplaySettings,
): SlideMapHandle {
  const [map, setMap] = useState<Map | null>(null);
  const layerRef = useRef<TileLayer | null>(null);
  const gridRef = useRef<Grid | null>(null);

  // Read once when the map is built, then written continuously; holding the
  // callback in a ref keeps it out of the effect's dependencies so panning never
  // tears the map down.
  const [initialCamera] = useState(camera);
  const notifyCamera = useRef(onCameraChange);
  useEffect(() => {
    notifyCamera.current = onCameraChange;
  }, [onCameraChange]);

  // The shader is compiled from the channel *structure*, so the source and style
  // are rebuilt only when that changes. Anything a slider touches is a uniform.
  const structureKey =
    display.mode === 'brightfield'
      ? 'brightfield'
      : display.channels.map((channel) => channel.index).join(',');
  const displayRef = useRef(display);
  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (container === null || model === null || client === null) return;

    const extent: [number, number, number, number] = [0, -model.height, model.width, 0];
    const projection = new Projection({ code: 'slide-pixels', units: 'pixels', extent });

    // Coarsest first, as TileGrid requires; `levels` is finest first.
    const resolutions = levelResolutions(model);
    const reversed = [...model.levels].reverse();
    const tileGrid = new TileGrid({
      extent,
      origin: [0, 0],
      resolutions,
      tileSizes: reversed.map((level): [number, number] => [level.tileWidth, level.tileHeight]),
    });
    gridRef.current = { tileGrid, projection, levels: reversed };

    const view = new View({
      projection,
      extent,
      constrainOnlyCenter: false,
      showFullExtent: true,
      // Deliberately no `resolutions` here, only on the tile grid: see
      // zoomBounds. The tile grid still picks the nearest stored level and
      // OpenLayers upsamples beyond it.
      ...zoomBounds(resolutions),
    });

    const layer = new TileLayer({ style: { color: ['array', 0, 0, 0, 0] } });
    layerRef.current = layer;

    const olMap = new Map({
      target: container,
      layers: [layer],
      view,
      // The default controls are replaced with themed React components.
      controls: [],
      // OpenLayers builds its default interactions with `onFocusOnly: true`,
      // and that condition requires focus only when the target carries a
      // tabindex. The container has one so the arrow keys can pan it, which
      // silently made wheel-zoom and drag-pan ignore the first gesture until
      // the map had been clicked. The viewport owns its whole area here and the
      // page does not scroll, so handling those immediately is correct.
      interactions: defaultInteractions({ onFocusOnly: false }),
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
    // Published directly rather than waiting for `moveend`. The layer has no
    // source until the channel structure resolves, so the map may not render a
    // frame for some time, and `moveend` only fires from the render loop —
    // which would leave the URL without a camera until the first interaction.
    publishCamera();

    // A map is an external resource created in an effect and published to
    // state; the controls and overview need to re-render once it exists.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resource handoff
    setMap(olMap);

    return (): void => {
      olMap.un('moveend', publishCamera);
      olMap.setTarget(undefined);
      olMap.dispose();
      layerRef.current = null;
      gridRef.current = null;
      setMap((currentMap) => (currentMap === olMap ? null : currentMap));
    };
  }, [container, model, client, initialCamera]);

  // Source and style follow the channel structure. Swapping them in place keeps
  // the camera and avoids a full rebuild every time channels resolve.
  useEffect(() => {
    const layer = layerRef.current;
    const grid = gridRef.current;
    if (layer === null || grid === null || model === null || client === null) return;

    const current = displayRef.current;
    const fluorescence = current.mode === 'fluorescence';
    const base = model.series[0];
    const planes = fluorescence
      ? current.channels.map((channel) =>
          planeIndex(
            base?.dimensionOrder ?? 'XYCZT',
            { sizeZ: base?.sizeZ ?? 1, sizeC: base?.sizeC ?? 1, sizeT: base?.sizeT ?? 1 },
            { z: 0, c: channel.index, t: 0 },
          ),
        )
      : [];

    // A fluorescence slide has nothing to draw until its channels resolve;
    // rendering a placeholder would flash black over the viewport.
    if (fluorescence && planes.length === 0) return;

    const source = new DataTileSource({
      tileGrid: grid.tileGrid,
      projection: grid.projection,
      bandCount: fluorescence ? planes.length : 4,
      loader: async (z, x, y) => {
        const level = grid.levels[z];
        if (level === undefined) throw new Error(`no pyramid level for zoom ${String(z)}`);
        if (x < 0 || y < 0 || x >= level.tilesAcross || y >= level.tilesDown) {
          throw new Error('tile out of range');
        }
        const tile = await client.tile({
          series: level.series,
          resolution: level.resolution,
          col: x,
          row: y,
          tileWidth: level.tileWidth,
          tileHeight: level.tileHeight,
          levelWidth: level.width,
          levelHeight: level.height,
          planes,
          compressed: level.compressed,
        });
        if (tile === null) throw new Error('tile unavailable');
        return tile;
      },
      transition: 120,
    });

    layer.setStyle(
      fluorescence
        ? buildFluorescenceStyle(current.channels)
        : buildBrightfieldStyle(current.brightfield),
    );
    layer.setSource(source);

    return (): void => {
      source.dispose();
    };
  }, [model, client, structureKey]);

  // Sliders only move uniforms, so adjusting a window or a colour repaints
  // without recompiling the shader or refetching any tiles.
  useEffect(() => {
    const layer = layerRef.current;
    if (layer === null) return;
    layer.updateStyleVariables(
      display.mode === 'fluorescence'
        ? channelVariables(display.channels)
        : brightfieldVariables(display.brightfield),
    );
  }, [display]);

  return { map };
}
