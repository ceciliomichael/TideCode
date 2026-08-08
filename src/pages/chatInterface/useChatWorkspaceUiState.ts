import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_DIFF_PANEL_WIDTH } from "../../lib/diffPanelSizing";
import { DEFAULT_TERMINAL_PANEL_HEIGHT } from "../../lib/terminalPanelSizing";
import { clampWorkspaceExplorerWidth } from "../../lib/workspaceExplorerSizing";
import type { WorkspaceTab } from "../../components/workspaceExplorer/types";
import type { PlanReviewComment } from "../../lib/planContracts";
import { setPlanCommentsForPath, type PlanCommentsByPath } from "../../lib/planComments";
import type {
  ChatWorkspaceUiState,
  UseChatWorkspaceUiStateInput,
  WorkspaceClipboardEntry,
  WorkspaceUiSession,
} from "./chatWorkspaceUiState.types";
import {
  getTerminalWorkspaceKey,
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
import { useChatWorkspacePanelActions } from "./useChatWorkspacePanelActions";
import { useWorkspaceTabSync } from "./useWorkspaceTabSync";
import { useWorkspaceTabActions } from "./useWorkspaceTabActions";

export type {
  ChatWorkspaceUiState,
  WorkspaceClipboardEntry,
} from "./chatWorkspaceUiState.types";


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
  const [planCommentsByPath, setPlanCommentsByPath] = useState<PlanCommentsByPath>({});
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
  const [sourceControlPanelWidth, setSourceControlPanelWidth] =
    useState(diffPanelWidth);
  const [conversationDiffPanelWidth, setConversationDiffPanelWidth] =
    useState(diffPanelWidth);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isTerminalFullScreen, setIsTerminalFullScreen] = useState(false);
  const workspaceUiSessionsRef = useRef<Record<string, WorkspaceUiSession>>({});
  const activeWorkspaceUiKey = toWorkspaceScopedKey(activeWorkspacePath);
  const previousWorkspaceUiKeyRef = useRef(activeWorkspaceUiKey);
  const activeWorkspacePathRef = useRef<string | null>(activeWorkspacePath);
  const workspaceAutosaveTimeoutsRef = useRef<Map<string, number>>(new Map());
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

  useLayoutEffect(() => {
    setWorkspaceExplorerWidth(settings.workspaceExplorerWidth);
  }, [settings.workspaceExplorerWidth]);

  useEffect(() => {
    restoreWorkspaceUiSession({
      activeWorkspaceFilePath,
      activeWorkspaceTabKey,
      activeWorkspaceUiKey,
      isExplorerOpen,
      isTerminalOpen,
      isTerminalFullScreen,
      isRightPanelOpen,
      isWorkspaceTabsPanelVisible,
      planCommentsByPath,
      onRightPanelOpenChange,
      onRightPanelTabChange,
      previousWorkspaceUiKeyRef,
      setActiveWorkspaceFilePath,
      setActiveWorkspaceTabKey,
      setIsExplorerOpen,
      setPlanCommentsByPath,
      setIsTerminalOpen,
      setIsTerminalFullScreen,
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
    isTerminalOpen,
    isTerminalFullScreen,
    isRightPanelOpen,
    isWorkspaceTabsPanelVisible,
    planCommentsByPath,
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
      isTerminalOpen,
      isTerminalFullScreen,
      isRightPanelOpen,
      isWorkspaceTabsPanelVisible,
      planCommentsByPath,
      rightPanelTab,
      workspaceFileTabs,
      workspaceUiSessionsRef,
    });
  }, [
    activeWorkspaceFilePath,
    activeWorkspaceTabKey,
    activeWorkspaceUiKey,
    isExplorerOpen,
    isTerminalOpen,
    isTerminalFullScreen,
    isRightPanelOpen,
    isWorkspaceTabsPanelVisible,
    planCommentsByPath,
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

  useLayoutEffect(() => {
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
  const previousTerminalWorkspaceKeyRef = useRef(activeTerminalWorkspaceKey);
  const terminalOpenStatesRef = useRef<
    Record<string, { isTerminalOpen: boolean; isTerminalFullScreen: boolean }>
  >({});

  useEffect(() => {
    const previousKey = previousTerminalWorkspaceKeyRef.current;
    if (previousKey !== activeTerminalWorkspaceKey) {
      terminalOpenStatesRef.current[previousKey] = {
        isTerminalOpen,
        isTerminalFullScreen,
      };

      previousTerminalWorkspaceKeyRef.current = activeTerminalWorkspaceKey;

      const storedOpen = settings.terminalOpenByWorkspace[activeTerminalWorkspaceKey] ?? false;
      const nextState = terminalOpenStatesRef.current[activeTerminalWorkspaceKey] ?? {
        isTerminalOpen: storedOpen,
        isTerminalFullScreen: false,
      };

      setIsTerminalOpen(nextState.isTerminalOpen);
      setIsTerminalFullScreen(nextState.isTerminalFullScreen);
    } else {
      terminalOpenStatesRef.current[activeTerminalWorkspaceKey] = {
        isTerminalOpen,
        isTerminalFullScreen,
      };
    }
  }, [activeTerminalWorkspaceKey, isTerminalOpen, isTerminalFullScreen, settings.terminalOpenByWorkspace]);

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
  const {
    closeWorkspaceTabsByPathPrefix,
    handleRefreshWorkspaceFileTabs,
    handleWorkspaceFileContentChange,
  } = useWorkspaceTabSync({
    activeWorkspacePath,
    activeWorkspacePathRef,
    isExplorerOpen,
    setActiveWorkspaceFilePath,
    setActiveWorkspaceTabKey,
    setIsWorkspaceTabsPanelVisible,
    setWorkspaceFileTabs,
    workspaceAutosaveTimeoutsRef,
    workspaceFileTabCount: workspaceFileTabs.length,
    workspaceFileTabsRef,
  });

  const {
    handleConversationDiffPanelWidthChange,
    handleConversationDiffPanelWidthCommit,
    handleOpenDiffPanel,
    handleOpenSourceControlPanel,
    handleSidebarOpenChange,
    handleSourceControlPanelWidthChange,
    handleSourceControlPanelWidthCommit,
    handleTerminalFullScreenChange,
    handleTerminalOpenChange,
    handleToggleExplorerPanel,
    handleWorkspaceExplorerWidthChange,
    handleWorkspaceExplorerWidthCommit,
  } = useChatWorkspacePanelActions({
    activeWorkspacePanelWidth,
    isExplorerOpen,
    isRightPanelOpen,
    isSidebarOpen,
    isWorkspaceTabsPanelVisible,
    onDiffPanelWidthChange,
    onDiffPanelWidthCommit,
    onRightPanelOpenChange,
    onRightPanelTabChange,
    onUpdateSettings,
    rightPanelTab,
    setConversationDiffPanelWidth,
    setIsExplorerOpen,
    setIsSidebarOpen,
    setIsTerminalFullScreen,
    setIsTerminalOpen,
    setIsWorkspaceTabsPanelVisible,
    setSourceControlPanelWidth,
    setWorkspaceExplorerWidth,
    settings,
    sidebarPanelRestoreRef,
    workspaceFileTabCount: workspaceFileTabs.length,
  });


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

  const handlePlanCommentsChange = useCallback(
    (relativePath: string, comments: readonly PlanReviewComment[]) => {
      setPlanCommentsByPath((currentCommentsByPath) =>
        setPlanCommentsForPath(currentCommentsByPath, relativePath, comments),
      );
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

  const {
    handleCloseWorkspaceTab,
    handleMarkWorkspacePlanImplementationStarted,
    handleOpenWorkspaceFile,
    handleOpenWorkspaceMarkdownPreview,
    handleOpenWorkspacePlanPreview,
    handleOpenWorkspaceSvgPreview,
    handleSelectWorkspaceTab,
  } = useWorkspaceTabActions({
    activeWorkspacePanelWidth,
    activeWorkspacePathRef,
    onRightPanelOpenChange,
    setActiveWorkspaceFilePath,
    setActiveWorkspaceTabKey,
    setIsExplorerOpen,
    setIsSidebarOpen,
    setIsWorkspaceTabsPanelVisible,
    setWorkspaceExplorerWidth,
    setWorkspaceFileTabs,
    workspaceAutosaveTimeoutsRef,
    workspaceFileTabs,
    workspaceFileTabsRef,
  });

  const isWorkspaceTabsPanelOpen =
    isWorkspaceTabsPanelVisible && workspaceFileTabs.length > 0;

  return {
    activeWorkspaceFilePath,
    activeTerminalWorkspaceKey,
    activeWorkspaceTabKey,
    activeWorkspacePath,
    conversationDiffPanelWidth,
    handleCloseWorkspaceTab,
    handleCloseWorkspaceTabsByPath: closeWorkspaceTabsByPathPrefix,
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
    handleMarkWorkspacePlanImplementationStarted,
    handlePlanCommentsChange,
    handleOpenWorkspacePlanPreview,
    handleOpenWorkspaceSvgPreview,
    handlePasteWorkspaceEntry,
    handleRefreshWorkspaceFileTabs,
    handleRenameWorkspaceEntry,
    handleSelectWorkspaceTab,
    handleSidebarOpenChange,
    handleSourceControlPanelWidthChange,
    handleSourceControlPanelWidthCommit,
    handleTerminalFullScreenChange,
    handleTerminalOpenChange,
    handleToggleExplorerPanel,
    handleWorkspaceExplorerWidthChange,
    handleWorkspaceExplorerWidthCommit,
    handleWorkspaceFileContentChange,
    isExplorerOpen,
    isTerminalFullScreen,
    isTerminalOpen,
    isWorkspaceTabsPanelOpen,
    planCommentsByPath,
    sourceControlPanelWidth,
    terminalPanelHeight,
    workspaceClipboard,
    workspaceExplorerWidth,
    workspaceFileTabs,
  };
}
