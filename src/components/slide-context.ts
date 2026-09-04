import { createContext, useContext } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { OpenedSlide } from '@/hooks/use-slide';
import type { SlideClient } from '@/lib/wasm/client';

export interface SlideSession {
  readonly client: SlideClient | null;
  readonly query: UseQueryResult<OpenedSlide>;
  readonly file: File | null;
}

/**
 * The open slide, provided by the app shell.
 *
 * The shell owns it because the docked panels and the viewer both need it, and
 * they live in different parts of the tree.
 */
export const SlideContext = createContext<SlideSession | null>(null);

export function useSlideSession(): SlideSession {
  const session = useContext(SlideContext);
  if (session === null) throw new Error('useSlideSession must be used inside the app shell');
  return session;
}
