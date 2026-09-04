import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { clampDockSize, MIN_DOCK_SIZE, type DockSide } from '@/lib/layout';

/** Pixels a single arrow-key press moves the divider. */
const KEYBOARD_STEP = 16;

interface ResizeHandleProps {
  readonly side: DockSide;
  readonly size: number;
  readonly onResize: (size: number) => void;
}

const VERTICAL_EDGE: Readonly<Record<DockSide, boolean>> = {
  left: true,
  right: true,
  top: false,
  bottom: false,
};

/**
 * Divider between a dock and the viewport.
 *
 * Exposed as a real separator so it is reachable by keyboard: dragging is a
 * pointer affordance, and the arrow keys do the same job for everyone else.
 */
export function ResizeHandle({ side, size, onResize }: ResizeHandleProps): React.JSX.Element {
  const vertical = VERTICAL_EDGE[side];

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      const startPosition = vertical ? event.clientX : event.clientY;
      const startSize = size;
      // Left and top docks grow as the pointer moves away from the edge; right
      // and bottom grow as it moves towards it.
      const direction = side === 'left' || side === 'top' ? 1 : -1;
      const available = vertical ? globalThis.innerWidth : globalThis.innerHeight;

      const onMove = (move: PointerEvent): void => {
        const position = vertical ? move.clientX : move.clientY;
        onResize(clampDockSize(startSize + (position - startPosition) * direction, available));
      };
      const onUp = (): void => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [onResize, side, size, vertical],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const grow = vertical ? 'ArrowRight' : 'ArrowDown';
      const shrink = vertical ? 'ArrowLeft' : 'ArrowUp';
      if (event.key !== grow && event.key !== shrink) return;
      event.preventDefault();

      const direction = side === 'left' || side === 'top' ? 1 : -1;
      const step = (event.key === grow ? KEYBOARD_STEP : -KEYBOARD_STEP) * direction;
      const available = vertical ? globalThis.innerWidth : globalThis.innerHeight;
      onResize(clampDockSize(size + step, available));
    },
    [onResize, side, size, vertical],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={`Resize the ${side} panel`}
      aria-valuenow={Math.round(size)}
      aria-valuemin={MIN_DOCK_SIZE}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative shrink-0 bg-border transition-colors hover:bg-ring focus-visible:bg-ring',
        vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
      )}
    >
      {/* A one-pixel divider is far too small to hit, so the grab area is
          widened invisibly on both sides. */}
      <span
        aria-hidden
        className={cn(
          'absolute',
          vertical ? '-inset-x-1 inset-y-0' : '-inset-y-1 inset-x-0',
        )}
      />
      {/* Visible grip, so it is obvious the edge can be dragged. */}
      <span
        aria-hidden
        className={cn(
          'absolute rounded-full bg-border transition-colors group-hover:bg-ring group-focus-visible:bg-ring',
          vertical
            ? 'left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2'
            : 'left-1/2 top-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2',
        )}
      />
    </div>
  );
}
