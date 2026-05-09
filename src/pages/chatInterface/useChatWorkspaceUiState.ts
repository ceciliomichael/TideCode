import { useCallback, useEffect, useRef, useState } from "react";
import { getPathBasename } from "../../lib/pathPresentation";
import { DEFAULT_DIFF_PANEL_WIDTH } from "../../lib/diffPanelSizing";
import { DEFAULT_TERMINAL_PANEL_HEIGHT } from "../../lib/terminalPanelSizing";
import { createMarkdownPreviewTabKey, isMarkdownPreviewablePath } from "../../lib/markdown-preview";
import { clampWorkspaceExplorerWidth } from "../../lib/workspaceExplorerSizing";
import type {
  WorkspaceFileTab,
  WorkspaceTab,
} from "../../components/workspaceExplorer/types";
import type {
  ChatWorkspaceUiState,
  UseChatWorkspaceUiStateInput,
  WorkspaceClipboardEntry,
  WorkspaceUiSession,
} from "./chatWorkspaceUiState.types";
import {
  isWorkspacePathWithinTarget,
  getTerminalWorkspaceKey,
  normalizeWorkspaceRelativePath,
  toWorkspaceScopedKey,
} from "./chatWorkspaceUiState.utils";
import {
  clearWorkspaceAutosaveTimeoutsForWorkspace,
  restoreWorkspaceUiSession,
  saveWorkspaceUiSession,
  syncActiveWorkspacePathRef,
} from "./chatWorkspaceUiStateSessions";
import {
  createWorkspaceEntryHandlers,
} from "./chatWorkspaceUiStateEntries";
import { shouldClearWorkspaceClipboardByPathPrefix } from "./chatWorkspaceClipboard";
import { getActiveWorkspacePanelWidth } from "./chatWorkspaceUiStatePanels";

export type {
  ChatWorkspaceUiState,
  WorkspaceClipboardEntry,
} from "./chatWorkspaceUiState.types";

function isMissingWorkspaceFileError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("File does not exist:");
}

const ACTIVE_WORKSPACE_TAB_SYNC_INTERVAL_MS = 1000;

