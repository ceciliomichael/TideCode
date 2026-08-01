import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { TerminalDataEvent, TerminalExitEvent } from "../../../types/chat";
import type { TabTerminalInstance } from "./terminalInstance";
import type { TerminalWorkspaceState } from "./terminalSessionStateTypes";
import type { TerminalTabState } from "./workspaceTerminalPanelTypes";
import { getWorkspaceKeyFromTerminalTabKey } from "./workspaceTerminalPanelUtils";

interface UseTerminalSessionEventsInput {
  activeWorkspaceKeyRef: MutableRefObject<string>;
  sessionIdToTabKeyRef: MutableRefObject<Map<number, string>>;
  setTerminalTabs: Dispatch<SetStateAction<TerminalTabState[]>>;
  tabBuffersRef: MutableRefObject<Map<string, string>>;
  tabInstancesRef: MutableRefObject<Map<string, TabTerminalInstance>>;
  terminalWorkspaceStateRef: MutableRefObject<Record<string, TerminalWorkspaceState>>;
}

export function useTerminalSessionEvents({
  activeWorkspaceKeyRef,
  sessionIdToTabKeyRef,
  setTerminalTabs,
  tabBuffersRef,
  tabInstancesRef,
  terminalWorkspaceStateRef,
}: UseTerminalSessionEventsInput) {
  useEffect(() => {
    const unsubscribeData = window.echosphereTerminal.onData((event: TerminalDataEvent) => {
      const tabKey = sessionIdToTabKeyRef.current.get(event.sessionId);
      if (!tabKey) return;

      const currentBuffer = tabBuffersRef.current.get(tabKey) ?? "";
      tabBuffersRef.current.set(tabKey, currentBuffer + event.data);
      tabInstancesRef.current.get(tabKey)?.terminal.write(event.data);
    });

    const unsubscribeExit = window.echosphereTerminal.onExit((event: TerminalExitEvent) => {
      const tabKey = sessionIdToTabKeyRef.current.get(event.sessionId);
      if (!tabKey) return;

      const workspaceKey =
        getWorkspaceKeyFromTerminalTabKey(tabKey) ?? activeWorkspaceKeyRef.current;
      sessionIdToTabKeyRef.current.delete(event.sessionId);
      const exitMessage = `\r\n\r\n[Terminal session ended with code ${event.exitCode}]`;
      tabBuffersRef.current.set(
        tabKey,
        `${tabBuffersRef.current.get(tabKey) ?? ""}${exitMessage}`,
      );

      const markExited = (tabs: TerminalTabState[]) => tabs.map((tab) =>
        tab.key === tabKey
          ? { ...tab, exitCode: event.exitCode, sessionId: null, status: "exited" as const }
          : tab,
      );
      setTerminalTabs(markExited);

      const instance = tabInstancesRef.current.get(tabKey);
      if (instance) {
        instance.terminal.writeln(exitMessage);
        return;
      }
      const storedWorkspaceState = terminalWorkspaceStateRef.current[workspaceKey];
      if (storedWorkspaceState) {
        storedWorkspaceState.terminalTabs = markExited(storedWorkspaceState.terminalTabs);
      }
    });

    return () => {
      unsubscribeData();
      unsubscribeExit();
    };
  }, [
    activeWorkspaceKeyRef,
    sessionIdToTabKeyRef,
    setTerminalTabs,
    tabBuffersRef,
    tabInstancesRef,
    terminalWorkspaceStateRef,
  ]);
}
