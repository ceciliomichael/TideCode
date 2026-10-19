import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REMOTE_EVENT_CHANNELS } from "../../../remote/protocol";
import { isRemoteMobileViewportRuntime } from "../../../hooks/useIsMobileViewport";
import type { TerminalTabState } from "./workspaceTerminalPanelTypes";
import {
  createTerminalInstance,
  disposeTerminalInstance,
  type TabTerminalInstance,
} from "./terminalInstance";
import type {
  TerminalWorkspaceState,
  UseWorkspaceTerminalSessionStateArgs,
  WorkspaceTerminalSessionState,
} from "./terminalSessionStateTypes";
import { useTerminalSessionEvents } from "./useTerminalSessionEvents";
import { useTerminalSizing } from "./useTerminalSizing";
import { useTerminalWorkspacePersistence } from "./useTerminalWorkspacePersistence";
import { useSyncedTerminalStateRefs } from "./useSyncedTerminalStateRefs";
import { useTerminalInstanceCleanup } from "./useTerminalInstanceCleanup";
import { boundTerminalReplayBuffer } from "./terminalOutputBuffer";
import {
  createTerminalTabLabel,
  createTerminalTabKey,
  getUserFacingErrorMessage,
  getSessionDimensions,
  getWorkspaceKeyFromTerminalTabKey,
  isCurrentTerminalTabGeneration,
  isTerminalSessionEventCurrent,
  nextTerminalTabGeneration,
  reorderTabList,
  resolveTerminalSessionWorkspaceRootPath,
  sanitizeTerminalBuffer,
} from "./workspaceTerminalPanelUtils";
import "@xterm/xterm/css/xterm.css";
import { startTerminalSession } from "./terminalSessionLifecycle";

