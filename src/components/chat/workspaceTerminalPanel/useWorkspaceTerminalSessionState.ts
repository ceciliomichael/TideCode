import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
import type {
  TerminalTabState,
  WorkspaceTerminalPanelProps,
} from "./workspaceTerminalPanelTypes";
import {
  createTerminalTabLabel,
  createTerminalTabKey,
  clearSelectionWithinHost,
  copyTerminalSelectionToClipboard,
  getErrorMessage,
  getNativeSelectionTextWithinHost,
  getSessionDimensions,
  MIN_TERMINAL_COLS,
  MIN_TERMINAL_ROWS,
  getTerminalTheme,
  getWorkspaceKeyFromTerminalTabKey,
  isRenderableTerminalDimensions,
  resolveTerminalSessionWorkspaceRootPath,
} from "./workspaceTerminalPanelUtils";
import "@xterm/xterm/css/xterm.css";

interface TerminalWorkspaceState {
  activeTerminalTabKey: string | null;
  nextTabIndex: number;
  terminalTabs: TerminalTabState[];
}

interface UseWorkspaceTerminalSessionStateArgs
  extends Pick<
    WorkspaceTerminalPanelProps,
    "isOpen" | "onClose" | "resolvedTheme" | "workspaceKey" | "workspacePath"
  > {
  isResizing: boolean;
}

interface WorkspaceTerminalSessionState {
  activeTerminalTab: TerminalTabState | null;
  activeTerminalTabKey: string | null;
  closeTerminalTab: (tabKey: string) => void;
  openTerminalTab: () => void;
  selectTerminalTab: (tabKey: string) => void;
  terminalHostRef: RefObject<HTMLDivElement>;
  terminalTabs: readonly TerminalTabState[];
}

const TERMINAL_THEME_SYNC_DELAY_MS = 200;

