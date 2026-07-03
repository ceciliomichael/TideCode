import { useCallback, useState, type DragEvent as ReactDragEvent } from "react";

interface UseWorkspaceTerminalTabDragDropArgs {
  reorderTerminalTabs: (
    sourceTabKey: string,
    targetTabKey: string,
    position: "before" | "after",
  ) => void;
}

export interface TabDragDropHandlers {
  draggable: boolean;
  onDragStart: (event: ReactDragEvent<HTMLElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: (event: ReactDragEvent<HTMLElement>) => void;
}

export interface WorkspaceTerminalTabDragDropState {
  draggedTabKey: string | null;
  dragOverTabKey: string | null;
  dropPosition: "before" | "after" | null;
  getTabDragHandlers: (tabKey: string) => TabDragDropHandlers;
}

export function useWorkspaceTerminalTabDragDrop({
  reorderTerminalTabs,
}: UseWorkspaceTerminalTabDragDropArgs): WorkspaceTerminalTabDragDropState {
  const [draggedTabKey, setDraggedTabKey] = useState<string | null>(null);
  const [dragOverTabKey, setDragOverTabKey] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null);

  const getTabDragHandlers = useCallback(
    (tabKey: string): TabDragDropHandlers => {
      const onDragStart = (event: ReactDragEvent<HTMLElement>) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tabKey);
        setDraggedTabKey(tabKey);
      };

      const onDragOver = (event: ReactDragEvent<HTMLElement>) => {
        if (!draggedTabKey || draggedTabKey === tabKey) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";

        const rect = event.currentTarget.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        const nextPosition = event.clientX < midpoint ? "before" : "after";

        setDragOverTabKey((current) => (current !== tabKey ? tabKey : current));
        setDropPosition((current) => (current !== nextPosition ? nextPosition : current));
      };

      const onDragLeave = (event: ReactDragEvent<HTMLElement>) => {
        const relatedTarget = event.relatedTarget as Node | null;
        if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
          return;
        }

        setDragOverTabKey((current) => (current === tabKey ? null : current));
        setDropPosition((current) => (current ? null : current));
      };

      const onDrop = (event: ReactDragEvent<HTMLElement>) => {
        event.preventDefault();
        const sourceTabKey = event.dataTransfer.getData("text/plain") || draggedTabKey;
        if (sourceTabKey && sourceTabKey !== tabKey && dropPosition) {
          reorderTerminalTabs(sourceTabKey, tabKey, dropPosition);
        }

        setDraggedTabKey(null);
        setDragOverTabKey(null);
        setDropPosition(null);
      };

      const onDragEnd = () => {
        setDraggedTabKey(null);
        setDragOverTabKey(null);
        setDropPosition(null);
      };

      return {
        draggable: true,
        onDragStart,
        onDragOver,
        onDragLeave,
        onDrop,
        onDragEnd,
      };
    },
    [draggedTabKey, dropPosition, reorderTerminalTabs],
  );

  return {
    draggedTabKey,
    dragOverTabKey,
    dropPosition,
    getTabDragHandlers,
  };
}
