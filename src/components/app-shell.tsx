import { useMemo } from 'react';
import { DockFrame } from './layout/dock-frame';
import { SlideContext } from './slide-context';
import { FoldersPanel } from './panels/folders-panel';
import { SlidePanel } from './panels/slide-panel';
import { PyramidPanel } from './panels/pyramid-panel';
import { FormatMetadataPanel } from './panels/format-metadata-panel';
import { EmptyState } from './panels/empty-state';
import { AssociatedImages } from './sidebar/associated-images';
import { useSlide } from '@/hooks/use-slide';
import { useSlideStore } from '@/store/slide-store';
import type { PanelId } from '@/lib/layout';

/**
 * Owns the open slide and the docked panels.
 *
 * The shell sits above the router so the folder tree and metadata survive
 * navigation between the picker and the viewer, rather than being torn down and
 * rebuilt each time.
 */
export function AppShell({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const file = useSlideStore((state) => state.file);
  const companions = useSlideStore((state) => state.companions);
  const { client, query } = useSlide(file, companions);

  const model = query.data?.model ?? null;
  const slideKey = file === null ? 'none' : `${file.name}:${String(file.size)}`;

  const session = useMemo(() => ({ client, query, file }), [client, query, file]);

  const content: Record<PanelId, React.ReactNode> = {
    folders: <FoldersPanel />,
    slide: <SlidePanel model={model} fileName={file?.name ?? null} />,
    pyramid: <PyramidPanel model={model} />,
    associated:
      model === null || client === null ? (
        <EmptyState>No slide open.</EmptyState>
      ) : model.associated.length === 0 ? (
        <EmptyState>This slide has no label or macro images.</EmptyState>
      ) : (
        <div className="p-3">
          <AssociatedImages series={model.associated} client={client} slideKey={slideKey} />
        </div>
      ),
    metadata: <FormatMetadataPanel model={model} />,
  };

  return (
    <SlideContext.Provider value={session}>
      <DockFrame content={content}>{children}</DockFrame>
    </SlideContext.Provider>
  );
}
