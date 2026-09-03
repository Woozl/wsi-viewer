import { ThemeProvider as NextThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * Light/dark/system theming. `next-themes` writes the resolved class to <html>
 * before paint, which avoids a flash of the wrong theme on load.
 */
export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <NextThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemeProvider>
  );
}
