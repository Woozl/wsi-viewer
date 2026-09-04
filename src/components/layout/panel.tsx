import { ChevronDownIcon, GripVerticalIcon, MoveIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DOCK_SIDES, PANEL_GROWS, PANEL_TITLES, type DockSide, type PanelId } from '@/lib/layout';

const SIDE_LABELS: Readonly<Record<DockSide, string>> = {
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
};

interface PanelProps {
  readonly id: PanelId;
  readonly side: DockSide;
  readonly collapsed: boolean;
  readonly dragging: boolean;
  readonly onToggle: () => void;
  readonly onMove: (side: DockSide) => void;
  readonly onDragStart: (event: React.PointerEvent) => void;
  readonly children: React.ReactNode;
}

/**
 * One collapsible section within a dock.
 *
 * Dragging the header moves the panel between docks. That is pointer-only, so
 * the header also carries a "Move to" menu, which is the keyboard path to the
 * same thing.
 */
export function Panel({
  id,
  side,
  collapsed,
  dragging,
  onToggle,
  onMove,
  onDragStart,
  children,
}: PanelProps): React.JSX.Element {
  const title = PANEL_TITLES[id];
  const grows = PANEL_GROWS[id] && !collapsed;

  return (
    <section
      data-panel-id={id}
      aria-label={title}
      className={cn(
        'flex min-h-0 shrink-0 flex-col border-b transition-opacity last:border-b-0',
        grows && 'flex-1',
        // The panel stays in place while dragging; dimming it shows which one
        // is in flight without the layout jumping under the pointer.
        dragging && 'opacity-40',
      )}
    >
      <div
        onPointerDown={onDragStart}
        className="flex touch-none items-center gap-1 bg-muted/40 px-1.5 py-1"
      >
        <span
          aria-hidden
          className="flex cursor-grab items-center active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-3 shrink-0 text-muted-foreground" />
        </span>
        <h2 className="min-w-0 flex-1 cursor-grab truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground active:cursor-grabbing">
          {title}
        </h2>

        {/* Stops a press on the controls from starting a drag. */}
        <div
          className="flex items-center"
          onPointerDown={(event): void => {
            event.stopPropagation();
          }}
        >
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-5"
                    aria-label={`Move ${title} panel`}
                  >
                    <MoveIcon className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Move {title} to another edge</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={side}
                onValueChange={(value): void => {
                  const target = DOCK_SIDES.find((known) => known === value);
                  if (target !== undefined) onMove(target);
                }}
              >
                {DOCK_SIDES.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    {SIDE_LABELS[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon-sm"
            className="size-5"
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            onClick={onToggle}
          >
            <ChevronDownIcon
              className={cn('size-3 transition-transform duration-200', collapsed && '-rotate-90')}
            />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className={cn('min-h-0 overflow-auto', grows ? 'flex-1' : 'max-h-[40vh]')}>
          {children}
        </div>
      )}
    </section>
  );
}
