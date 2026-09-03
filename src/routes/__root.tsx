import { createRootRoute, Outlet } from '@tanstack/react-router';
import { MicroscopeIcon } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout(): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <MicroscopeIcon className="size-4 text-muted-foreground" aria-hidden />
          <h1 className="text-sm font-semibold">WSI Viewer</h1>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}
