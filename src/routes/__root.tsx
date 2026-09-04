import { createRootRoute, Outlet } from '@tanstack/react-router';
import { LayoutTemplateIcon, MicroscopeIcon } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useLayoutStore } from '@/store/layout-store';

export const Route = createRootRoute({ component: RootLayout });

function RootLayout(): React.JSX.Element {
  const resetLayout = useLayoutStore((state) => state.reset);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <MicroscopeIcon className="size-4 text-muted-foreground" aria-hidden />
          <h1 className="text-sm font-semibold">WSI Viewer</h1>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Reset panel layout"
                  onClick={resetLayout}
                >
                  <LayoutTemplateIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Reset panel layout</TooltipContent>
            </Tooltip>
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1">
          <AppShell>
            <Outlet />
          </AppShell>
        </main>
      </div>
    </TooltipProvider>
  );
}
