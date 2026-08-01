import { useEffect, type MutableRefObject } from "react";
import type { TerminalTabState } from "./workspaceTerminalPanelTypes";

interface UseSyncedTerminalStateRefsOptions {
  activeSessionIdRef: MutableRefObject<number | null>;
  activeTabKeyRef: MutableRefObject<string | null>;
  activeTerminalTab: TerminalTabState | null;
  activeTerminalTabKey: string | null;
  activeWorkspaceKeyRef: MutableRefObject<string>;
  terminalTabs: TerminalTabState[];
  terminalTabsRef: MutableRefObject<TerminalTabState[]>;
  workspaceKey: string;
  workspacePath: string | null;
  workspacePathRef: MutableRefObject<string | null>;
}

export function useSyncedTerminalStateRefs({
  activeSessionIdRef,
  activeTabKeyRef,
  activeTerminalTab,
  activeTerminalTabKey,
  activeWorkspaceKeyRef,
  terminalTabs,
  terminalTabsRef,
  workspaceKey,
  workspacePath,
  workspacePathRef,
}: UseSyncedTerminalStateRefsOptions) {
  useEffect(() => {
    terminalTabsRef.current = terminalTabs;
  }, [terminalTabs, terminalTabsRef]);

  useEffect(() => {
    workspacePathRef.current = workspacePath;
  }, [workspacePath, workspacePathRef]);

  useEffect(() => {
    activeWorkspaceKeyRef.current = workspaceKey;
  }, [activeWorkspaceKeyRef, workspaceKey]);

  useEffect(() => {
    activeTabKeyRef.current = activeTerminalTabKey;
    activeSessionIdRef.current = activeTerminalTab?.sessionId ?? null;
  }, [activeSessionIdRef, activeTabKeyRef, activeTerminalTab, activeTerminalTabKey]);
}