export function useWorkspaceTerminalSessionState({
autoCreateTabOnOpen = false,
  isOpen,
  isResizing,
  onClose,
  resolvedTheme,
  workspaceKey,
  workspacePath,
}: UseWorkspaceTerminalSessionStateArgs): WorkspaceTerminalSessionState {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const tabInstancesRef = useRef<Map<string, TabTerminalInstance>>(new Map());
  const workspacePathRef = useRef<string | null>(workspacePath);
  const activeWorkspaceKeyRef = useRef(workspaceKey);
  const isResizingRef = useRef(isResizing);
  const terminalWorkspaceStateRef = useRef<Record<string, TerminalWorkspaceState>>({});
  const terminalTabsRef = useRef<TerminalTabState[]>([]);
  const nextTabIndexRef = useRef(1);
  const activeTabKeyRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<number | null>(null);
  const sessionIdToTabKeyRef = useRef<Map<number, string>>(new Map());
  const tabGenerationRef = useRef<Map<string, number>>(new Map());
  const tabBuffersRef = useRef<Map<string, string>>(new Map());
  const restartTerminalTabRef = useRef<(tabKey: string) => void>(() => undefined);
  const invalidateTabGeneration = useCallback((tabKey: string) =>
    nextTerminalTabGeneration(tabGenerationRef.current, tabKey), []);
  const isCurrentGeneration = useCallback((tabKey: string, generation: number) =>
    isCurrentTerminalTabGeneration(tabGenerationRef.current, tabKey, generation), []);
  const updateSessionTab = useCallback((
    tabKey: string,
    update: (tab: TerminalTabState) => TerminalTabState,
  ) => {
    const tabWorkspaceKey = getWorkspaceKeyFromTerminalTabKey(tabKey);
    if (tabWorkspaceKey === activeWorkspaceKeyRef.current) {
      const nextTabs = terminalTabsRef.current.map((tab) =>
        tab.key === tabKey ? update(tab) : tab);
      terminalTabsRef.current = nextTabs;
      setTerminalTabs(nextTabs);
    } else {
      const stored = tabWorkspaceKey ? terminalWorkspaceStateRef.current[tabWorkspaceKey] : undefined;
      if (stored) {
        stored.terminalTabs = stored.terminalTabs.map((tab) =>
          tab.key === tabKey ? update(tab) : tab);
      }
    }
  }, []);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabState[]>([]);
  const [activeTerminalTabKey, setActiveTerminalTabKey] = useState<string | null>(null);

  const activeTerminalTab = useMemo(
    () => terminalTabs.find((tab) => tab.key === activeTerminalTabKey) ?? null,
    [activeTerminalTabKey, terminalTabs],
  );
  useSyncedTerminalStateRefs({
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
  });
  useTerminalInstanceCleanup(tabInstancesRef);

  const getActiveTerminalSessionWorkspaceRootPath = useCallback((tabKey?: string | null) => {
    const targetKey = tabKey ?? activeTabKeyRef.current;
    if (!targetKey) {
      return null;
    }

    const targetTab = terminalTabsRef.current.find((tab) => tab.key === targetKey) ?? null;
    return resolveTerminalSessionWorkspaceRootPath(targetTab?.workspaceRootPath);
  }, []);

  const {
    sendTerminalSizeToSession,
    syncTabSize,
  } = useTerminalSizing({
    activeTerminalTabKey,
    activeTabKeyRef,
    getWorkspaceRootPath: getActiveTerminalSessionWorkspaceRootPath,
    isOpen,
    isResizing,
    isResizingRef,
    resolvedTheme,
    tabInstancesRef,
    terminalHostRef,
    terminalTabsRef,
    workspaceKey,
  });

  const ensureTabInstance = useCallback(
    (tabKey: string): TabTerminalInstance => {
      const existingInstance = tabInstancesRef.current.get(tabKey);
      const hostElement = terminalHostRef.current;
      if (existingInstance) {
        if (hostElement && !hostElement.contains(existingInstance.container)) {
          hostElement.appendChild(existingInstance.container);
        }
        return existingInstance;
      }

      const instance = createTerminalInstance({
        activeTabKey: activeTabKeyRef.current,
        getWorkspaceRootPath: getActiveTerminalSessionWorkspaceRootPath,
        hostElement,
        resolvedTheme,
        restartTab: (targetTabKey) => restartTerminalTabRef.current(targetTabKey),
        sendTerminalSize: sendTerminalSizeToSession,
        setTerminalTabs,
        tabKey,
        terminalTabsRef,
      });
      tabInstancesRef.current.set(tabKey, instance);
      return instance;
    },
    [getActiveTerminalSessionWorkspaceRootPath, resolvedTheme, sendTerminalSizeToSession],
  );

  const disposeTabInstance = useCallback((tabKey: string) => {
    const instance = tabInstancesRef.current.get(tabKey);
    if (!instance) {
      return;
    }

    disposeTerminalInstance(instance);
    tabInstancesRef.current.delete(tabKey);
  }, []);

  const updateTabVisibility = useCallback(
    (nextActiveKey: string | null) => {
      tabInstancesRef.current.forEach((instance, key) => {
        const isTargetActive = key === nextActiveKey;
        instance.container.style.display = isTargetActive ? "block" : "none";
        if (isTargetActive && isOpen) {
          setTimeout(() => {
            if (tabInstancesRef.current.get(key) !== instance ||
                activeTabKeyRef.current !== key) return;
            syncTabSize(key, true);
            instance.terminal.focus();
          }, 0);
        }
      });
    },
    [isOpen, syncTabSize],
  );

  const connectTerminalTab = useCallback(async (previousTab: TerminalTabState) => {
    const tabKey = previousTab.key;
    const generation = invalidateTabGeneration(tabKey);
    if (previousTab.sessionId !== null && sessionIdToTabKeyRef.current.get(previousTab.sessionId) === tabKey) {
      sessionIdToTabKeyRef.current.delete(previousTab.sessionId);
    }
    updateSessionTab(tabKey, (tab) => ({
      ...tab,
      brokerSessionId: null,
      sessionId: null,
      errorMessage: null,
      exitCode: null,
      status: "connecting",
    }));

    let prepared = false;
    await startTerminalSession({
      tab: previousTab,
      sessionKey: `${tabKey}::session-${generation}`,
      api: window.tidecodeTerminal,
      isCurrent: () => isCurrentGeneration(tabKey, generation),
      prepareTerminal: () => {
        prepared = true;
        disposeTabInstance(tabKey);
        tabBuffersRef.current.set(tabKey, "");
        const instance = ensureTabInstance(tabKey);
        updateTabVisibility(activeTabKeyRef.current);
        return getSessionDimensions(instance.terminal);
      },
      onReady: (session) => {
        const instance = tabInstancesRef.current.get(tabKey);
        const sanitizedOutput = boundTerminalReplayBuffer(sanitizeTerminalBuffer(session.bufferedOutput));
        const tabIndex = Number(tabKey.slice(tabKey.lastIndexOf("::terminal-tab-") + "::terminal-tab-".length));
        sessionIdToTabKeyRef.current.set(session.sessionId, tabKey);
        tabBuffersRef.current.set(tabKey, sanitizedOutput);
        updateSessionTab(tabKey, (tab) => ({
          ...tab,
          brokerSessionId: session.brokerSessionId ?? null,
          sessionId: session.sessionId,
          errorMessage: null,
          exitCode: null,
          label: createTerminalTabLabel(tabIndex, session.venvName),
          status: "ready",
          venvName: session.venvName ?? null,
          workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(session.workspaceRootPath),
        }));
        if (instance && sanitizedOutput.length > 0) {
          instance.terminal.write(sanitizedOutput);
        }
        syncTabSize(tabKey, true);
        if (instance && activeTabKeyRef.current === tabKey && isOpen) {
          instance.terminal.focus();
        }
      },
      onError: (error) => {
        const message = getUserFacingErrorMessage(error);
        updateSessionTab(tabKey, (tab) => ({
          ...tab,
          brokerSessionId: prepared ? null : previousTab.brokerSessionId,
          sessionId: prepared ? null : previousTab.sessionId,
          errorMessage: message,
          status: "error",
        }));
        tabInstancesRef.current.get(tabKey)?.terminal.writeln(`\r\n\r\nFailed to start terminal: ${message}`);
        console.error("Failed to start terminal session", error);
      },
    });
  }, [disposeTabInstance, ensureTabInstance, invalidateTabGeneration, isCurrentGeneration, isOpen, syncTabSize, updateSessionTab, updateTabVisibility]);

  const openTerminalTab = useCallback(async () => {
    const currentTabs = terminalTabsRef.current;
    const existingIndices = new Set(
      currentTabs
        .map((tab) => {
          const separatorIndex = tab.key.indexOf("::terminal-tab-");
          if (separatorIndex === -1) return null;
          const parsed = parseInt(tab.key.slice(separatorIndex + 15), 10);
          return Number.isNaN(parsed) ? null : parsed;
        })
        .filter((idx): idx is number => idx !== null),
    );

    let tabIndex = 1;
    while (existingIndices.has(tabIndex)) {
      tabIndex++;
    }

    nextTabIndexRef.current = tabIndex + 1;
    const tabKey = createTerminalTabKey(workspaceKey, tabIndex);
    const nextTab: TerminalTabState = {
      brokerSessionId: null,
      errorMessage: null,
      exitCode: null,
      key: tabKey,
      label: createTerminalTabLabel(tabIndex),
      sessionId: null,
      status: "connecting",
      workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(workspacePathRef.current),
    };

    tabBuffersRef.current.set(tabKey, "");
    terminalTabsRef.current = [...currentTabs, nextTab];
    setTerminalTabs(terminalTabsRef.current);
    setActiveTerminalTabKey(tabKey);
    activeTabKeyRef.current = tabKey;

    await connectTerminalTab(nextTab);
  }, [connectTerminalTab, workspaceKey]);

  const removeTerminalTabFromUi = useCallback(
    (tabKey: string) => {
      const currentTabs = terminalTabsRef.current;
      const currentTabIndex = currentTabs.findIndex((tab) => tab.key === tabKey);
      if (currentTabIndex === -1) return;

      const currentTab = currentTabs[currentTabIndex];
      invalidateTabGeneration(tabKey);
      if (currentTab.sessionId !== null && sessionIdToTabKeyRef.current.get(currentTab.sessionId) === tabKey) {
        sessionIdToTabKeyRef.current.delete(currentTab.sessionId);
      }

      disposeTabInstance(tabKey);
      tabBuffersRef.current.delete(tabKey);

      const nextTabs = currentTabs.filter((tab) => tab.key !== tabKey);
      const wasActive = activeTabKeyRef.current === tabKey;
      terminalTabsRef.current = nextTabs;
      setTerminalTabs(nextTabs);

      if (nextTabs.length === 0) {
        setActiveTerminalTabKey(null);
        nextTabIndexRef.current = 1;
        activeTabKeyRef.current = null;
        activeSessionIdRef.current = null;
        onClose();
        return;
      }

      const nextActiveTab = wasActive
        ? (nextTabs[currentTabIndex] ?? nextTabs[currentTabIndex - 1] ?? nextTabs[0] ?? null)
        : (nextTabs.find((tab) => tab.key === activeTabKeyRef.current) ?? nextTabs[0] ?? null);
      if (!nextActiveTab) return;

      setActiveTerminalTabKey(nextActiveTab.key);
      updateTabVisibility(nextActiveTab.key);
    },
    [disposeTabInstance, invalidateTabGeneration, onClose, updateTabVisibility],
  );

  const closeTerminalTab = useCallback(
    async (tabKey: string) => {
      const currentTab = terminalTabsRef.current.find((tab) => tab.key === tabKey);
      if (!currentTab) return;

      if (currentTab.sessionId !== null) {
        const payload = {
          brokerSessionId: currentTab.brokerSessionId ?? undefined,
          sessionId: currentTab.sessionId,
          tabKey,
          workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(currentTab.workspaceRootPath),
        };
        if (sessionIdToTabKeyRef.current.get(currentTab.sessionId) === tabKey) {
          sessionIdToTabKeyRef.current.delete(currentTab.sessionId);
        }
        void window.tidecodeTerminal.closeSession(payload).catch((error) => {
          console.error("Failed to close terminal session", error);
        });
        window.tidecodeRemoteHost?.emitEvent({
          channel: REMOTE_EVENT_CHANNELS.terminalTabClosed,
          payload,
        });
      }

      removeTerminalTabFromUi(tabKey);
    },
    [removeTerminalTabFromUi],
  );

  useEffect(() => {
    return window.tidecodeTerminal.onTabClosed((event) => {
      const tabKey = event.tabKey ?? sessionIdToTabKeyRef.current.get(event.sessionId);
      const tab = terminalTabsRef.current.find((candidate) => candidate.key === tabKey);
      if (!tabKey || !tab || !isTerminalSessionEventCurrent(tab, event)) {
        return;
      }
      removeTerminalTabFromUi(tabKey);
    });
  }, [removeTerminalTabFromUi]);

  const clearTerminalTab = useCallback((tabKey: string) => {
    const instance = tabInstancesRef.current.get(tabKey);
    if (instance) {
      instance.terminal.clear();
      tabBuffersRef.current.set(tabKey, "");
    }
  }, []);

  const restartTerminalTab = useCallback(async (tabKey: string) => {
    const currentTab = terminalTabsRef.current.find((tab) => tab.key === tabKey);
    if (!currentTab || currentTab.status === "connecting") {
      return;
    }
    await connectTerminalTab(currentTab);
  }, [connectTerminalTab]);
  restartTerminalTabRef.current = restartTerminalTab;

  const selectTerminalTab = useCallback(
    (tabKey: string) => {
      if (activeTabKeyRef.current === tabKey) {
        tabInstancesRef.current.get(tabKey)?.terminal.focus();
        return;
      }

      setActiveTerminalTabKey(tabKey);
      activeTabKeyRef.current = tabKey;
      updateTabVisibility(tabKey);
    },
    [updateTabVisibility],
  );

  const reorderTerminalTabs = useCallback(
    (sourceTabKey: string, targetTabKey: string, position: "before" | "after") => {
      if (sourceTabKey === targetTabKey) {
        return;
      }

      setTerminalTabs((currentTabs) =>
        reorderTabList(currentTabs, sourceTabKey, targetTabKey, position),
      );
    },
    [],
  );

  useTerminalSessionEvents({
    activeWorkspaceKeyRef,
    sessionIdToTabKeyRef,
    setTerminalTabs,
    terminalTabsRef,
    tabBuffersRef,
    tabInstancesRef,
    terminalWorkspaceStateRef,
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const hostElement = terminalHostRef.current;
    if (hostElement) {
      tabInstancesRef.current.forEach((instance) => {
        if (!hostElement.contains(instance.container)) {
          hostElement.appendChild(instance.container);
        }
      });
    }

    if (terminalTabsRef.current.length === 0) {
      if (autoCreateTabOnOpen && !isRemoteMobileViewportRuntime()) {
        void openTerminalTab();
      }
      return;
    }

    const fallbackTab = terminalTabsRef.current[0] ?? null;
    const nextActiveTab = activeTabKeyRef.current
      ? (terminalTabsRef.current.find((tab) => tab.key === activeTabKeyRef.current) ?? fallbackTab)
      : fallbackTab;

    if (!nextActiveTab) {
      return;
    }

    setActiveTerminalTabKey(nextActiveTab.key);
    updateTabVisibility(nextActiveTab.key);
  }, [autoCreateTabOnOpen, isOpen, openTerminalTab, updateTabVisibility]);

  useTerminalWorkspacePersistence({
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
  });

  return {
    activeTerminalTab,
    activeTerminalTabKey,
    closeTerminalTab,
    clearTerminalTab,
    restartTerminalTab,
    openTerminalTab,
    reorderTerminalTabs,
    selectTerminalTab,
    terminalHostRef,
    terminalTabs,
  };
}
