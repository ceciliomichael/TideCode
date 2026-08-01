import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { TerminalWorkspaceState } from "./terminalSessionStateTypes";
import type { TerminalTabState } from "./workspaceTerminalPanelTypes";

interface UseTerminalWorkspacePersistenceOptions {
  activeSessionIdRef: MutableRefObject<number | null>;
  activeTabKeyRef: MutableRefObject<string | null>;
  activeTerminalTabKey: string | null;
  nextTabIndexRef: MutableRefObject<number>;
  setActiveTerminalTabKey: Dispatch<SetStateAction<string | null>>;
  setTerminalTabs: Dispatch<SetStateAction<TerminalTabState[]>>;
  terminalTabs: TerminalTabState[];
  terminalTabsRef: MutableRefObject<TerminalTabState[]>;
  terminalWorkspaceStateRef: MutableRefObject<Record<string, TerminalWorkspaceState>>;
  updateTabVisibility: (nextActiveKey: string | null) => void;
  workspaceKey: string;
}

export function useTerminalWorkspacePersistence({
  activeSessionIdRef,
  activeTabKeyRef,
  activeTerminalTabKey,
  nextTabIndexRef,
  setActiveTerminalTabKey,
  setTerminalTabs,
  terminalTabs,
  terminalTabsRef,
  terminalWorkspaceStateRef,
  updateTabVisibility,
  workspaceKey,
}: UseTerminalWorkspacePersistenceOptions) {
  const previousWorkspaceKeyRef = useRef(workspaceKey);

  useEffect(() => {
    const nextWorkspaceKey = workspaceKey;
    const previousWorkspaceKey = previousWorkspaceKeyRef.current;
    if (previousWorkspaceKey === nextWorkspaceKey) {
      return;
    }

    terminalWorkspaceStateRef.current[previousWorkspaceKey] = {
      activeTerminalTabKey,
      nextTabIndex: nextTabIndexRef.current,
      terminalTabs,
    };

    const nextWorkspaceState = terminalWorkspaceStateRef.current[nextWorkspaceKey] ?? {
      activeTerminalTabKey: null,
      nextTabIndex: 1,
      terminalTabs: [],
    };
    previousWorkspaceKeyRef.current = nextWorkspaceKey;

    if (nextWorkspaceState.terminalTabs.length === 0) {
      setTerminalTabs([]);
      setActiveTerminalTabKey(null);
      nextTabIndexRef.current = 1;
      terminalTabsRef.current = [];
      activeTabKeyRef.current = null;
      activeSessionIdRef.current = null;
      updateTabVisibility(null);
      return;
    }

    setTerminalTabs(nextWorkspaceState.terminalTabs);
    setActiveTerminalTabKey(nextWorkspaceState.activeTerminalTabKey);
    nextTabIndexRef.current = nextWorkspaceState.nextTabIndex;
    terminalTabsRef.current = nextWorkspaceState.terminalTabs;
    activeTabKeyRef.current = nextWorkspaceState.activeTerminalTabKey;
    activeSessionIdRef.current = nextWorkspaceState.terminalTabs.find(
      (tab) => tab.key === nextWorkspaceState.activeTerminalTabKey,
    )?.sessionId ?? null;
    updateTabVisibility(nextWorkspaceState.activeTerminalTabKey);
  }, [
    activeSessionIdRef,
    activeTabKeyRef,
    activeTerminalTabKey,
    nextTabIndexRef,
    setActiveTerminalTabKey,
    setTerminalTabs,
    terminalTabs,
    terminalTabsRef,
    terminalWorkspaceStateRef,
    updateTabVisibility,
    workspaceKey,
  ]);
}
