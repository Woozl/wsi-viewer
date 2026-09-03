import { useState } from 'react';
import { useSlideMap, type CameraChange } from './use-slide-map';
import { MapControls } from './map-controls';
import { Minimap } from './minimap';
import type { SlideModel } from '@/lib/slide';
import type { SlideClient } from '@/lib/wasm/client';
import type { ViewSearch } from '@/lib/view-state';

interface SlideViewerProps {
  readonly model: SlideModel;
  readonly client: SlideClient;
  readonly camera: ViewSearch;
  readonly onCameraChange: (camera: CameraChange) => void;
  /** Identifies the slide, so the overview image is cached per file. */
  readonly slideKey: string;
}

export function SlideViewer({
  model,
  client,
  camera,
  onCameraChange,
  slideKey,
}: SlideViewerProps): React.JSX.Element {
  // Callback ref rather than useRef: the map must be built only once the node
  // exists, and a ref object would not re-run the effect when it appears.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const { map } = useSlideMap(container, model, client, camera, onCameraChange);

  return (
    <div className="relative h-full w-full">
      <div
        ref={setContainer}
        className="h-full w-full bg-muted"
        // Focusable so OpenLayers' keyboard interactions work: arrow keys pan
        // and +/- zoom. That keeps the pointer-only overview map a pure
        // enhancement rather than the only way to move around.
        tabIndex={0}
        role="application"
        aria-label={`Slide viewer, ${String(model.width)} by ${String(model.height)} pixels. Use the arrow keys to pan and plus or minus to zoom.`}
      />
      <MapControls map={map} model={model} />
      <Minimap map={map} model={model} client={client} slideKey={slideKey} />
    </div>
  );
}
