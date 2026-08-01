import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { getPathBasename } from "../../lib/pathPresentation";
import type { WorkspaceTab } from "../../components/workspaceExplorer/types";
import {
  isWorkspacePathWithinTarget,
  normalizeWorkspaceRelativePath,
} from "./chatWorkspaceUiState.utils";

const ACTIVE_WORKSPACE_TAB_SYNC_INTERVAL_MS = 1000;

function isMissingWorkspaceFileError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("File does not exist:");
}

interface UseWorkspaceTabSyncInput {
  activeWorkspacePath: string | null | undefined;
  activeWorkspacePathRef: MutableRefObject<string | null>;
  isExplorerOpen: boolean;
  setActiveWorkspaceFilePath: Dispatch<SetStateAction<string | null>>;
  setActiveWorkspaceTabKey: Dispatch<SetStateAction<string | null>>;
  setIsWorkspaceTabsPanelVisible: Dispatch<SetStateAction<boolean>>;
  setWorkspaceFileTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  workspaceAutosaveTimeoutsRef: MutableRefObject<Map<string, number>>;
  workspaceFileTabCount: number;
  workspaceFileTabsRef: MutableRefObject<WorkspaceTab[]>;
}

export function useWorkspaceTabSync({
  activeWorkspacePath,
  activeWorkspacePathRef,
  isExplorerOpen,
  setActiveWorkspaceFilePath,
  setActiveWorkspaceTabKey,
  setIsWorkspaceTabsPanelVisible,
  setWorkspaceFileTabs,
  workspaceAutosaveTimeoutsRef,
  workspaceFileTabCount,
  workspaceFileTabsRef,
}: UseWorkspaceTabSyncInput) {
  const isWorkspaceFileTabsRefreshInFlightRef = useRef(false);

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
    }, [
      setActiveWorkspaceFilePath,
      setActiveWorkspaceTabKey,
      setIsWorkspaceTabsPanelVisible,
      setWorkspaceFileTabs,
      workspaceAutosaveTimeoutsRef,
    ]);
  
    const handleRefreshWorkspaceFileTabs = useCallback(async () => {
      const workspaceRootPath = activeWorkspacePathRef.current;
      if (!workspaceRootPath) {
        return;
      }
  
      const targetRelativePaths = Array.from(
        new Set(
          workspaceFileTabsRef.current
            .filter((tab) => tab.kind === "file" || tab.kind === "markdown-preview")
            .map((tab) => tab.relativePath),
        ),
      );
      if (targetRelativePaths.length === 0) {
        return;
      }
  
      const pendingRefreshes = await Promise.all(
        targetRelativePaths.map(async (relativePath) => {
          if (workspaceAutosaveTimeoutsRef.current.has(relativePath)) {
            return null;
          }
  
          try {
            const result = await window.tidecodeWorkspace.readFile({
              relativePath,
              workspaceRootPath,
            });
  
            return {
              relativePath,
              result,
            };
          } catch (error) {
            return {
              error,
              relativePath,
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
            result: Awaited<ReturnType<typeof window.tidecodeWorkspace.readFile>>;
          }
      >();
  
      for (const refresh of pendingRefreshes) {
        if (!refresh) {
          continue;
        }
  
        refreshByPath.set(refresh.relativePath, refresh);
      }
  
      if (refreshByPath.size === 0) {
        return;
      }
  
      const missingRelativePaths = Array.from(refreshByPath.values())
        .filter((refresh): refresh is { error: unknown; relativePath: string } => "error" in refresh)
        .filter((refresh) => isMissingWorkspaceFileError(refresh.error))
        .map((refresh) => refresh.relativePath);
  
      for (const missingRelativePath of missingRelativePaths) {
        refreshByPath.delete(missingRelativePath);
        closeWorkspaceTabsByPathPrefix(missingRelativePath);
      }
  
      if (refreshByPath.size === 0) {
        return;
      }
  
      setWorkspaceFileTabs((currentTabs) =>
        currentTabs.map((tab) => {
          if (tab.kind !== "file" && tab.kind !== "markdown-preview") {
            return tab;
          }
  
          const refresh = refreshByPath.get(tab.relativePath);
          if (!refresh) {
            return tab;
          }
  
          if ("error" in refresh) {
            if (tab.status === "loading") {
              return {
                ...tab,
                errorMessage:
                  refresh.error instanceof Error
                    ? refresh.error.message
                    : "Failed to refresh file.",
                status: "error",
              };
            }
            console.warn(`Failed to refresh file: ${tab.relativePath}`, refresh.error);
            return tab;
          }
  
          const { result } = refresh;
          const normalizedContent = result.content.replace(/\r\n/g, "\n");
  
          if (tab.kind === "file") {
            if (tab.content === normalizedContent || workspaceAutosaveTimeoutsRef.current.has(tab.relativePath)) {
              return tab;
            }
  
            return {
              ...tab,
              content: normalizedContent,
              errorMessage: undefined,
              originalContent: normalizedContent,
              fileName: getPathBasename(result.relativePath),
              isBinary: result.isBinary,
              isTruncated: result.isTruncated,
              relativePath: result.relativePath,
              sizeBytes: result.sizeBytes,
              status: "ready",
              tabKey: result.relativePath,
            };
          }
  
          if (tab.kind === "markdown-preview") {
            if (tab.content === normalizedContent && tab.status === "ready") {
              return tab;
            }
  
            return {
              ...tab,
              content: normalizedContent,
              errorMessage: undefined,
              fileName: getPathBasename(result.relativePath),
              isTruncated: result.isTruncated,
              status: "ready",
            };
          }
  
          return tab;
        }),
      );
    }, [
      activeWorkspacePathRef,
      closeWorkspaceTabsByPathPrefix,
      setWorkspaceFileTabs,
      workspaceAutosaveTimeoutsRef,
      workspaceFileTabsRef,
    ]);
  
    useEffect(() => {
      const workspaceRootPath = activeWorkspacePath?.trim() ?? ""
      const shouldWatchWorkspaceChanges = workspaceRootPath.length > 0 && (isExplorerOpen || workspaceFileTabCount > 0)
      if (!shouldWatchWorkspaceChanges) {
        return
      }
  
      let isDisposed = false
      const unsubscribeWorkspaceChanges = window.tidecodeWorkspace.onExplorerChange((event) => {
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
  
      void window.tidecodeWorkspace.watchExplorerChanges({
        workspaceRootPath,
      }).catch((error) => {
        console.error("Failed to watch workspace changes for open file tabs", error)
      })
  
      return () => {
        isDisposed = true
        window.clearInterval(refreshIntervalId)
        isWorkspaceFileTabsRefreshInFlightRef.current = false
        unsubscribeWorkspaceChanges()
        void window.tidecodeWorkspace.unwatchExplorerChanges({
          workspaceRootPath,
        }).catch((error) => {
          console.error("Failed to stop watching workspace changes for open file tabs", error)
        })
      }
    }, [activeWorkspacePath, handleRefreshWorkspaceFileTabs, isExplorerOpen, workspaceFileTabCount])

    const handleWorkspaceFileContentChange = useCallback((relativePath: string, content: string) => {
      const workspaceRootPath = activeWorkspacePathRef.current;
      if (!workspaceRootPath) {
        return;
      }
  
      setWorkspaceFileTabs((currentTabs) =>
        currentTabs.map((tab) => {
          if (tab.relativePath !== relativePath) {
            return tab;
          }
  
          if (tab.kind === "file") {
            return {
              ...tab,
              content,
              sizeBytes: new TextEncoder().encode(content).length,
            };
          }
  
          if (tab.kind === "markdown-preview") {
            return {
              ...tab,
              content,
              status: "ready",
            };
          }
  
          return tab;
        }),
      );
  
      const pendingAutosaveTimeout = workspaceAutosaveTimeoutsRef.current.get(relativePath);
      if (typeof pendingAutosaveTimeout === 'number') {
        window.clearTimeout(pendingAutosaveTimeout);
      }
  
      const timeoutId = window.setTimeout(() => {
        void window.tidecodeWorkspace
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
    }, [
      activeWorkspacePathRef,
      setWorkspaceFileTabs,
      workspaceAutosaveTimeoutsRef,
    ]);

  return {
    closeWorkspaceTabsByPathPrefix,
    handleRefreshWorkspaceFileTabs,
    handleWorkspaceFileContentChange,
  };
}
