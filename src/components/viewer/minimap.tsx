import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type Map from 'ol/Map';
import { ChevronDownIcon, MapIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SlideModel } from '@/lib/slide';
import type { SlideClient } from '@/lib/wasm/client';

/** Bounding box the overview is fitted into, in CSS pixels. */
const MAX_WIDTH = 168;
const MAX_HEIGHT = 208;

/** Longest edge requested from the decoder for the overview image. */
const SOURCE_SIZE = 512;

/**
 * The viewport indicator shrinks below a pixel at deep zoom, so it is never
 * drawn smaller than this and stays findable.
 */
const MIN_INDICATOR = 6;

interface MinimapProps {
  readonly map: Map | null;
  readonly model: SlideModel;
  readonly client: SlideClient;
  readonly slideKey: string;
}

/** Fits the slide into the overview box, preserving aspect ratio. */
function overviewSize(model: SlideModel): { width: number; height: number } {
  const scale = Math.min(MAX_WIDTH / model.width, MAX_HEIGHT / model.height);
  return {
    width: Math.max(1, Math.round(model.width * scale)),
    height: Math.max(1, Math.round(model.height * scale)),
  };
}

export function Minimap({ map, model, client, slideKey }: MinimapProps): React.JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const series = model.thumbnailSeries;

  const { width, height } = overviewSize(model);

  const query = useQuery({
    queryKey: ['overview', slideKey, series],
    enabled: series !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<ImageBitmap | null> =>
      series === null ? null : client.thumbnail(series, SOURCE_SIZE),
  });

  const bitmap = query.data ?? null;

  // The bitmap is mirrored into a ref so the postrender handler can read it
  // without being re-created on every repaint. Writing a ref during render is
  // not allowed, so it happens here.
  useEffect(() => {
    bitmapRef.current = bitmap;
    return (): void => {
      bitmapRef.current = null;
      bitmap?.close();
    };
  }, [bitmap]);

  /**
   * Repaints the overview and the viewport indicator.
   *
   * Called from the map's `postrender`, so it must stay imperative: routing
   * this through React state would re-render the whole viewer on every frame
   * of a pan.
   */
  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    const image = bitmapRef.current;
    if (canvas === null || image === null) return;

    const context = canvas.getContext('2d');
    if (context === null) return;

    const ratio = globalThis.devicePixelRatio;
    if (canvas.width !== Math.round(width * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    if (map === null) return;
    const size = map.getSize();
    if (size === undefined) return;
    const [viewWidth, viewHeight] = size;
    if (viewWidth === undefined || viewHeight === undefined) return;

    // The four viewport corners are converted through the map itself, so the
    // indicator follows rotation without any trigonometry here.
    const corners = (
      [
        [0, 0],
        [viewWidth, 0],
        [viewWidth, viewHeight],
        [0, viewHeight],
      ] as const
    ).map(([x, y]) => {
      const [mapX, mapY] = map.getCoordinateFromPixel([x, y]);
      // Map coordinates run negative downwards; the overview is top-left origin.
      return [
        ((mapX ?? 0) / model.width) * width,
        (-(mapY ?? 0) / model.height) * height,
      ] as const;
    });

    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const boxWidth = Math.max(...xs) - Math.min(...xs);
    const boxHeight = Math.max(...ys) - Math.min(...ys);

    context.lineWidth = 1.5;
    context.strokeStyle = 'oklch(0.7 0.19 25)';
    context.fillStyle = 'oklch(0.7 0.19 25 / 18%)';

    if (boxWidth < MIN_INDICATOR || boxHeight < MIN_INDICATOR) {
      // Too small to outline meaningfully: mark the centre instead.
      const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centreY = (Math.min(...ys) + Math.max(...ys)) / 2;
      context.beginPath();
      context.arc(centreX, centreY, MIN_INDICATOR / 2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      return;
    }

    context.beginPath();
    corners.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fill();
    context.stroke();
  }, [map, model.height, model.width, width, height]);

  useEffect(() => {
    if (map === null) return;
    draw();
    map.on('postrender', draw);
    return (): void => {
      map.un('postrender', draw);
    };
  }, [map, draw]);

  // Repaint once the overview image arrives, which may be after the last frame.
  useEffect(() => {
    if (bitmap !== null) draw();
  }, [bitmap, draw]);

  const recentre = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const view = map?.getView();
      if (view === undefined) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * model.width;
      const y = ((event.clientY - bounds.top) / bounds.height) * model.height;
      view.setCenter([x, -y]);
    },
    [map, model.height, model.width],
  );

  if (series === null) return null;

  return (
    <div className="absolute bottom-3 right-3 overflow-hidden rounded-md border bg-card/90 shadow-sm backdrop-blur">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <MapIcon className="size-3 text-muted-foreground" aria-hidden />
        <span className="text-[11px] font-medium text-muted-foreground">Overview</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto size-5"
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Show overview map' : 'Hide overview map'}
              onClick={(): void => {
                setCollapsed((value) => !value);
              }}
            >
              <ChevronDownIcon
                className={cn('size-3 transition-transform duration-200', collapsed && 'rotate-180')}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {collapsed ? 'Show overview map' : 'Hide overview map'}
          </TooltipContent>
        </Tooltip>
      </div>

      {!collapsed && (
        <div className="p-1.5" style={{ width: width + 12 }}>
          {query.isPending ? (
            <Skeleton style={{ width, height }} />
          ) : query.isError || bitmap === null ? (
            <p className="p-2 text-[11px] text-muted-foreground">Overview unavailable.</p>
          ) : (
            // The role and label sit on the wrapper because a canvas counts as
            // an interactive element. Clicking to recentre is a pointer-only
            // shortcut; the viewer itself is focusable and pans with the arrows.
            <div
              role="img"
              aria-label={`Overview of the slide, ${String(model.width)} by ${String(model.height)} pixels`}
            >
              <canvas
                ref={canvasRef}
                aria-hidden
                style={{ width, height }}
                className="block cursor-crosshair rounded-sm"
                onPointerDown={(event): void => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  recentre(event);
                }}
                onPointerMove={(event): void => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) recentre(event);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
