import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { TerminalDataEvent, TerminalExitEvent } from "../../../types/chat";
import type { TabTerminalInstance } from "./terminalInstance";
import type { TerminalWorkspaceState } from "./terminalSessionStateTypes";
import type { TerminalTabState } from "./workspaceTerminalPanelTypes";
import { appendTerminalReplayBuffer } from "./terminalOutputBuffer";
import { getWorkspaceKeyFromTerminalTabKey, isTerminalSessionEventCurrent } from "./workspaceTerminalPanelUtils";

interface UseTerminalSessionEventsInput {
  activeWorkspaceKeyRef: MutableRefObject<string>;
  sessionIdToTabKeyRef: MutableRefObject<Map<number, string>>;
  terminalTabsRef: MutableRefObject<TerminalTabState[]>;
  setTerminalTabs: Dispatch<SetStateAction<TerminalTabState[]>>;
  tabBuffersRef: MutableRefObject<Map<string, string>>;
  tabInstancesRef: MutableRefObject<Map<string, TabTerminalInstance>>;
  terminalWorkspaceStateRef: MutableRefObject<Record<string, TerminalWorkspaceState>>;
}

export function useTerminalSessionEvents({
  activeWorkspaceKeyRef,
  sessionIdToTabKeyRef,
  setTerminalTabs,
  terminalTabsRef,
  tabBuffersRef,
  tabInstancesRef,
  terminalWorkspaceStateRef,
}: UseTerminalSessionEventsInput) {
  useEffect(() => {
    function findEventTab(event: TerminalDataEvent | TerminalExitEvent) {
      const tabKey = sessionIdToTabKeyRef.current.get(event.sessionId);
      if (!tabKey) {
        return null;
      }
      const workspaceKey = getWorkspaceKeyFromTerminalTabKey(tabKey) ?? activeWorkspaceKeyRef.current;
      const tabs = workspaceKey === activeWorkspaceKeyRef.current
        ? terminalTabsRef.current
        : terminalWorkspaceStateRef.current[workspaceKey]?.terminalTabs ?? [];
      const tab = tabs.find((candidate) => candidate.key === tabKey);
      if (!tab || !isTerminalSessionEventCurrent(tab, event)) {
        return null;
      }
      return tab;
    }

    const unsubscribeData = window.tidecodeTerminal.onData((event: TerminalDataEvent) => {
      const tab = findEventTab(event);
      if (!tab) {
        return;
      }
      const tabKey = tab.key;

      const currentBuffer = tabBuffersRef.current.get(tabKey) ?? "";
      tabBuffersRef.current.set(tabKey, appendTerminalReplayBuffer(currentBuffer, event.data));
      tabInstancesRef.current.get(tabKey)?.terminal.write(event.data);
    });

    const unsubscribeExit = window.tidecodeTerminal.onExit((event: TerminalExitEvent) => {
      const tab = findEventTab(event);
      if (!tab) {
        return;
      }
      const tabKey = tab.key;

      const workspaceKey =
        getWorkspaceKeyFromTerminalTabKey(tabKey) ?? activeWorkspaceKeyRef.current;
      sessionIdToTabKeyRef.current.delete(event.sessionId);
      const exitMessage = `\r\n\r\n[Terminal session ended with code ${event.exitCode}]`;
      tabBuffersRef.current.set(
        tabKey,
        appendTerminalReplayBuffer(tabBuffersRef.current.get(tabKey) ?? "", exitMessage),
      );

      const markExited = (tabs: TerminalTabState[]) => tabs.map((tab) =>
        tab.key === tabKey && isTerminalSessionEventCurrent(tab, event)
          ? { ...tab, brokerSessionId: null, errorMessage: null, exitCode: event.exitCode, sessionId: null, status: "exited" as const }
          : tab,
      );
      if (workspaceKey === activeWorkspaceKeyRef.current) {
        const nextTabs = markExited(terminalTabsRef.current);
        terminalTabsRef.current = nextTabs;
        setTerminalTabs(nextTabs);
      }

      const instance = tabInstancesRef.current.get(tabKey);
      if (instance) {
        instance.terminal.writeln(exitMessage);
      }
      const storedWorkspaceState = terminalWorkspaceStateRef.current[workspaceKey];
      if (storedWorkspaceState && workspaceKey !== activeWorkspaceKeyRef.current) {
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
    terminalTabsRef,
    tabBuffersRef,
    tabInstancesRef,
    terminalWorkspaceStateRef,
  ]);
}
