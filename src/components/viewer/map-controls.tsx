/**
 * Themed replacements for OpenLayers' built-in controls, which are hidden in CSS
 * so the viewer chrome matches the rest of the application.
 */
import { useCallback } from 'react';
import type Map from 'ol/Map';
import { MaximizeIcon, MinusIcon, PlusIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SlideModel } from '@/lib/slide';

interface MapControlsProps {
  readonly map: Map | null;
  readonly model: SlideModel;
}

const ZOOM_DURATION = 200;

export function MapControls({ map, model }: MapControlsProps): React.JSX.Element {
  const zoomBy = useCallback(
    (delta: number): void => {
      const view = map?.getView();
      if (view === undefined) return;
      const zoom = view.getZoom();
      if (zoom === undefined) return;
      view.animate({ zoom: zoom + delta, duration: ZOOM_DURATION });
    },
    [map],
  );

  const fit = useCallback((): void => {
    map?.getView().fit([0, -model.height, model.width, 0], {
      duration: ZOOM_DURATION,
      padding: [24, 24, 24, 24],
    });
  }, [map, model.height, model.width]);

  const resetRotation = useCallback((): void => {
    map?.getView().animate({ rotation: 0, duration: ZOOM_DURATION });
  }, [map]);

  return (
    <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-md border bg-card/90 p-1 shadow-sm backdrop-blur">
      <ControlButton label="Zoom in" onClick={(): void => { zoomBy(1); }}>
        <PlusIcon />
      </ControlButton>
      <ControlButton label="Zoom out" onClick={(): void => { zoomBy(-1); }}>
        <MinusIcon />
      </ControlButton>
      <ControlButton label="Fit slide to window" onClick={fit}>
        <MaximizeIcon />
      </ControlButton>
      <ControlButton label="Reset rotation" onClick={resetRotation}>
        <RotateCcwIcon />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
