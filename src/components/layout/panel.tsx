import { useCallback } from 'react';
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
import {
  DOCK_SIDES,
  PANEL_DRAG_TYPE,
  PANEL_GROWS,
  PANEL_TITLES,
  type DockSide,
  type PanelId,
} from '@/lib/layout';

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
  readonly onToggle: () => void;
  readonly onMove: (side: DockSide) => void;
  readonly onDragStateChange: (dragging: boolean) => void;
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
  onToggle,
  onMove,
  onDragStateChange,
  children,
}: PanelProps): React.JSX.Element {
  const title = PANEL_TITLES[id];
  const grows = PANEL_GROWS[id] && !collapsed;

  const onDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      event.dataTransfer.setData(PANEL_DRAG_TYPE, id);
      event.dataTransfer.effectAllowed = 'move';
      onDragStateChange(true);
    },
    [id, onDragStateChange],
  );

  const onDragEnd = useCallback((): void => {
    onDragStateChange(false);
  }, [onDragStateChange]);

  return (
    <section
      aria-label={title}
      className={cn('flex min-h-0 shrink-0 flex-col border-b last:border-b-0', grows && 'flex-1')}
    >
      {/* Dragging the header is a pointer affordance; the "Move to" menu below
          does the same job for keyboard users. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="flex cursor-grab items-center gap-1 bg-muted/40 px-1.5 py-1 active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-5" aria-label={`Move ${title} panel`}>
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

      {!collapsed && (
        <div className={cn('min-h-0 overflow-auto', grows ? 'flex-1' : 'max-h-[40vh]')}>
          {children}
        </div>
      )}
    </section>
  );
}
