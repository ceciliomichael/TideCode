import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REMOTE_EVENT_CHANNELS } from "../../../remote/protocol";
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
import {
  createTerminalTabLabel,
  createTerminalTabKey,
  getUserFacingErrorMessage,
  getSessionDimensions,
  reorderTabList,
  resolveTerminalSessionWorkspaceRootPath,
  sanitizeTerminalBuffer,
} from "./workspaceTerminalPanelUtils";
import "@xterm/xterm/css/xterm.css";

export function useWorkspaceTerminalSessionState({
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
  const tabBuffersRef = useRef<Map<string, string>>(new Map());
  const restartTerminalTabRef = useRef<(tabKey: string) => void>(() => undefined);
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
        sessionIdToTabKeyRef,
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
            if (syncTabSize(key, true)) {
              instance.terminal.focus();
            }
          }, 0);
        }
      });
    },
    [isOpen, syncTabSize],
  );

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
      errorMessage: null,
      exitCode: null,
      key: tabKey,
      label: createTerminalTabLabel(tabIndex),
      sessionId: null,
      status: "connecting",
      workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(workspacePathRef.current),
    };

    tabBuffersRef.current.set(tabKey, "");
    setTerminalTabs((currentTabs) => [...currentTabs, nextTab]);
    setActiveTerminalTabKey(tabKey);

    const instance = ensureTabInstance(tabKey);
    updateTabVisibility(tabKey);

    const dimensions = getSessionDimensions(instance.terminal);

    try {
      const session = await window.tidecodeTerminal.createSession({
        cols: dimensions.cols,
        cwd: workspacePathRef.current,
        rows: dimensions.rows,
        sessionKey: tabKey,
        workspaceRootPath: workspacePathRef.current,
      });

      sessionIdToTabKeyRef.current.set(session.sessionId, tabKey);
      const sanitizedOutput = sanitizeTerminalBuffer(session.bufferedOutput);
      tabBuffersRef.current.set(tabKey, sanitizedOutput);

      setTerminalTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.key === tabKey
            ? {
                ...tab,
                errorMessage: null,
                exitCode: null,
                label: createTerminalTabLabel(tabIndex, session.venvName),
                sessionId: session.sessionId,
                status: "ready",
                venvName: session.venvName ?? null,
                workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(
                  session.workspaceRootPath,
                ),
              }
            : tab,
        ),
      );

      if (sanitizedOutput.length > 0) {
        instance.terminal.write(sanitizedOutput);
      }
      instance.terminal.focus();
      syncTabSize(tabKey, true);
    } catch (error) {
      const message = getUserFacingErrorMessage(error);
      setTerminalTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.key === tabKey
            ? {
                ...tab,
                errorMessage: message,
                sessionId: null,
                status: "error",
              }
            : tab,
        ),
      );

      instance.terminal.writeln(`\r\n\r\nFailed to start terminal: ${message}`);
      console.error("Failed to start terminal session", error);
    }
  }, [ensureTabInstance, syncTabSize, updateTabVisibility, workspaceKey]);

  const removeTerminalTabFromUi = useCallback(
    (tabKey: string) => {
      const currentTabs = terminalTabsRef.current;
      const currentTabIndex = currentTabs.findIndex((tab) => tab.key === tabKey);
      if (currentTabIndex === -1) return;

      const currentTab = currentTabs[currentTabIndex];
      if (currentTab.sessionId !== null) {
        sessionIdToTabKeyRef.current.delete(currentTab.sessionId);
      }

      disposeTabInstance(tabKey);
      tabBuffersRef.current.delete(tabKey);

      const nextTabs = currentTabs.filter((tab) => tab.key !== tabKey);
      const wasActive = activeTabKeyRef.current === tabKey;
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
    [disposeTabInstance, onClose, updateTabVisibility],
  );

  const closeTerminalTab = useCallback(
    async (tabKey: string) => {
      const currentTab = terminalTabsRef.current.find((tab) => tab.key === tabKey);
      if (!currentTab) return;

      if (currentTab.sessionId !== null) {
        const payload = {
          sessionId: currentTab.sessionId,
          tabKey,
          workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(currentTab.workspaceRootPath),
        };
        sessionIdToTabKeyRef.current.delete(currentTab.sessionId);
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
      const explicitTabKey = event.tabKey && terminalTabsRef.current.some((tab) => tab.key === event.tabKey)
        ? event.tabKey
        : null;
      const tabKey = explicitTabKey ?? sessionIdToTabKeyRef.current.get(event.sessionId) ?? null;
      if (!tabKey) return;
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

  const restartTerminalTab = useCallback(
    async (tabKey: string) => {
      const currentTab = terminalTabsRef.current.find((tab) => tab.key === tabKey);
      if (!currentTab) {
        return;
      }

      if (currentTab.sessionId !== null) {
        sessionIdToTabKeyRef.current.delete(currentTab.sessionId);
        void window.tidecodeTerminal
          .closeSession({
            sessionId: currentTab.sessionId,
            workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(currentTab.workspaceRootPath),
          })
          .catch((error) => {
            console.error("Failed to close terminal session during restart", error);
          });
      }

      disposeTabInstance(tabKey);
      tabBuffersRef.current.set(tabKey, "");

      setTerminalTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.key === tabKey
            ? {
                ...tab,
                errorMessage: null,
                exitCode: null,
                sessionId: null,
                status: "connecting",
              }
            : tab,
        ),
      );

      const instance = ensureTabInstance(tabKey);
      updateTabVisibility(activeTabKeyRef.current);

      const dimensions = getSessionDimensions(instance.terminal);

      try {
        const session = await window.tidecodeTerminal.createSession({
          cols: dimensions.cols,
          cwd: workspacePathRef.current,
          rows: dimensions.rows,
          sessionKey: tabKey,
          workspaceRootPath: workspacePathRef.current,
        });

        sessionIdToTabKeyRef.current.set(session.sessionId, tabKey);
        const sanitizedOutput = sanitizeTerminalBuffer(session.bufferedOutput);
        tabBuffersRef.current.set(tabKey, sanitizedOutput);

        setTerminalTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.key === tabKey
              ? {
                  ...tab,
                  errorMessage: null,
                  exitCode: null,
                  sessionId: session.sessionId,
                  workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(
                    session.workspaceRootPath,
                  ),
                  status: "ready",
                }
              : tab,
          ),
        );

        if (sanitizedOutput.length > 0) {
          instance.terminal.write(sanitizedOutput);
        }
        if (activeTabKeyRef.current === tabKey) {
          instance.terminal.focus();
          syncTabSize(tabKey, true);
        }
      } catch (error) {
        const message = getUserFacingErrorMessage(error);
        setTerminalTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.key === tabKey
              ? {
                  ...tab,
                  errorMessage: message,
                  sessionId: null,
                  status: "error",
                }
              : tab,
          ),
        );

        instance.terminal.writeln(`\r\n\r\nFailed to start terminal: ${message}`);
        console.error("Failed to restart terminal session", error);
      }
    },
    [disposeTabInstance, ensureTabInstance, syncTabSize, updateTabVisibility],
  );
  restartTerminalTabRef.current = restartTerminalTab;

  const selectTerminalTab = useCallback(
    (tabKey: string) => {
      if (activeTabKeyRef.current === tabKey) {
        return;
      }

      setActiveTerminalTabKey(tabKey);
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
      void openTerminalTab();
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
  }, [isOpen, openTerminalTab, updateTabVisibility]);

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