export function useWorkspaceTerminalSessionState({
  isOpen,
  isResizing,
  onClose,
  resolvedTheme,
  workspaceKey,
  workspacePath,
}: UseWorkspaceTerminalSessionStateArgs): WorkspaceTerminalSessionState {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalInputDisposableRef = useRef<IDisposable | null>(null);
  const terminalResizeDisposableRef = useRef<IDisposable | null>(null);
  const terminalContextMenuListenerRef = useRef<((event: MouseEvent) => void) | null>(null);
  const workspacePathRef = useRef<string | null>(workspacePath);
  const activeWorkspaceKeyRef = useRef(workspaceKey);
  const isResizingRef = useRef(isResizing);
  const pendingTerminalRenderRef = useRef<{
    sessionId: number | null;
    tabKey: string | null;
  } | null>(null);
  const lastSyncedSizeRef = useRef<{
    cols: number;
    rows: number;
    sessionId: number;
  } | null>(null);
  const terminalWorkspaceStateRef = useRef<Record<string, TerminalWorkspaceState>>({});
  const previousWorkspaceKeyRef = useRef(workspaceKey);
  const terminalTabsRef = useRef<TerminalTabState[]>([]);
  const nextTabIndexRef = useRef(1);
  const activeTabKeyRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<number | null>(null);
  const sessionIdToTabKeyRef = useRef<Map<number, string>>(new Map());
  const tabBuffersRef = useRef<Map<string, string>>(new Map());
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabState[]>([]);
  const [activeTerminalTabKey, setActiveTerminalTabKey] = useState<string | null>(null);

  const activeTerminalTab = useMemo(
    () => terminalTabs.find((tab) => tab.key === activeTerminalTabKey) ?? null,
    [activeTerminalTabKey, terminalTabs],
  );

  useEffect(() => {
    terminalTabsRef.current = terminalTabs;
  }, [terminalTabs]);

  useEffect(() => {
    workspacePathRef.current = workspacePath;
  }, [workspacePath]);

  useEffect(() => {
    activeWorkspaceKeyRef.current = workspaceKey;
  }, [workspaceKey]);

  useEffect(() => {
    isResizingRef.current = isResizing;
  }, [isResizing]);

  useEffect(() => {
    activeTabKeyRef.current = activeTerminalTabKey;
    activeSessionIdRef.current = activeTerminalTab?.sessionId ?? null;
  }, [activeTerminalTab, activeTerminalTabKey]);

  const getRenderableTerminalDimensions = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    if (!fitAddon) {
      return null;
    }

    const proposedDimensions = fitAddon.proposeDimensions();
    return isRenderableTerminalDimensions(proposedDimensions)
      ? proposedDimensions
      : null;
  }, []);

  const getActiveTerminalSessionWorkspaceRootPath = useCallback(() => {
    const activeSessionId = activeSessionIdRef.current;
    if (activeSessionId === null) {
      return null;
    }

    const tabKey = sessionIdToTabKeyRef.current.get(activeSessionId);
    if (!tabKey) {
      return null;
    }

    const activeTab = terminalTabsRef.current.find((tab) => tab.key === tabKey) ?? null;
    return resolveTerminalSessionWorkspaceRootPath(activeTab?.workspaceRootPath);
  }, []);

  const sendTerminalSizeToSession = useCallback(
    (dimensions: { cols: number; rows: number }) => {
      const activeSessionId = activeSessionIdRef.current;
      if (activeSessionId === null) {
        return;
      }

      const lastSyncedSize = lastSyncedSizeRef.current;
      if (
        lastSyncedSize &&
        lastSyncedSize.sessionId === activeSessionId &&
        lastSyncedSize.cols === dimensions.cols &&
        lastSyncedSize.rows === dimensions.rows
      ) {
        return;
      }

      lastSyncedSizeRef.current = {
        cols: dimensions.cols,
        rows: dimensions.rows,
        sessionId: activeSessionId,
      };
      const workspaceRootPath = getActiveTerminalSessionWorkspaceRootPath();

      void window.echosphereTerminal
        .resizeSession({
          cols: dimensions.cols,
          rows: dimensions.rows,
          sessionId: activeSessionId,
          workspaceRootPath,
        })
        .catch((error) => {
          lastSyncedSizeRef.current = null;
          console.error("Failed to sync terminal size", error);
        });
    },
    [getActiveTerminalSessionWorkspaceRootPath],
  );

  const syncTerminalSize = useCallback(
    (force = false) => {
      if (!force && isResizingRef.current) {
        return false;
      }

      const terminal = terminalRef.current;
      if (!terminal) {
        return false;
      }

      const proposedDimensions = getRenderableTerminalDimensions();
      if (!proposedDimensions) {
        return false;
      }

      fitAddonRef.current?.fit();
      sendTerminalSizeToSession(getSessionDimensions(terminal));
      return true;
    },
    [getRenderableTerminalDimensions, sendTerminalSizeToSession],
  );

  const syncTerminalTheme = useCallback(() => {
    const hostElement = terminalHostRef.current;
    const terminal = terminalRef.current;
    if (!hostElement || !terminal) {
      return;
    }

    terminal.options.theme = {
      ...getTerminalTheme(hostElement, resolvedTheme),
    };
    terminal.refresh(0, Math.max(terminal.rows - 1, 0));
  }, [resolvedTheme]);

  const renderActiveTerminalTabNow = useCallback(
    (nextTabKey: string | null, sessionIdOverride?: number | null) => {
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }

      const nextTab = nextTabKey
        ? (terminalTabsRef.current.find((tab) => tab.key === nextTabKey) ?? null)
        : null;
      activeTabKeyRef.current = nextTabKey;
      activeSessionIdRef.current = sessionIdOverride ?? nextTab?.sessionId ?? null;
      lastSyncedSizeRef.current = null;
      terminal.reset();

      if (!nextTabKey) {
        terminal.focus();
        return;
      }

      const bufferedOutput = tabBuffersRef.current.get(nextTabKey) ?? "";
      if (bufferedOutput.length > 0) {
        terminal.write(bufferedOutput);
      }

      if (nextTab?.status === "error" && nextTab.errorMessage) {
        terminal.writeln(`\r\n\r\nFailed to start terminal: ${nextTab.errorMessage}`);
      }

      if (nextTab?.status === "exited" && nextTab.exitCode !== null) {
        terminal.writeln(`\r\n\r\nProcess exited with code ${nextTab.exitCode}.`);
      }

      terminal.focus();
      syncTerminalSize(true);
    },
    [syncTerminalSize],
  );

  const flushPendingTerminalRender = useCallback(() => {
    const pendingTerminalRender = pendingTerminalRenderRef.current;
    if (!pendingTerminalRender) {
      return;
    }

    if (!getRenderableTerminalDimensions()) {
      return;
    }

    pendingTerminalRenderRef.current = null;
    renderActiveTerminalTabNow(
      pendingTerminalRender.tabKey,
      pendingTerminalRender.sessionId,
    );
  }, [getRenderableTerminalDimensions, renderActiveTerminalTabNow]);

  const renderActiveTerminalTab = useCallback(
    (nextTabKey: string | null, sessionIdOverride?: number | null) => {
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }

      if (!getRenderableTerminalDimensions()) {
        pendingTerminalRenderRef.current = {
          sessionId: sessionIdOverride ?? null,
          tabKey: nextTabKey,
        };
        return;
      }

      pendingTerminalRenderRef.current = null;
      renderActiveTerminalTabNow(nextTabKey, sessionIdOverride);
    },
    [getRenderableTerminalDimensions, renderActiveTerminalTabNow],
  );

  const ensureTerminal = useCallback(() => {
    const hostElement = terminalHostRef.current;
    if (!hostElement || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.24,
      minimumContrastRatio: 4.5,
      scrollback: 5_000,
      theme: getTerminalTheme(hostElement, resolvedTheme),
    });
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      void window.echosphereTerminal.openExternalLink({ url: uri }).catch((error) => {
        console.error("Failed to open terminal link", error);
      });
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(hostElement);
    terminal.focus();
    const handleTerminalContextMenu = (event: MouseEvent) => {
      const terminalSelection =
        terminal.getSelection() || getNativeSelectionTextWithinHost(hostElement);
      if (!terminalSelection) {
        return;
      }

      event.preventDefault();
      void copyTerminalSelectionToClipboard({
        hostElement,
        terminal,
      })
        .catch((error) => {
          console.error("Failed to copy selected terminal text", error);
        })
        .finally(() => {
          terminal.clearSelection();
          clearSelectionWithinHost(hostElement);
        });
    };

    terminalContextMenuListenerRef.current = handleTerminalContextMenu;
    hostElement.addEventListener("contextmenu", handleTerminalContextMenu);
    terminal.attachCustomKeyEventHandler((event) => {
      const isCopyShortcut =
        (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "c";
      if (!isCopyShortcut) {
        return true;
      }

      const copySelectedText = (text: string) => {
        void navigator.clipboard.writeText(text).catch((error) => {
          console.error("Failed to copy selected terminal text", error);
        });
      };

      const terminalSelection = terminal.getSelection();
      if (terminalSelection) {
        copySelectedText(terminalSelection);
        return false;
      }

      const nativeSelection = getNativeSelectionTextWithinHost(hostElement);
      if (nativeSelection) {
        copySelectedText(nativeSelection);
        return false;
      }

      return true;
    });

    terminalInputDisposableRef.current = terminal.onData((data) => {
      const activeSessionId = activeSessionIdRef.current;
      if (activeSessionId === null) {
        return;
      }

      const workspaceRootPath = getActiveTerminalSessionWorkspaceRootPath();

      void window.echosphereTerminal
        .writeToSession({
          data,
          sessionId: activeSessionId,
          workspaceRootPath,
        })
        .catch((error) => {
          console.error("Failed to write terminal input", error);
        });
    });

    terminalResizeDisposableRef.current = terminal.onResize(() => {
      sendTerminalSizeToSession(getSessionDimensions(terminal));
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    syncTerminalSize(true);
  }, [getActiveTerminalSessionWorkspaceRootPath, resolvedTheme, sendTerminalSizeToSession, syncTerminalSize]);

  const disposeTerminal = useCallback(() => {
    pendingTerminalRenderRef.current = null;
    const hostElement = terminalHostRef.current;
    const handleTerminalContextMenu = terminalContextMenuListenerRef.current;
    if (hostElement && handleTerminalContextMenu) {
      hostElement.removeEventListener("contextmenu", handleTerminalContextMenu);
    }
    terminalContextMenuListenerRef.current = null;
    terminalInputDisposableRef.current?.dispose();
    terminalResizeDisposableRef.current?.dispose();
    terminalInputDisposableRef.current = null;
    terminalResizeDisposableRef.current = null;
    fitAddonRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
  }, []);

  const openTerminalTab = useCallback(async () => {
    ensureTerminal();

    const tabIndex = nextTabIndexRef.current;
    nextTabIndexRef.current += 1;
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

    const terminal = terminalRef.current;
    const dimensions = terminal
      ? getSessionDimensions(terminal)
      : { cols: MIN_TERMINAL_COLS, rows: MIN_TERMINAL_ROWS };

    try {
      const session = await window.echosphereTerminal.createSession({
        cols: dimensions.cols,
        cwd: workspacePathRef.current,
        rows: dimensions.rows,
        sessionKey: tabKey,
        workspaceRootPath: workspacePathRef.current,
      });

      sessionIdToTabKeyRef.current.set(session.sessionId, tabKey);
      tabBuffersRef.current.set(tabKey, session.bufferedOutput);

      setTerminalTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.key === tabKey
            ? {
                ...tab,
                errorMessage: null,
                exitCode: null,
                sessionId: session.sessionId,
                workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(session.workspaceRootPath),
                status: "ready",
              }
            : tab,
        ),
      );

      if (activeTabKeyRef.current === tabKey) {
        renderActiveTerminalTab(tabKey, session.sessionId);
      }
    } catch (error) {
      const message = getErrorMessage(error);
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

      if (activeTabKeyRef.current === tabKey && terminalRef.current) {
        terminalRef.current.reset();
        terminalRef.current.writeln(`\r\n\r\nFailed to start terminal: ${message}`);
      }

      console.error("Failed to start terminal session", error);
    }
  }, [ensureTerminal, renderActiveTerminalTab, workspaceKey]);

  const closeTerminalTab = useCallback(
    async (tabKey: string) => {
      const currentTabs = terminalTabsRef.current;
      const currentTabIndex = currentTabs.findIndex((tab) => tab.key === tabKey);
      if (currentTabIndex === -1) {
        return;
      }

      const currentTab = currentTabs[currentTabIndex];
      if (currentTab.sessionId !== null) {
        sessionIdToTabKeyRef.current.delete(currentTab.sessionId);
        void window.echosphereTerminal
          .closeSession({
            sessionId: currentTab.sessionId,
            workspaceRootPath: resolveTerminalSessionWorkspaceRootPath(currentTab.workspaceRootPath),
          })
          .catch((error) => {
            console.error("Failed to close terminal session", error);
          });
      }

      if (pendingTerminalRenderRef.current?.tabKey === tabKey) {
        pendingTerminalRenderRef.current = null;
      }

      tabBuffersRef.current.delete(tabKey);
      const nextTabs = currentTabs.filter((tab) => tab.key !== tabKey);
      const wasActive = activeTabKeyRef.current === tabKey;

      setTerminalTabs(nextTabs);

      if (nextTabs.length === 0) {
        pendingTerminalRenderRef.current = null;
        setActiveTerminalTabKey(null);
        nextTabIndexRef.current = 1;
        activeTabKeyRef.current = null;
        activeSessionIdRef.current = null;
        lastSyncedSizeRef.current = null;
        onClose();
        return;
      }

      const nextActiveTab = wasActive
        ? (nextTabs[currentTabIndex] ?? nextTabs[currentTabIndex - 1] ?? nextTabs[0] ?? null)
        : (nextTabs.find((tab) => tab.key === activeTabKeyRef.current) ?? nextTabs[0] ?? null);

      if (!nextActiveTab) {
        return;
      }

      setActiveTerminalTabKey(nextActiveTab.key);
      renderActiveTerminalTab(nextActiveTab.key, nextActiveTab.sessionId);
    },
    [onClose, renderActiveTerminalTab],
  );

  const selectTerminalTab = useCallback(
    (tabKey: string) => {
      if (activeTabKeyRef.current === tabKey) {
        return;
      }

      const nextTab =
        terminalTabsRef.current.find((tab) => tab.key === tabKey) ?? null;
      if (!nextTab) {
        return;
      }

      setActiveTerminalTabKey(tabKey);
      renderActiveTerminalTab(tabKey, nextTab.sessionId);
    },
    [renderActiveTerminalTab],
  );

  useEffect(() => {
    const unsubscribeData = window.echosphereTerminal.onData((event) => {
      const tabKey = sessionIdToTabKeyRef.current.get(event.sessionId);
      if (!tabKey) {
        return;
      }

      const currentBuffer = tabBuffersRef.current.get(tabKey) ?? "";
      tabBuffersRef.current.set(tabKey, currentBuffer + event.data);
      if (event.sessionId !== activeSessionIdRef.current) {
        return;
      }

      terminalRef.current?.write(event.data);
    });

    const unsubscribeExit = window.echosphereTerminal.onExit((event) => {
      const tabKey = sessionIdToTabKeyRef.current.get(event.sessionId);
      if (!tabKey) {
        return;
      }

      const tabWorkspaceKey =
        getWorkspaceKeyFromTerminalTabKey(tabKey) ?? activeWorkspaceKeyRef.current;

      sessionIdToTabKeyRef.current.delete(event.sessionId);
      const nextExitMessage = `\r\n\r\nProcess exited with code ${event.exitCode}.`;
      tabBuffersRef.current.set(
        tabKey,
        `${tabBuffersRef.current.get(tabKey) ?? ""}${nextExitMessage}`,
      );

      setTerminalTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.key === tabKey
            ? {
                ...tab,
                exitCode: event.exitCode,
                sessionId: null,
                status: "exited",
              }
            : tab,
        ),
      );

      if (event.sessionId !== activeSessionIdRef.current) {
        const storedWorkspaceState =
          terminalWorkspaceStateRef.current[tabWorkspaceKey];
        if (storedWorkspaceState) {
          storedWorkspaceState.terminalTabs = storedWorkspaceState.terminalTabs.map((tab) =>
            tab.key === tabKey
              ? {
                  ...tab,
                  exitCode: event.exitCode,
                  sessionId: null,
                  status: "exited",
                }
              : tab,
          );
        }
        return;
      }

      activeSessionIdRef.current = null;
      terminalRef.current?.writeln(nextExitMessage);
    });

    return () => {
      unsubscribeData();
      unsubscribeExit();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    ensureTerminal();
    if (terminalTabsRef.current.length === 0) {
      void openTerminalTab();
      return;
    }

    const fallbackTab = terminalTabsRef.current[0] ?? null;
    const nextActiveTab = activeTabKeyRef.current
      ? (terminalTabsRef.current.find(
          (tab) => tab.key === activeTabKeyRef.current,
        ) ?? fallbackTab)
      : fallbackTab;

    if (!nextActiveTab) {
      return;
    }

    setActiveTerminalTabKey(nextActiveTab.key);
    renderActiveTerminalTab(nextActiveTab.key, nextActiveTab.sessionId);
  }, [ensureTerminal, isOpen, openTerminalTab, renderActiveTerminalTab]);

  useEffect(() => {
    if (!terminalRef.current || !terminalHostRef.current) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      syncTerminalTheme();
    });
    const timeoutId = window.setTimeout(() => {
      syncTerminalTheme();
    }, TERMINAL_THEME_SYNC_DELAY_MS);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [resolvedTheme, syncTerminalTheme]);

  useEffect(() => {
    if (!isOpen || isResizing) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      if (syncTerminalSize(true)) {
        flushPendingTerminalRender();
      }
    });
    const timeoutId = window.setTimeout(() => {
      if (syncTerminalSize(true)) {
        flushPendingTerminalRender();
      }
    }, TERMINAL_THEME_SYNC_DELAY_MS);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [
    activeTerminalTabKey,
    flushPendingTerminalRender,
    isOpen,
    isResizing,
    syncTerminalSize,
    workspaceKey,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const hostElement = terminalHostRef.current;
    if (!hostElement) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (syncTerminalSize()) {
        flushPendingTerminalRender();
      }
    });
    resizeObserver.observe(hostElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [flushPendingTerminalRender, isOpen, syncTerminalSize]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleWindowResize = () => {
      if (syncTerminalSize()) {
        flushPendingTerminalRender();
      }
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [flushPendingTerminalRender, isOpen, syncTerminalSize]);

  useEffect(() => {
    return () => {
      disposeTerminal();
    };
  }, [disposeTerminal]);

  useEffect(() => {
    const nextWorkspaceKey = workspaceKey;
    const previousWorkspaceKey = previousWorkspaceKeyRef.current;
    if (previousWorkspaceKey === nextWorkspaceKey) {
      return;
    }

    pendingTerminalRenderRef.current = null;
    terminalWorkspaceStateRef.current[previousWorkspaceKey] = {
      activeTerminalTabKey,
      nextTabIndex: nextTabIndexRef.current,
      terminalTabs,
    };

    const nextWorkspaceState =
      terminalWorkspaceStateRef.current[nextWorkspaceKey] ?? {
        activeTerminalTabKey: null,
        nextTabIndex: 1,
        terminalTabs: [],
      };

    if (nextWorkspaceState.terminalTabs.length === 0) {
      previousWorkspaceKeyRef.current = nextWorkspaceKey;
      pendingTerminalRenderRef.current = null;
      setTerminalTabs([]);
      setActiveTerminalTabKey(null);
      nextTabIndexRef.current = 1;
      terminalTabsRef.current = [];
      activeTabKeyRef.current = null;
      activeSessionIdRef.current = null;
      lastSyncedSizeRef.current = null;
      terminalRef.current?.reset();
      return;
    }

    previousWorkspaceKeyRef.current = nextWorkspaceKey;
    setTerminalTabs(nextWorkspaceState.terminalTabs);
    setActiveTerminalTabKey(nextWorkspaceState.activeTerminalTabKey);
    nextTabIndexRef.current = nextWorkspaceState.nextTabIndex;
    terminalTabsRef.current = nextWorkspaceState.terminalTabs;
    activeTabKeyRef.current = nextWorkspaceState.activeTerminalTabKey;
    activeSessionIdRef.current =
      nextWorkspaceState.terminalTabs.find(
        (tab) => tab.key === nextWorkspaceState.activeTerminalTabKey,
      )?.sessionId ?? null;
    lastSyncedSizeRef.current = null;
    pendingTerminalRenderRef.current = null;
    terminalRef.current?.reset();

    const nextActiveTab = nextWorkspaceState.activeTerminalTabKey
      ? nextWorkspaceState.terminalTabs.find(
          (tab) => tab.key === nextWorkspaceState.activeTerminalTabKey,
        ) ?? null
      : null;
    if (nextActiveTab) {
      renderActiveTerminalTab(nextActiveTab.key, nextActiveTab.sessionId);
    } else if (isOpen) {
      terminalRef.current?.focus();
    }
  }, [activeTerminalTabKey, isOpen, renderActiveTerminalTab, terminalTabs, workspaceKey]);

  return {
    activeTerminalTab,
    activeTerminalTabKey,
    closeTerminalTab,
    openTerminalTab,
    selectTerminalTab,
    terminalHostRef,
    terminalTabs,
  };
}
