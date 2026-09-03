import { useCallback, useState } from 'react';
import {
  Button as AriaButton,
  Collection,
  Tree,
  TreeItem,
  TreeItemContent,
  type Key,
} from 'react-aria-components';
import { ChevronRightIcon, FileIcon, FolderIcon, Loader2Icon } from 'lucide-react';
import {
  isDirectoryHandle,
  isFileHandle,
  listDirectory,
  requestPermission,
  type DirectoryEntry,
} from '@/lib/fs-access';
import { cn } from '@/lib/utils';

/** A node as the tree renders it, with children resolved so far. */
interface TreeNode {
  readonly id: string;
  readonly name: string;
  readonly kind: 'file' | 'directory';
  readonly supported: boolean;
  readonly handle: FileSystemDirectoryHandle | FileSystemFileHandle | null;
  readonly children: readonly TreeNode[];
  readonly pending: boolean;
}

/**
 * A directory whose contents have not been read yet still needs to look
 * expandable, and react-aria decides that from whether it has child items. An
 * explicit placeholder child gives the disclosure something to render until the
 * real entries arrive.
 */
function placeholder(parentId: string): TreeNode {
  return {
    id: `${parentId}::pending`,
    name: 'Loading…',
    kind: 'file',
    supported: false,
    handle: null,
    children: [],
    pending: true,
  };
}

interface DirectoryTreeProps {
  readonly roots: readonly FileSystemDirectoryHandle[];
  readonly onOpenFile: (file: File) => void;
}

export function DirectoryTree({ roots, onOpenFile }: DirectoryTreeProps): React.JSX.Element {
  const [entries, setEntries] = useState<ReadonlyMap<string, readonly DirectoryEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<Key>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);

  const build = useCallback(
    (entry: DirectoryEntry): TreeNode => {
      const loaded = entries.get(entry.id);
      return {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        supported: entry.supported,
        handle: entry.handle,
        pending: false,
        children:
          entry.kind !== 'directory'
            ? []
            : loaded === undefined
              ? [placeholder(entry.id)]
              : loaded.map(build),
      };
    },
    [entries],
  );

  const rootNodes: TreeNode[] = roots.map((handle) =>
    build({ id: handle.name, name: handle.name, kind: 'directory', handle, supported: false }),
  );

  const onExpandedChange = useCallback(
    (keys: Set<Key>): void => {
      setExpanded(keys);
      for (const key of keys) {
        if (typeof key !== 'string' || entries.has(key)) continue;
        const handle = findHandle(rootNodes, key)?.handle ?? null;
        if (handle === null || !isDirectoryHandle(handle)) continue;
        void listDirectory(handle, key)
          .then((children) => {
            setEntries((current) => new Map(current).set(key, children));
          })
          .catch((error: unknown) => {
            setFailed(error instanceof Error ? error.message : 'could not read folder');
          });
      }
    },
    [entries, rootNodes],
  );

  const onAction = useCallback(
    (key: Key): void => {
      const handle = findHandle(rootNodes, String(key))?.handle ?? null;
      if (handle === null || !isFileHandle(handle)) return;
      void (async (): Promise<void> => {
        try {
          if (!(await requestPermission(handle))) {
            setFailed('Permission to read that file was declined.');
            return;
          }
          onOpenFile(await handle.getFile());
        } catch (error) {
          setFailed(error instanceof Error ? error.message : 'could not open that file');
        }
      })();
    },
    [onOpenFile, rootNodes],
  );

  return (
    <div className="space-y-2">
      {failed !== null && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {failed}
        </p>
      )}
      <Tree
        aria-label="Slide folders"
        selectionMode="single"
        expandedKeys={expanded}
        onExpandedChange={onExpandedChange}
        onAction={onAction}
        items={rootNodes}
        className="text-xs"
      >
        {function renderNode(node: TreeNode): React.JSX.Element {
          return (
            <TreeItem
              textValue={node.name}
              className={cn(
                'outline-none',
                // Newly revealed rows fade in rather than appearing abruptly.
                'animate-in fade-in-0 slide-in-from-top-1 duration-150',
              )}
            >
              <TreeItemContent>
                {({ isExpanded, hasChildItems, level, isFocusVisible, isSelected }) => (
                  <div
                    style={{ paddingLeft: `${String((level - 1) * 12 + 4)}px` }}
                    className={cn(
                      'flex items-center gap-1 rounded-sm py-1 pr-1',
                      isSelected && 'bg-accent',
                      isFocusVisible && 'outline outline-2 outline-offset-[-2px] outline-ring',
                      node.kind === 'file' && !node.supported && !node.pending && 'opacity-50',
                    )}
                  >
                    {hasChildItems ? (
                      <AriaButton
                        slot="chevron"
                        className="flex size-4 shrink-0 items-center justify-center rounded-sm outline-none"
                      >
                        <ChevronRightIcon
                          className={cn(
                            'size-3.5 transition-transform duration-200',
                            isExpanded && 'rotate-90',
                          )}
                        />
                      </AriaButton>
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    {node.pending ? (
                      <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : node.kind === 'directory' ? (
                      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{node.name}</span>
                  </div>
                )}
              </TreeItemContent>
              <Collection items={node.children}>{renderNode}</Collection>
            </TreeItem>
          );
        }}
      </Tree>
    </div>
  );
}

/** Depth-first lookup; the tree is small enough that an index is not worth it. */
function findHandle(nodes: readonly TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findHandle(node.children, id);
    if (found !== null) return found;
  }
  return null;
}
