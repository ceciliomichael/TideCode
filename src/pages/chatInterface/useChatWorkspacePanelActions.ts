import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { UseChatWorkspaceUiStateInput } from "./chatWorkspaceUiState.types";

interface SidebarPanelRestoreState {
  shouldRestoreExplorer: boolean;
  shouldRestoreRightPanel: boolean;
  shouldRestoreTabs: boolean;
}

interface UseChatWorkspacePanelActionsInput {
  activeWorkspacePanelWidth: number | null;
  isExplorerOpen: boolean;
  isRightPanelOpen: boolean;
  isSidebarOpen: boolean;
  isWorkspaceTabsPanelVisible: boolean;
  onDiffPanelWidthChange: UseChatWorkspaceUiStateInput["onDiffPanelWidthChange"];
  onDiffPanelWidthCommit: UseChatWorkspaceUiStateInput["onDiffPanelWidthCommit"];
  onRightPanelOpenChange: UseChatWorkspaceUiStateInput["onRightPanelOpenChange"];
  onRightPanelTabChange: UseChatWorkspaceUiStateInput["onRightPanelTabChange"];
  onUpdateSettings: UseChatWorkspaceUiStateInput["onUpdateSettings"];
  rightPanelTab: UseChatWorkspaceUiStateInput["rightPanelTab"];
  setConversationDiffPanelWidth: Dispatch<SetStateAction<number>>;
  setIsExplorerOpen: Dispatch<SetStateAction<boolean>>;
  setIsSidebarOpen: UseChatWorkspaceUiStateInput["setIsSidebarOpen"];
  setIsTerminalFullScreen: Dispatch<SetStateAction<boolean>>;
  setIsTerminalOpen: Dispatch<SetStateAction<boolean>>;
  setIsWorkspaceTabsPanelVisible: Dispatch<SetStateAction<boolean>>;
  setSourceControlPanelWidth: Dispatch<SetStateAction<number>>;
  setWorkspaceExplorerWidth: Dispatch<SetStateAction<number>>;
  settings: UseChatWorkspaceUiStateInput["settings"];
  sidebarPanelRestoreRef: MutableRefObject<SidebarPanelRestoreState | null>;
  workspaceFileTabCount: number;
}

export function useChatWorkspacePanelActions({
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
  workspaceFileTabCount,
}: UseChatWorkspacePanelActionsInput) {
    const handleWorkspaceExplorerWidthChange = useCallback(
      (nextWidth: number) => {
        setWorkspaceExplorerWidth(nextWidth);
      },
      [setWorkspaceExplorerWidth],
    );
  
    const handleWorkspaceExplorerWidthCommit = useCallback(
      (nextWidth: number) => {
        setWorkspaceExplorerWidth(nextWidth);
        if (nextWidth !== settings.workspaceExplorerWidth) {
          void onUpdateSettings({ workspaceExplorerWidth: nextWidth });
        }
      },
      [onUpdateSettings, setWorkspaceExplorerWidth, settings.workspaceExplorerWidth],
    );
  
    const handleConversationDiffPanelWidthChange = useCallback(
      (nextWidth: number) => {
        setConversationDiffPanelWidth(nextWidth);
      },
      [setConversationDiffPanelWidth],
    );
  
    const handleConversationDiffPanelWidthCommit = useCallback(
      (nextWidth: number) => {
        setConversationDiffPanelWidth(nextWidth);
        onDiffPanelWidthChange(nextWidth);
        onDiffPanelWidthCommit(nextWidth);
      },
      [onDiffPanelWidthChange, onDiffPanelWidthCommit, setConversationDiffPanelWidth],
    );
  
    const handleTerminalOpenChange = useCallback((nextOpen: boolean) => {
      setIsTerminalOpen(nextOpen);
    }, [setIsTerminalOpen]);
  
    const handleTerminalFullScreenChange = useCallback((nextFullScreen: boolean) => {
      setIsTerminalFullScreen(nextFullScreen);
    }, [setIsTerminalFullScreen]);
  
    const handleSourceControlPanelWidthChange = useCallback(
      (nextWidth: number) => {
        setSourceControlPanelWidth(nextWidth);
      },
      [setSourceControlPanelWidth],
    );
  
    const handleSourceControlPanelWidthCommit = useCallback(
      (nextWidth: number) => {
        setSourceControlPanelWidth(nextWidth);
      },
      [setSourceControlPanelWidth],
    );
  
    const handleOpenSourceControlPanel = useCallback(() => {
      setIsExplorerOpen(false);
      if (isSidebarOpen) {
        setIsWorkspaceTabsPanelVisible(false);
      } else if (workspaceFileTabCount > 0) {
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
      setIsExplorerOpen,
      setIsWorkspaceTabsPanelVisible,
      setSourceControlPanelWidth,
      workspaceFileTabCount,
    ]);
  
    const handleOpenDiffPanel = useCallback(() => {
      setIsExplorerOpen(false);
      if (isSidebarOpen) {
        setIsWorkspaceTabsPanelVisible(false);
      } else if (workspaceFileTabCount > 0) {
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
      setConversationDiffPanelWidth,
      setIsExplorerOpen,
      setIsWorkspaceTabsPanelVisible,
      workspaceFileTabCount,
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
            if (workspaceFileTabCount > 0) {
              setIsWorkspaceTabsPanelVisible(true);
            }
          } else if (workspaceFileTabCount > 0) {
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
      setIsExplorerOpen,
      setIsSidebarOpen,
      setIsWorkspaceTabsPanelVisible,
      setWorkspaceExplorerWidth,
      workspaceFileTabCount,
    ]);
  
    const handleSidebarOpenChange = useCallback(
      (nextSidebarOpen: boolean) => {
        if (nextSidebarOpen) {
          const shouldCloseTabs =
            isWorkspaceTabsPanelVisible && workspaceFileTabCount > 0;
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
  
        if (restoreState.shouldRestoreTabs && workspaceFileTabCount > 0) {
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
        setIsExplorerOpen,
        setIsWorkspaceTabsPanelVisible,
        sidebarPanelRestoreRef,
        workspaceFileTabCount,
      ],
    );

  return {
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
  };
}