export function useChatWorkspaceUiState({
  activeConversationId,
  activeWorkspacePath,
  diffPanelWidth,
  isRightPanelOpen,
  isSidebarOpen,
  onDiffPanelWidthChange,
  onDiffPanelWidthCommit,
  onRightPanelOpenChange,
  onRightPanelTabChange,
  onUpdateSettings,
  rightPanelTab,
  selectedFolderId,
  setIsSidebarOpen,
  settings,
}: UseChatWorkspaceUiStateInput): ChatWorkspaceUiState {
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [workspaceFileTabs, setWorkspaceFileTabs] = useState<
    WorkspaceTab[]
  >([]);
  const workspaceFileTabsRef = useRef<WorkspaceTab[]>([]);
  const [activeWorkspaceFilePath, setActiveWorkspaceFilePath] = useState<
    string | null
  >(null);
  const [activeWorkspaceTabKey, setActiveWorkspaceTabKey] = useState<
    string | null
  >(null);
  const [isWorkspaceTabsPanelVisible, setIsWorkspaceTabsPanelVisible] =
    useState(false);
  const [workspaceExplorerWidth, setWorkspaceExplorerWidth] = useState(
    settings.workspaceExplorerWidth,
  );
  const [workspaceEditorWidth, setWorkspaceEditorWidth] = useState(
    settings.workspaceEditorWidth,
  );
  const [sourceControlPanelWidth, setSourceControlPanelWidth] =
    useState(diffPanelWidth);
  const [conversationDiffPanelWidth, setConversationDiffPanelWidth] =
    useState(diffPanelWidth);
  const workspaceUiSessionsRef = useRef<Record<string, WorkspaceUiSession>>({});
  const activeWorkspaceUiKey = toWorkspaceScopedKey(activeWorkspacePath);
  const previousWorkspaceUiKeyRef = useRef(activeWorkspaceUiKey);
  const activeWorkspacePathRef = useRef<string | null>(activeWorkspacePath);
  const workspaceAutosaveTimeoutsRef = useRef<Map<string, number>>(new Map());
  const isWorkspaceFileTabsRefreshInFlightRef = useRef(false);
  const [workspaceClipboard, setWorkspaceClipboard] =
    useState<WorkspaceClipboardEntry | null>(null);
  const sidebarPanelRestoreRef = useRef<{
    shouldRestoreExplorer: boolean;
    shouldRestoreRightPanel: boolean;
    shouldRestoreTabs: boolean;
  } | null>(null);

  useEffect(() => {
    syncActiveWorkspacePathRef({ activeWorkspacePath, activeWorkspacePathRef });
  }, [activeWorkspacePath]);

  useEffect(() => {
    workspaceFileTabsRef.current = workspaceFileTabs;
  }, [workspaceFileTabs]);

  useEffect(() => {
    clearWorkspaceAutosaveTimeoutsForWorkspace({
      workspaceAutosaveTimeoutsRef,
    });
  }, [activeWorkspaceUiKey]);

  useEffect(() => {
    setWorkspaceExplorerWidth(settings.workspaceExplorerWidth);
  }, [settings.workspaceExplorerWidth]);

  useEffect(() => {
    setWorkspaceEditorWidth(settings.workspaceEditorWidth);
  }, [settings.workspaceEditorWidth]);

  useEffect(() => {
    restoreWorkspaceUiSession({
      activeWorkspaceFilePath,
      activeWorkspaceTabKey,
      activeWorkspaceUiKey,
      isExplorerOpen,
      isRightPanelOpen,
      isWorkspaceTabsPanelVisible,
      onRightPanelOpenChange,
      onRightPanelTabChange,
      previousWorkspaceUiKeyRef,
      setActiveWorkspaceFilePath,
      setActiveWorkspaceTabKey,
      setIsExplorerOpen,
      setIsWorkspaceTabsPanelVisible,
      setWorkspaceFileTabs,
      workspaceFileTabs,
      workspaceUiSessionsRef,
    });
  }, [
    activeWorkspaceFilePath,
    activeWorkspaceTabKey,
    activeWorkspaceUiKey,
    isExplorerOpen,
    isRightPanelOpen,
    isWorkspaceTabsPanelVisible,
    onRightPanelOpenChange,
    onRightPanelTabChange,
    rightPanelTab,
    workspaceFileTabs,
  ]);

  useEffect(() => {
    saveWorkspaceUiSession({
      activeWorkspaceFilePath,
      activeWorkspaceTabKey,
      activeWorkspaceUiKey,
      isExplorerOpen,
      isRightPanelOpen,
      isWorkspaceTabsPanelVisible,
      rightPanelTab,
      workspaceFileTabs,
      workspaceUiSessionsRef,
    });
  }, [
    activeWorkspaceFilePath,
    activeWorkspaceTabKey,
    activeWorkspaceUiKey,
    isExplorerOpen,
    isRightPanelOpen,
    isWorkspaceTabsPanelVisible,
    rightPanelTab,
    workspaceFileTabs,
  ]);

  useEffect(
    () => () => {
      clearWorkspaceAutosaveTimeoutsForWorkspace({
        workspaceAutosaveTimeoutsRef,
      });
    },
    [],
  );

  useEffect(() => {
    function handleWindowResize() {
      setWorkspaceExplorerWidth((currentWidth) =>
        clampWorkspaceExplorerWidth(currentWidth, window.innerWidth),
      );
    }

    handleWindowResize();
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  useEffect(() => {
    setWorkspaceEditorWidth((currentWidth) =>
      currentWidth === DEFAULT_DIFF_PANEL_WIDTH ? diffPanelWidth : currentWidth,
    );
    setSourceControlPanelWidth((currentWidth) =>
      currentWidth === DEFAULT_DIFF_PANEL_WIDTH ? diffPanelWidth : currentWidth,
    );
    setConversationDiffPanelWidth(diffPanelWidth);
  }, [diffPanelWidth]);

  const activeTerminalWorkspaceKey =
    getTerminalWorkspaceKey({
      activeConversationId,
      activeWorkspacePath,
      selectedFolderId,
    });
  const isTerminalOpen =
    settings.terminalOpenByWorkspace[activeTerminalWorkspaceKey] ?? false;
  const terminalPanelHeight =
    settings.terminalPanelHeightsByWorkspace[activeTerminalWorkspaceKey] ??
    DEFAULT_TERMINAL_PANEL_HEIGHT;
  const activeWorkspacePanelWidth = getActiveWorkspacePanelWidth({
    conversationDiffPanelWidth,
    isExplorerOpen,
    isRightPanelOpen,
    rightPanelTab,
    sourceControlPanelWidth,
    workspaceExplorerWidth,
  });

  const closeWorkspaceTabsByPathPrefix = useCallback((targetPath: string) => {
    const normalizedTargetPath = normalizeWorkspaceRelativePath(targetPath);
    workspaceAutosaveTimeoutsRef.current.forEach((timeoutId, relativePath) => {
      if (!isWorkspacePathWithinTarget(relativePath, normalizedTargetPath)) {
        return;
      }
      window.clearTimeout(timeoutId);
      workspaceAutosaveTimeoutsRef.current.delete(relativePath);
    });

    setWorkspaceFileTabs((currentTabs) => {
      const firstClosingIndex = currentTabs.findIndex((tab) =>
        isWorkspacePathWithinTarget(tab.relativePath, normalizedTargetPath),
      );
      const nextTabs = currentTabs.filter(
        (tab) =>
          !isWorkspacePathWithinTarget(tab.relativePath, normalizedTargetPath),
      );
      if (nextTabs.length === 0) {
        setIsWorkspaceTabsPanelVisible(false);
      }

      if (firstClosingIndex !== -1) {
        const fallbackTab =
          nextTabs[firstClosingIndex] ?? nextTabs[firstClosingIndex - 1] ?? null;

        setActiveWorkspaceFilePath((currentActivePath) => {
          if (
            !currentActivePath ||
            !isWorkspacePathWithinTarget(currentActivePath, normalizedTargetPath)
          ) {
            return currentActivePath;
          }

          return fallbackTab?.relativePath ?? null;
        });
        setActiveWorkspaceTabKey((currentActiveTabKey) => {
          if (!currentActiveTabKey) {
            return currentActiveTabKey;
          }

          const currentActiveTab =
            currentTabs.find((tab) => tab.tabKey === currentActiveTabKey) ?? null;
          if (
            !currentActiveTab ||
            !isWorkspacePathWithinTarget(currentActiveTab.relativePath, normalizedTargetPath)
          ) {
            return currentActiveTabKey;
          }

          return fallbackTab?.tabKey ?? null;
        });
      }

      return nextTabs;
    });
  }, []);

  const handleRefreshWorkspaceFileTabs = useCallback(async () => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      return;
    }

    const fileTabs = workspaceFileTabsRef.current.filter(
      (tab): tab is WorkspaceFileTab => tab.kind === "file",
    );
    if (fileTabs.length === 0) {
      return;
    }

    const pendingRefreshes = await Promise.all(
      fileTabs.map(async (tab) => {
        if (workspaceAutosaveTimeoutsRef.current.has(tab.relativePath)) {
          return null;
        }

        try {
          const result = await window.echosphereWorkspace.readFile({
            relativePath: tab.relativePath,
            workspaceRootPath,
          });

          return {
            relativePath: tab.relativePath,
            result,
          };
        } catch (error) {
          return {
            error,
            relativePath: tab.relativePath,
          };
        }
      }),
    );

    const refreshByPath = new Map<
      string,
      | {
          error: unknown;
          relativePath: string;
        }
      | {
          relativePath: string;
          result: Awaited<ReturnType<typeof window.echosphereWorkspace.readFile>>;
        }
    >()

    for (const refresh of pendingRefreshes) {
      if (!refresh) {
        continue;
      }

      refreshByPath.set(refresh.relativePath, refresh)
    }

    if (refreshByPath.size === 0) {
      return
    }

    const missingRelativePaths = Array.from(refreshByPath.values())
      .filter((refresh): refresh is { error: unknown; relativePath: string } => "error" in refresh)
      .filter((refresh) => isMissingWorkspaceFileError(refresh.error))
      .map((refresh) => refresh.relativePath)

    for (const missingRelativePath of missingRelativePaths) {
      refreshByPath.delete(missingRelativePath)
      closeWorkspaceTabsByPathPrefix(missingRelativePath)
    }

    if (refreshByPath.size === 0) {
      return
    }

    setWorkspaceFileTabs((currentTabs) =>
      currentTabs.map((tab) => {
        if (tab.kind !== "file") {
          return tab
        }

        const refresh = refreshByPath.get(tab.relativePath)
        if (!refresh) {
          return tab
        }

        if ("error" in refresh) {
          return {
            ...tab,
            errorMessage:
              refresh.error instanceof Error
                ? refresh.error.message
                : "Failed to refresh file.",
            status: "error",
          }
        }

        const { result } = refresh
        return {
          ...tab,
          content: result.content,
          errorMessage: undefined,
          originalContent: result.content,
          fileName: getPathBasename(result.relativePath),
          isBinary: result.isBinary,
          isTruncated: result.isTruncated,
          relativePath: result.relativePath,
          sizeBytes: result.sizeBytes,
          status: "ready",
          tabKey: result.relativePath,
        }
      }),
    )
  }, [activeWorkspacePathRef, closeWorkspaceTabsByPathPrefix, workspaceAutosaveTimeoutsRef])

  useEffect(() => {
    const workspaceRootPath = activeWorkspacePath?.trim() ?? ""
    const shouldWatchWorkspaceChanges = workspaceRootPath.length > 0 && (isExplorerOpen || workspaceFileTabs.length > 0)
    if (!shouldWatchWorkspaceChanges) {
      return
    }

    let isDisposed = false
    const unsubscribeWorkspaceChanges = window.echosphereWorkspace.onExplorerChange((event) => {
      if (isDisposed || event.workspaceRootPath !== workspaceRootPath) {
        return
      }

      void handleRefreshWorkspaceFileTabs()
    })

    const refreshTabsIfIdle = () => {
      if (isWorkspaceFileTabsRefreshInFlightRef.current) {
        return
      }

      isWorkspaceFileTabsRefreshInFlightRef.current = true
      void handleRefreshWorkspaceFileTabs().finally(() => {
        isWorkspaceFileTabsRefreshInFlightRef.current = false
      })
    }

    const refreshIntervalId = window.setInterval(refreshTabsIfIdle, ACTIVE_WORKSPACE_TAB_SYNC_INTERVAL_MS)

    void window.echosphereWorkspace.watchExplorerChanges({
      workspaceRootPath,
    }).catch((error) => {
      console.error("Failed to watch workspace changes for open file tabs", error)
    })

    return () => {
      isDisposed = true
      window.clearInterval(refreshIntervalId)
      isWorkspaceFileTabsRefreshInFlightRef.current = false
      unsubscribeWorkspaceChanges()
      void window.echosphereWorkspace.unwatchExplorerChanges({
        workspaceRootPath,
      }).catch((error) => {
        console.error("Failed to stop watching workspace changes for open file tabs", error)
      })
    }
  }, [activeWorkspacePath, handleRefreshWorkspaceFileTabs, isExplorerOpen, workspaceFileTabs.length])

  const clearWorkspaceClipboardByPathPrefix = useCallback(
    (targetPath: string) => {
      setWorkspaceClipboard((currentClipboard) => {
        if (
          !shouldClearWorkspaceClipboardByPathPrefix({
            clipboard: currentClipboard,
            targetPath,
            workspaceRootPath: activeWorkspacePathRef.current,
          })
        ) {
          return currentClipboard;
        }
        return null;
      });
    },
    [],
  );

  const {
    handleCopyWorkspaceEntry,
    handleCreateWorkspaceEntry,
    handleCutWorkspaceEntry,
    handleDeleteWorkspaceEntry,
    handleImportWorkspaceEntry,
    handleMoveWorkspaceEntry,
    handlePasteWorkspaceEntry,
    handleRenameWorkspaceEntry,
  } = createWorkspaceEntryHandlers({
    activeWorkspacePathRef,
    clearWorkspaceClipboardByPathPrefix,
    closeWorkspaceTabsByPathPrefix,
    setWorkspaceClipboard,
    workspaceClipboard,
  });

  const handleOpenWorkspaceFile = useCallback(
    (relativePath: string) => {
      const workspaceRootPath = activeWorkspacePathRef.current;
      if (!workspaceRootPath) {
        return;
      }

      if (activeWorkspacePanelWidth !== null) {
        setWorkspaceExplorerWidth(activeWorkspacePanelWidth);
      }
      setIsSidebarOpen(false);
      setIsExplorerOpen(true);
      setIsWorkspaceTabsPanelVisible(true);
      onRightPanelOpenChange(false);
      setActiveWorkspaceFilePath(relativePath);
      setActiveWorkspaceTabKey(relativePath);
      setWorkspaceFileTabs((currentTabs) => {
        if (currentTabs.some((tab) => tab.kind === "file" && tab.relativePath === relativePath)) {
          return currentTabs;
        }

        return [
          ...currentTabs,
          {
            kind: "file",
            content: "",
            originalContent: null,
            fileName: getPathBasename(relativePath),
            isBinary: false,
            isTruncated: false,
            relativePath,
            tabKey: relativePath,
            sizeBytes: 0,
            status: "loading",
          },
        ];
      });

      void window.echosphereWorkspace
        .readFile({
          relativePath,
          workspaceRootPath,
        })
        .then((result) => {
          if (activeWorkspacePathRef.current !== workspaceRootPath) {
            return;
          }

          setWorkspaceFileTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.kind === "file" && tab.relativePath === relativePath
                ? {
                    ...tab,
                    content: result.content,
                    originalContent: result.content,
                    fileName: getPathBasename(result.relativePath),
                    isBinary: result.isBinary,
                    isTruncated: result.isTruncated,
                    relativePath: result.relativePath,
                    tabKey: result.relativePath,
                    sizeBytes: result.sizeBytes,
                    status: "ready",
                  }
                : tab,
            ),
          );
        })
        .catch((error) => {
          if (activeWorkspacePathRef.current !== workspaceRootPath) {
            return;
          }

          setWorkspaceFileTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.kind === "file" && tab.relativePath === relativePath
                ? {
                    ...tab,
                    errorMessage:
                      error instanceof Error
                        ? error.message
                        : "Failed to open file.",
                    status: "error",
                  }
                : tab,
            ),
          );
        });
    },
    [activeWorkspacePanelWidth, onRightPanelOpenChange, setIsSidebarOpen],
  );

  const handleOpenWorkspaceMarkdownPreview = useCallback(
    (relativePath: string) => {
      if (!isMarkdownPreviewablePath(relativePath)) {
        return;
      }

      const previewTabKey = createMarkdownPreviewTabKey(relativePath);

      setIsSidebarOpen(false);
      setIsExplorerOpen(true);
      setIsWorkspaceTabsPanelVisible(true);
      onRightPanelOpenChange(false);
      setActiveWorkspaceFilePath(relativePath);
      setActiveWorkspaceTabKey(previewTabKey);

      setWorkspaceFileTabs((currentTabs) => {
        if (currentTabs.some((tab) => tab.tabKey === previewTabKey)) {
          return currentTabs
        }

        return [
          ...currentTabs,
          {
            kind: "markdown-preview",
            fileName: getPathBasename(relativePath),
            relativePath,
            tabKey: previewTabKey,
          },
        ]
      })
    },
    [onRightPanelOpenChange, setIsSidebarOpen],
  );

  const handleCloseWorkspaceTab = useCallback((tabKey: string) => {
    const closingTab = workspaceFileTabs.find((tab) => tab.tabKey === tabKey) ?? null;
    const targetPath = closingTab?.relativePath ?? tabKey;
    const closingPreviewTabKey =
      closingTab?.kind === "file" ? createMarkdownPreviewTabKey(closingTab.relativePath) : null;

    if (closingTab?.kind === "file") {
      const pendingAutosaveTimeout =
        workspaceAutosaveTimeoutsRef.current.get(targetPath);
      if (typeof pendingAutosaveTimeout === "number") {
        window.clearTimeout(pendingAutosaveTimeout);
        workspaceAutosaveTimeoutsRef.current.delete(targetPath);
      }
    }

    setWorkspaceFileTabs((currentTabs) => {
      const closingIndex = currentTabs.findIndex((tab) => tab.tabKey === tabKey);
      if (closingIndex === -1) {
        return currentTabs;
      }

      const nextTabs =
        closingTab?.kind === "file"
          ? currentTabs.filter(
              (tab) =>
                tab.tabKey !== tabKey &&
                !(tab.kind === "markdown-preview" && tab.relativePath === closingTab.relativePath),
            )
          : currentTabs.filter((tab) => tab.tabKey !== tabKey);

      if (nextTabs.length === 0) {
        setIsWorkspaceTabsPanelVisible(false);
      }
      setActiveWorkspaceFilePath((currentActiveFilePath) => {
        if (!closingTab) {
          return currentActiveFilePath;
        }

        const shouldClearActivePath =
          closingTab.kind === "markdown-preview"
            ? currentActiveFilePath === closingTab.relativePath
            : currentActiveFilePath === closingTab.relativePath;
        if (!shouldClearActivePath) {
          return currentActiveFilePath;
        }

        const fallbackTab =
          nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? null;
        return fallbackTab?.relativePath ?? null;
      });
      setActiveWorkspaceTabKey((currentActiveTabKey) => {
        if (
          currentActiveTabKey !== tabKey &&
          currentActiveTabKey !== closingPreviewTabKey
        ) {
          return currentActiveTabKey;
        }
        const fallbackTab = nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? null;
        return fallbackTab?.tabKey ?? null;
      });
      return nextTabs;
    });
  }, [workspaceFileTabs]);

  const handleSelectWorkspaceTab = useCallback((tabKey: string) => {
    const selectedTab = workspaceFileTabs.find((tab) => tab.tabKey === tabKey) ?? null;
    setActiveWorkspaceFilePath(selectedTab?.relativePath ?? null);
    setActiveWorkspaceTabKey(selectedTab?.tabKey ?? tabKey);
  }, [workspaceFileTabs]);

  const handleWorkspaceEditorWidthChange = useCallback((nextWidth: number) => {
    setWorkspaceEditorWidth(nextWidth);
  }, []);

  const handleWorkspaceEditorWidthCommit = useCallback(
    (nextWidth: number) => {
      setWorkspaceEditorWidth(nextWidth);
      if (nextWidth !== settings.workspaceEditorWidth) {
        void onUpdateSettings({ workspaceEditorWidth: nextWidth });
      }
    },
    [onUpdateSettings, settings.workspaceEditorWidth],
  );

  const handleWorkspaceExplorerWidthChange = useCallback(
    (nextWidth: number) => {
      setWorkspaceExplorerWidth(nextWidth);
    },
    [],
  );

  const handleWorkspaceExplorerWidthCommit = useCallback(
    (nextWidth: number) => {
      setWorkspaceExplorerWidth(nextWidth);
      if (nextWidth !== settings.workspaceExplorerWidth) {
        void onUpdateSettings({ workspaceExplorerWidth: nextWidth });
      }
    },
    [onUpdateSettings, settings.workspaceExplorerWidth],
  );

  const handleConversationDiffPanelWidthChange = useCallback(
    (nextWidth: number) => {
      setConversationDiffPanelWidth(nextWidth);
    },
    [],
  );

  const handleConversationDiffPanelWidthCommit = useCallback(
    (nextWidth: number) => {
      setConversationDiffPanelWidth(nextWidth);
      onDiffPanelWidthChange(nextWidth);
      onDiffPanelWidthCommit(nextWidth);
    },
    [onDiffPanelWidthChange, onDiffPanelWidthCommit],
  );

  const handleSourceControlPanelWidthChange = useCallback(
    (nextWidth: number) => {
      setSourceControlPanelWidth(nextWidth);
    },
    [],
  );

  const handleSourceControlPanelWidthCommit = useCallback(
    (nextWidth: number) => {
      setSourceControlPanelWidth(nextWidth);
    },
    [],
  );

  const handleWorkspaceFileContentChange = useCallback((relativePath: string, content: string) => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      return;
    }

    setWorkspaceFileTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.kind === "file" && tab.relativePath === relativePath
          ? {
              ...tab,
              content,
              sizeBytes: new TextEncoder().encode(content).length,
            }
          : tab,
      ),
    );

    const pendingAutosaveTimeout = workspaceAutosaveTimeoutsRef.current.get(relativePath);
    if (typeof pendingAutosaveTimeout === 'number') {
      window.clearTimeout(pendingAutosaveTimeout);
    }

    const timeoutId = window.setTimeout(() => {
      void window.echosphereWorkspace
        .writeFile({
          content,
          relativePath,
          workspaceRootPath,
        })
        .then((result) => {
          if (activeWorkspacePathRef.current !== workspaceRootPath) {
            return;
          }

          setWorkspaceFileTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.kind === "file" && tab.relativePath === relativePath
                ? {
                    ...tab,
                    sizeBytes: result.sizeBytes,
                    originalContent: content,
                  }
                : tab,
            ),
          );
        })
        .catch((error) => {
          console.error(`Failed to autosave ${relativePath}`, error);
        })
        .finally(() => {
          const activeTimeoutId = workspaceAutosaveTimeoutsRef.current.get(relativePath);
          if (activeTimeoutId === timeoutId) {
            workspaceAutosaveTimeoutsRef.current.delete(relativePath);
          }
        });
    }, 220);

    workspaceAutosaveTimeoutsRef.current.set(relativePath, timeoutId);
  }, []);

  const handleOpenSourceControlPanel = useCallback(() => {
    setIsExplorerOpen(false);
    if (isSidebarOpen) {
      setIsWorkspaceTabsPanelVisible(false);
    } else if (workspaceFileTabs.length > 0) {
      setIsWorkspaceTabsPanelVisible(true);
    }
    if (activeWorkspacePanelWidth !== null) {
      setSourceControlPanelWidth(activeWorkspacePanelWidth);
    }
    if (isRightPanelOpen && rightPanelTab === "source-control") {
      onRightPanelOpenChange(false);
      return;
    }

    onRightPanelTabChange("source-control");
    onRightPanelOpenChange(true);
  }, [
    activeWorkspacePanelWidth,
    isRightPanelOpen,
    isSidebarOpen,
    onRightPanelOpenChange,
    onRightPanelTabChange,
    rightPanelTab,
    workspaceFileTabs.length,
  ]);

  const handleOpenDiffPanel = useCallback(() => {
    setIsExplorerOpen(false);
    if (isSidebarOpen) {
      setIsWorkspaceTabsPanelVisible(false);
    } else if (workspaceFileTabs.length > 0) {
      setIsWorkspaceTabsPanelVisible(true);
    }
    if (activeWorkspacePanelWidth !== null) {
      setConversationDiffPanelWidth(activeWorkspacePanelWidth);
    }
    if (isRightPanelOpen && rightPanelTab === "diff") {
      onRightPanelOpenChange(false);
      return;
    }

    onRightPanelTabChange("diff");
    onRightPanelOpenChange(true);
  }, [
    activeWorkspacePanelWidth,
    isRightPanelOpen,
    isSidebarOpen,
    onRightPanelOpenChange,
    onRightPanelTabChange,
    rightPanelTab,
    workspaceFileTabs.length,
  ]);

  const handleToggleExplorerPanel = useCallback(() => {
    setIsExplorerOpen((currentValue) => {
      const nextValue = !currentValue;
      if (!nextValue) {
        sidebarPanelRestoreRef.current = null;
        setIsSidebarOpen(true);
        setIsWorkspaceTabsPanelVisible(false);
        return nextValue;
      }

      if (nextValue) {
        if (activeWorkspacePanelWidth !== null) {
          setWorkspaceExplorerWidth(activeWorkspacePanelWidth);
        }
        if (isSidebarOpen) {
          sidebarPanelRestoreRef.current = null;
          setIsSidebarOpen(false);
          if (workspaceFileTabs.length > 0) {
            setIsWorkspaceTabsPanelVisible(true);
          }
        } else if (workspaceFileTabs.length > 0) {
          setIsWorkspaceTabsPanelVisible(true);
        }

        onRightPanelOpenChange(false);
      }
      return nextValue;
    });
  }, [
    activeWorkspacePanelWidth,
    isSidebarOpen,
    onRightPanelOpenChange,
    sidebarPanelRestoreRef,
    setIsSidebarOpen,
    setIsWorkspaceTabsPanelVisible,
    workspaceFileTabs.length,
  ]);

  const handleSidebarOpenChange = useCallback(
    (nextSidebarOpen: boolean) => {
      if (nextSidebarOpen) {
        const shouldCloseTabs =
          isWorkspaceTabsPanelVisible && workspaceFileTabs.length > 0;
        const shouldCloseRightPanel = isRightPanelOpen;
        const shouldCloseExplorer = isExplorerOpen;
        const shouldClosePanels =
          shouldCloseTabs || shouldCloseRightPanel || shouldCloseExplorer;

        if (!shouldClosePanels) {
          sidebarPanelRestoreRef.current = null;
          return;
        }

        sidebarPanelRestoreRef.current = {
          shouldRestoreExplorer: shouldCloseExplorer,
          shouldRestoreRightPanel: shouldCloseRightPanel,
          shouldRestoreTabs: shouldCloseTabs,
        };

        if (shouldCloseTabs) {
          setIsWorkspaceTabsPanelVisible(false);
        }
        if (shouldCloseRightPanel) {
          onRightPanelOpenChange(false);
        }
        if (shouldCloseExplorer) {
          setIsExplorerOpen(false);
        }
        return;
      }

      const restoreState = sidebarPanelRestoreRef.current;
      sidebarPanelRestoreRef.current = null;
      if (!restoreState) {
        return;
      }

      if (restoreState.shouldRestoreTabs && workspaceFileTabs.length > 0) {
        setIsWorkspaceTabsPanelVisible(true);
      }
      if (restoreState.shouldRestoreRightPanel) {
        onRightPanelOpenChange(true);
      }
      if (restoreState.shouldRestoreExplorer) {
        setIsExplorerOpen(true);
      }
    },
    [
      isExplorerOpen,
      isRightPanelOpen,
      isWorkspaceTabsPanelVisible,
      onRightPanelOpenChange,
      workspaceFileTabs.length,
    ],
  );

  const isWorkspaceTabsPanelOpen =
    isWorkspaceTabsPanelVisible && workspaceFileTabs.length > 0;

  return {
    activeWorkspaceFilePath,
    activeTerminalWorkspaceKey,
    activeWorkspaceTabKey,
    activeWorkspacePath,
    conversationDiffPanelWidth,
    handleCloseWorkspaceTab,
    handleConversationDiffPanelWidthChange,
    handleConversationDiffPanelWidthCommit,
    handleCopyWorkspaceEntry,
    handleCreateWorkspaceEntry,
    handleCutWorkspaceEntry,
    handleDeleteWorkspaceEntry,
    handleImportWorkspaceEntry,
    handleMoveWorkspaceEntry,
    handleOpenDiffPanel,
    handleOpenSourceControlPanel,
    handleOpenWorkspaceFile,
    handleOpenWorkspaceMarkdownPreview,
    handlePasteWorkspaceEntry,
    handleRefreshWorkspaceFileTabs,
    handleRenameWorkspaceEntry,
    handleSelectWorkspaceTab,
    handleSourceControlPanelWidthChange,
    handleSourceControlPanelWidthCommit,
    handleSidebarOpenChange,
    handleToggleExplorerPanel,
    handleWorkspaceEditorWidthChange,
    handleWorkspaceEditorWidthCommit,
    handleWorkspaceExplorerWidthChange,
    handleWorkspaceExplorerWidthCommit,
    handleWorkspaceFileContentChange,
    isExplorerOpen,
    isTerminalOpen,
    isWorkspaceTabsPanelOpen,
    sourceControlPanelWidth,
    terminalPanelHeight,
    workspaceClipboard,
    workspaceEditorWidth,
    workspaceExplorerWidth,
    workspaceFileTabs,
  };
}
