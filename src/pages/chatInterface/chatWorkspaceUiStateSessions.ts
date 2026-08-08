import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ChatInterfaceRightPanelTab } from "../../hooks/useChatInterfaceController";
import type { WorkspaceTab } from "../../components/workspaceExplorer/types";
import type { WorkspaceUiSession } from "./chatWorkspaceUiState.types";
import type { PlanCommentsByPath } from "../../lib/planComments";

interface SaveWorkspaceUiSessionInput {
  activeWorkspaceFilePath: string | null;
  activeWorkspaceTabKey: string | null;
  activeWorkspaceUiKey: string;
  isExplorerOpen: boolean;
  isTerminalOpen: boolean;
  isTerminalFullScreen: boolean;
  isRightPanelOpen: boolean;
  isWorkspaceTabsPanelVisible: boolean;
  planCommentsByPath: PlanCommentsByPath;
  rightPanelTab: ChatInterfaceRightPanelTab;
  workspaceFileTabs: WorkspaceTab[];
  workspaceUiSessionsRef: MutableRefObject<Record<string, WorkspaceUiSession>>;
}

interface RestoreWorkspaceUiSessionInput {
  activeWorkspaceFilePath: string | null;
  activeWorkspaceTabKey: string | null;
  activeWorkspaceUiKey: string;
  isExplorerOpen: boolean;
  isTerminalOpen: boolean;
  isTerminalFullScreen: boolean;
  isRightPanelOpen: boolean;
  isWorkspaceTabsPanelVisible: boolean;
  planCommentsByPath: PlanCommentsByPath;
  onRightPanelOpenChange: (nextValue: boolean) => void;
  onRightPanelTabChange: (nextTab: ChatInterfaceRightPanelTab) => void;
  previousWorkspaceUiKeyRef: MutableRefObject<string>;
  setActiveWorkspaceFilePath: Dispatch<SetStateAction<string | null>>;
  setActiveWorkspaceTabKey: Dispatch<SetStateAction<string | null>>;
  setIsExplorerOpen: Dispatch<SetStateAction<boolean>>;
  setPlanCommentsByPath: Dispatch<SetStateAction<PlanCommentsByPath>>;
  setIsTerminalOpen: Dispatch<SetStateAction<boolean>>;
  setIsTerminalFullScreen: Dispatch<SetStateAction<boolean>>;
  setIsWorkspaceTabsPanelVisible: Dispatch<SetStateAction<boolean>>;
  setWorkspaceFileTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  workspaceFileTabs: WorkspaceTab[];
  workspaceUiSessionsRef: MutableRefObject<Record<string, WorkspaceUiSession>>;
}

interface SidebarPanelRestoreRef {
  shouldRestoreExplorer: boolean;
  shouldRestoreRightPanel: boolean;
  shouldRestoreTabs: boolean;
}

interface HandleSidebarOpenChangeInput {
  isExplorerOpen: boolean;
  isRightPanelOpen: boolean;
  isWorkspaceTabsPanelVisible: boolean;
  onRightPanelOpenChange: (nextValue: boolean) => void;
  setIsExplorerOpen: Dispatch<SetStateAction<boolean>>;
  setIsWorkspaceTabsPanelVisible: Dispatch<SetStateAction<boolean>>;
  sidebarPanelRestoreRef: MutableRefObject<SidebarPanelRestoreRef | null>;
  workspaceFileTabsLength: number;
}

interface WorkspacePathRefInput {
  activeWorkspacePath: string | null;
  activeWorkspacePathRef: MutableRefObject<string | null>;
}

interface WorkspaceAutosaveTimeoutsRefInput {
  workspaceAutosaveTimeoutsRef: MutableRefObject<Map<string, number>>;
}

function hydrateWorkspaceTabs(tabs: readonly WorkspaceTab[]): WorkspaceTab[] {
  return tabs.map((tab) =>
    tab.kind === 'file'
      ? {
          ...tab,
          originalContent: tab.originalContent ?? tab.content,
        }
      : tab,
  )
}

