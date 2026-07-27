import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
import { pasteTextIntoTerminal } from "./terminalPaste";
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
  getTerminalTheme,
  getWorkspaceKeyFromTerminalTabKey,
  isRenderableTerminalDimensions,
  reorderTabList,
  resolveTerminalSessionWorkspaceRootPath,
  sanitizeTerminalBuffer,
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
  clearTerminalTab: (tabKey: string) => void;
  restartTerminalTab: (tabKey: string) => void;
  openTerminalTab: () => void;
  reorderTerminalTabs: (
    sourceTabKey: string,
    targetTabKey: string,
    position: "before" | "after",
  ) => void;
  selectTerminalTab: (tabKey: string) => void;
  terminalHostRef: RefObject<HTMLDivElement>;
  terminalTabs: readonly TerminalTabState[];
}

interface TabTerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  webLinksAddon: WebLinksAddon;
  container: HTMLDivElement;
  disposables: IDisposable[];
  lastSyncedSize?: { cols: number; rows: number };
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
  const tabInstancesRef = useRef<Map<string, TabTerminalInstance>>(new Map());
  const workspacePathRef = useRef<string | null>(workspacePath);
  const activeWorkspaceKeyRef = useRef(workspaceKey);
  const isResizingRef = useRef(isResizing);
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

  const getActiveTerminalSessionWorkspaceRootPath = useCallback((tabKey?: string | null) => {
    const targetKey = tabKey ?? activeTabKeyRef.current;
    if (!targetKey) {
      return null;
    }

    const targetTab = terminalTabsRef.current.find((tab) => tab.key === targetKey) ?? null;
    return resolveTerminalSessionWorkspaceRootPath(targetTab?.workspaceRootPath);
  }, []);

  const sendTerminalSizeToSession = useCallback(
    (tabKey: string, sessionId: number, dimensions: { cols: number; rows: number }) => {
      const instance = tabInstancesRef.current.get(tabKey);
      if (!instance) {
        return;
      }

      if (
        instance.lastSyncedSize &&
        instance.lastSyncedSize.cols === dimensions.cols &&
        instance.lastSyncedSize.rows === dimensions.rows
      ) {
        return;
      }

      instance.lastSyncedSize = {
        cols: dimensions.cols,
        rows: dimensions.rows,
      };
      const workspaceRootPath = getActiveTerminalSessionWorkspaceRootPath(tabKey);

      void window.echosphereTerminal
        .resizeSession({
          cols: dimensions.cols,
          rows: dimensions.rows,
          sessionId,
          workspaceRootPath,
        })
        .catch((error) => {
          if (instance) {
            instance.lastSyncedSize = undefined;
          }
          console.error(`Failed to sync terminal size for tab ${tabKey}`, error);
        });
    },
    [getActiveTerminalSessionWorkspaceRootPath],
  );

  const syncTabSize = useCallback(
    (tabKey: string, force = false) => {
      if (!force && isResizingRef.current) {
        return false;
      }

      const instance = tabInstancesRef.current.get(tabKey);
      if (!instance) {
        return false;
      }

      const proposedDimensions = instance.fitAddon.proposeDimensions();
      if (!isRenderableTerminalDimensions(proposedDimensions)) {
        return false;
      }

      instance.fitAddon.fit();
      const tab = terminalTabsRef.current.find((t) => t.key === tabKey);
      if (tab?.sessionId !== null && tab?.sessionId !== undefined) {
        sendTerminalSizeToSession(tabKey, tab.sessionId, getSessionDimensions(instance.terminal));
      }
      return true;
    },
    [sendTerminalSizeToSession],
  );

  const syncAllVisibleTabSizes = useCallback(
    (force = false) => {
      if (!isOpen || (!force && isResizingRef.current)) {
        return;
      }

      const activeKey = activeTabKeyRef.current;
      if (activeKey) {
        syncTabSize(activeKey, force);
      }
    },
    [isOpen, syncTabSize],
  );

  const syncTerminalTheme = useCallback(() => {
    const hostElement = terminalHostRef.current || document.body;
    const theme = getTerminalTheme(hostElement, resolvedTheme);

    tabInstancesRef.current.forEach((instance) => {
      instance.terminal.options.theme = { ...theme };
      instance.terminal.refresh(0, Math.max(instance.terminal.rows - 1, 0));
    });
  }, [resolvedTheme]);

  const ensureTabInstance = useCallback(
    (tabKey: string): TabTerminalInstance => {
      let instance = tabInstancesRef.current.get(tabKey);
      const hostElement = terminalHostRef.current;

      if (instance) {
        if (hostElement && !hostElement.contains(instance.container)) {
          hostElement.appendChild(instance.container);
        }
        return instance;
      }

      const container = document.createElement("div");
      container.className = "workspace-terminal-tab-instance";
      container.style.position = "absolute";
      container.style.top = "0";
      container.style.left = "0";
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.overflow = "hidden";
      container.style.display = tabKey === activeTabKeyRef.current ? "block" : "none";

      if (hostElement) {
        hostElement.appendChild(container);
      }

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.24,
        minimumContrastRatio: 4.5,
        scrollback: 5_000,
        theme: getTerminalTheme(hostElement || document.body, resolvedTheme),
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
      terminal.open(container);

      const disposables: IDisposable[] = [];

      const handleTerminalContextMenu = (event: MouseEvent) => {
        const terminalSelection =
          terminal.getSelection() || getNativeSelectionTextWithinHost(container);
        if (terminalSelection) {
          event.preventDefault();
          void copyTerminalSelectionToClipboard({
            hostElement: container,
            terminal,
          })
            .catch((error) => {
              console.error("Failed to copy selected terminal text", error);
            })
            .finally(() => {
              terminal.clearSelection();
              clearSelectionWithinHost(container);
            });
        } else {
          // No text selected: paste from clipboard on right click (VS Code / Windows terminal behavior).
          // xterm wraps this in bracketed-paste markers when the active CLI requests them.
          event.preventDefault();
          void navigator.clipboard
            .readText()
            .then((text) => {
              pasteTextIntoTerminal(terminal, text);
            })
            .catch((error) => {
              console.error("Failed to read clipboard for paste", error);
            });
        }
      };

      container.addEventListener("contextmenu", handleTerminalContextMenu);

      terminal.attachCustomKeyEventHandler((event) => {
        const writeSequence = (sequence: string) => {
          const tab = terminalTabsRef.current.find((t) => t.key === tabKey);
          if (tab?.sessionId !== null && tab?.sessionId !== undefined) {
            const workspaceRootPath = getActiveTerminalSessionWorkspaceRootPath(tabKey);
            void window.echosphereTerminal
              .writeToSession({
                data: sequence,
                sessionId: tab.sessionId,
                workspaceRootPath,
              })
              .catch(console.error);
          }
        };

        if (event.type === "keydown") {
          if (event.key === "Enter" && (event.shiftKey || event.altKey)) {
            writeSequence("\x1b\r");
            return false;
          }

          if (event.key === "Backspace") {
            if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
              writeSequence("\x17"); // Ctrl-W (delete word backward)
              return false;
            }
            if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              writeSequence("\x1b\x7f"); // Alt-Backspace (delete word backward)
              return false;
            }
          }

          if (event.key === "Delete") {
            if ((event.ctrlKey || event.metaKey || event.altKey) && !event.shiftKey) {
              writeSequence("\x1bd"); // Esc-d (delete word forward)
              return false;
            }
          }

          if (event.key === "ArrowLeft") {
            if ((event.ctrlKey || event.metaKey || event.altKey) && !event.shiftKey) {
              writeSequence("\x1bb"); // Esc-b (move word backward)
              return false;
            }
          }

          if (event.key === "ArrowRight") {
            if ((event.ctrlKey || event.metaKey || event.altKey) && !event.shiftKey) {
              writeSequence("\x1bf"); // Esc-f (move word forward)
              return false;
            }
          }

          const isClearShortcut =
            (event.ctrlKey || event.metaKey) &&
            !event.altKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === "k";
          if (isClearShortcut) {
            terminal.clear();
            return false;
          }
          const isPasteShortcut =
            ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") ||
            (event.shiftKey && event.key === "Insert");
          if (isPasteShortcut) {
            event.preventDefault();
            void navigator.clipboard
              .readText()
              .then((text) => {
                pasteTextIntoTerminal(terminal, text);
              })
              .catch(console.error);
            return false;
          }
        }

        const isCopyShortcut =
          (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "c";
        if (isCopyShortcut) {
          const terminalSelection = terminal.getSelection();
          if (terminalSelection) {
            void navigator.clipboard.writeText(terminalSelection).catch(console.error);
            return false;
          }

          const nativeSelection = getNativeSelectionTextWithinHost(container);
          if (nativeSelection) {
            void navigator.clipboard.writeText(nativeSelection).catch(console.error);
            return false;
          }

          return true;
        }

        return true;
      });

      disposables.push(
        terminal.onData((data) => {
          const tab = terminalTabsRef.current.find((t) => t.key === tabKey);
          if (tab?.sessionId === null || tab?.sessionId === undefined) {
            if (tab?.status === "exited" && (data === "\r" || data === "\n")) {
              void restartTerminalTab(tabKey);
            }
            return;
          }

          const targetSessionId = tab.sessionId;
          const workspaceRootPath = getActiveTerminalSessionWorkspaceRootPath(tabKey);
          void window.echosphereTerminal
            .writeToSession({
              data,
              sessionId: targetSessionId,
              workspaceRootPath,
            })
            .catch((error) => {
              const errorMessage = getErrorMessage(error);
              const isUnknownOrExited =
                errorMessage.includes("Unknown terminal session id") ||
                errorMessage.includes("already exited") ||
                errorMessage.includes("does not belong");

              if (isUnknownOrExited) {
                sessionIdToTabKeyRef.current.delete(targetSessionId);
                setTerminalTabs((currentTabs) =>
                  currentTabs.map((t) =>
                    t.key === tabKey
                      ? {
                          ...t,
                          errorMessage: null,
                          exitCode: t.exitCode ?? 0,
                          sessionId: null,
                          status: "exited",
                        }
                      : t,
                  ),
                );

                const instanceToNotify = tabInstancesRef.current.get(tabKey);
                if (instanceToNotify) {
                  instanceToNotify.terminal.writeln(
                    "\r\n\r\n[Terminal session ended. Press Enter or click Restart to reconnect.]",
                  );
                }
              } else {
                console.error(`Failed to write terminal input for tab ${tabKey}`, error);
              }
            });
        }),
      );

      disposables.push(
        terminal.onResize(() => {
          const tab = terminalTabsRef.current.find((t) => t.key === tabKey);
          if (tab?.sessionId !== null && tab?.sessionId !== undefined) {
            sendTerminalSizeToSession(tabKey, tab.sessionId, getSessionDimensions(terminal));
          }
        }),
      );

      instance = {
        container,
        disposables,
        fitAddon,
        terminal,
        webLinksAddon,
      };

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

    instance.disposables.forEach((d) => d.dispose());
    instance.terminal.dispose();
    if (instance.container.parentElement) {
      instance.container.remove();
    }
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
      const session = await window.echosphereTerminal.createSession({
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
      instance.terminal.focus();
      syncTabSize(tabKey, true);
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

      instance.terminal.writeln(`\r\n\r\nFailed to start terminal: ${message}`);
      console.error("Failed to start terminal session", error);
    }
  }, [ensureTabInstance, syncTabSize, updateTabVisibility, workspaceKey]);

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

      if (!nextActiveTab) {
        return;
      }

      setActiveTerminalTabKey(nextActiveTab.key);
      updateTabVisibility(nextActiveTab.key);
    },
    [disposeTabInstance, onClose, updateTabVisibility],
  );

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
        void window.echosphereTerminal
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
        const session = await window.echosphereTerminal.createSession({
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

        instance.terminal.writeln(`\r\n\r\nFailed to start terminal: ${message}`);
        console.error("Failed to restart terminal session", error);
      }
    },
    [disposeTabInstance, ensureTabInstance, syncTabSize, updateTabVisibility],
  );

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

  useEffect(() => {
    const unsubscribeData = window.echosphereTerminal.onData((event) => {
      const tabKey = sessionIdToTabKeyRef.current.get(event.sessionId);
      if (!tabKey) {
        return;
      }

      const currentBuffer = tabBuffersRef.current.get(tabKey) ?? "";
      tabBuffersRef.current.set(tabKey, currentBuffer + event.data);

      const instance = tabInstancesRef.current.get(tabKey);
      if (instance) {
        instance.terminal.write(event.data);
      }
    });

    const unsubscribeExit = window.echosphereTerminal.onExit((event) => {
      const tabKey = sessionIdToTabKeyRef.current.get(event.sessionId);
      if (!tabKey) {
        return;
      }

      const tabWorkspaceKey =
        getWorkspaceKeyFromTerminalTabKey(tabKey) ?? activeWorkspaceKeyRef.current;

      sessionIdToTabKeyRef.current.delete(event.sessionId);
      const nextExitMessage = `\r\n\r\n[Terminal session ended with code ${event.exitCode}]`;
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

      const instance = tabInstancesRef.current.get(tabKey);
      if (instance) {
        instance.terminal.writeln(nextExitMessage);
      } else {
        const storedWorkspaceState = terminalWorkspaceStateRef.current[tabWorkspaceKey];
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
      }
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

  useEffect(() => {
    if (!terminalHostRef.current) {
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
      syncAllVisibleTabSizes(true);
    });
    const timeoutId = window.setTimeout(() => {
      syncAllVisibleTabSizes(true);
    }, TERMINAL_THEME_SYNC_DELAY_MS);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [activeTerminalTabKey, isOpen, isResizing, syncAllVisibleTabSizes, workspaceKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const hostElement = terminalHostRef.current;
    if (!hostElement) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      syncAllVisibleTabSizes();
    });
    resizeObserver.observe(hostElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen, syncAllVisibleTabSizes]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleWindowResize = () => {
      syncAllVisibleTabSizes();
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [isOpen, syncAllVisibleTabSizes]);

  useEffect(() => {
    const tabInstances = tabInstancesRef.current;
    return () => {
      tabInstances.forEach((instance) => {
        instance.disposables.forEach((d) => d.dispose());
        instance.terminal.dispose();
        if (instance.container.parentElement) {
          instance.container.remove();
        }
      });
      tabInstances.clear();
    };
  }, []);

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

    const nextWorkspaceState =
      terminalWorkspaceStateRef.current[nextWorkspaceKey] ?? {
        activeTerminalTabKey: null,
        nextTabIndex: 1,
        terminalTabs: [],
      };

    if (nextWorkspaceState.terminalTabs.length === 0) {
      previousWorkspaceKeyRef.current = nextWorkspaceKey;
      setTerminalTabs([]);
      setActiveTerminalTabKey(null);
      nextTabIndexRef.current = 1;
      terminalTabsRef.current = [];
      activeTabKeyRef.current = null;
      activeSessionIdRef.current = null;
      updateTabVisibility(null);
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

    updateTabVisibility(nextWorkspaceState.activeTerminalTabKey);
  }, [activeTerminalTabKey, terminalTabs, updateTabVisibility, workspaceKey]);

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
