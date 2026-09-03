import { useState } from 'react';
import { useSlideMap } from './use-slide-map';
import { MapControls } from './map-controls';
import type { SlideModel } from '@/lib/slide';
import type { SlideClient } from '@/lib/wasm/client';

interface SlideViewerProps {
  readonly model: SlideModel;
  readonly client: SlideClient;
}

export function SlideViewer({ model, client }: SlideViewerProps): React.JSX.Element {
  // Callback ref rather than useRef: the map must be built only once the node
  // exists, and a ref object would not re-run the effect when it appears.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const { map } = useSlideMap(container, model, client);

  return (
    <div className="relative h-full w-full">
      <div
        ref={setContainer}
        className="h-full w-full bg-muted"
        // The canvas is decorative to assistive tech; the metadata panel carries
        // the equivalent information in text.
        role="application"
        aria-label={`Slide viewer, ${String(model.width)} by ${String(model.height)} pixels`}
      />
      <MapControls map={map} model={model} />
    </div>
  );
}