export function saveWorkspaceUiSession({
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
}: SaveWorkspaceUiSessionInput) {
  workspaceUiSessionsRef.current[activeWorkspaceUiKey] = {
    activeFilePath: activeWorkspaceFilePath,
    activeTabKey: activeWorkspaceTabKey,
    isExplorerOpen,
    isTerminalOpen,
    isTerminalFullScreen,
    isRightPanelOpen,
    isTabsVisible: isWorkspaceTabsPanelVisible,
    planCommentsByPath,
    rightPanelTab,
    tabs: workspaceFileTabs,
  };
}

export function restoreWorkspaceUiSession({
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
}: RestoreWorkspaceUiSessionInput) {
  const previousWorkspaceUiKey = previousWorkspaceUiKeyRef.current;
  if (previousWorkspaceUiKey === activeWorkspaceUiKey) {
    return;
  }

  saveWorkspaceUiSession({
    activeWorkspaceFilePath,
    activeWorkspaceTabKey,
    activeWorkspaceUiKey: previousWorkspaceUiKey,
    isExplorerOpen,
    isTerminalOpen,
    isTerminalFullScreen,
    isRightPanelOpen,
    isWorkspaceTabsPanelVisible,
    planCommentsByPath,
    rightPanelTab:
      workspaceUiSessionsRef.current[previousWorkspaceUiKey]?.rightPanelTab ??
      "diff",
    workspaceFileTabs,
    workspaceUiSessionsRef,
  });

  const nextSession = workspaceUiSessionsRef.current[activeWorkspaceUiKey];
  if (nextSession) {
    setActiveWorkspaceFilePath(nextSession.activeFilePath);
    setActiveWorkspaceTabKey(nextSession.activeTabKey ?? nextSession.activeFilePath);
    setIsWorkspaceTabsPanelVisible(nextSession.isTabsVisible);
    setIsExplorerOpen(nextSession.isExplorerOpen);
    setPlanCommentsByPath(nextSession.planCommentsByPath ?? {});
    setIsTerminalOpen(nextSession.isTerminalOpen);
    setIsTerminalFullScreen(nextSession.isTerminalFullScreen ?? false);
    onRightPanelTabChange(nextSession.rightPanelTab);
    onRightPanelOpenChange(nextSession.isRightPanelOpen);
    setWorkspaceFileTabs(hydrateWorkspaceTabs(nextSession.tabs));
  } else {
    setWorkspaceFileTabs([]);
    setActiveWorkspaceFilePath(null);
    setActiveWorkspaceTabKey(null);
    setIsWorkspaceTabsPanelVisible(false);
    setIsExplorerOpen(false);
    setPlanCommentsByPath({});
    setIsTerminalOpen(false);
    setIsTerminalFullScreen(false);
    onRightPanelTabChange("diff");
    onRightPanelOpenChange(false);
  }

  previousWorkspaceUiKeyRef.current = activeWorkspaceUiKey;
}

export function syncActiveWorkspacePathRef({
  activeWorkspacePath,
  activeWorkspacePathRef,
}: WorkspacePathRefInput) {
  activeWorkspacePathRef.current = activeWorkspacePath;
}

export function clearWorkspaceAutosaveTimeoutsForWorkspace({
  workspaceAutosaveTimeoutsRef,
}: WorkspaceAutosaveTimeoutsRefInput) {
  workspaceAutosaveTimeoutsRef.current.forEach((timeoutId) => {
    window.clearTimeout(timeoutId);
  });
  workspaceAutosaveTimeoutsRef.current.clear();
}

export function createHandleSidebarOpenChange({
  isExplorerOpen,
  isRightPanelOpen,
  isWorkspaceTabsPanelVisible,
  onRightPanelOpenChange,
  setIsExplorerOpen,
  setIsWorkspaceTabsPanelVisible,
  sidebarPanelRestoreRef,
  workspaceFileTabsLength,
}: HandleSidebarOpenChangeInput) {
  return (nextSidebarOpen: boolean) => {
    if (nextSidebarOpen) {
      const shouldCloseTabs =
        isWorkspaceTabsPanelVisible && workspaceFileTabsLength > 0;
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

    if (restoreState.shouldRestoreTabs && workspaceFileTabsLength > 0) {
      setIsWorkspaceTabsPanelVisible(true);
    }
    if (restoreState.shouldRestoreRightPanel) {
      onRightPanelOpenChange(true);
    }
    if (restoreState.shouldRestoreExplorer) {
      setIsExplorerOpen(true);
    }
  };
}
