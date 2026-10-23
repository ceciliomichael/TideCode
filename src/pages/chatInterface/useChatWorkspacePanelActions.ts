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
  terminalPanelPosition: 'bottom' | 'right';
  setIsWorkspaceTabsPanelVisible: Dispatch<SetStateAction<boolean>>;
  setWorkspaceExplorerWidth: Dispatch<SetStateAction<number>>;
  settings: UseChatWorkspaceUiStateInput["settings"];
  sidebarPanelRestoreRef: MutableRefObject<SidebarPanelRestoreState | null>;
  workspaceFileTabCount: number;
}

export function useChatWorkspacePanelActions({
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
  terminalPanelPosition,
  setIsWorkspaceTabsPanelVisible,
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
      if (nextOpen && terminalPanelPosition === 'right') {
        setIsExplorerOpen(false);
        onRightPanelOpenChange(false);
      }
      setIsTerminalOpen(nextOpen);
    }, [setIsTerminalOpen, terminalPanelPosition, setIsExplorerOpen, onRightPanelOpenChange]);
  
    const handleTerminalFullScreenChange = useCallback((nextFullScreen: boolean) => {
      setIsTerminalFullScreen(nextFullScreen);
    }, [setIsTerminalFullScreen]);
  
    const handleOpenSourceControlPanel = useCallback(() => {
      setIsExplorerOpen(false);
      if (isSidebarOpen) {
        setIsWorkspaceTabsPanelVisible(false);
      } else if (workspaceFileTabCount > 0) {
        setIsWorkspaceTabsPanelVisible(true);
      }
      if (isRightPanelOpen && rightPanelTab === "source-control") {
        onRightPanelOpenChange(false);
        return;
      }
  
      onRightPanelTabChange("source-control");
      onRightPanelOpenChange(true);
    }, [
      isRightPanelOpen,
      isSidebarOpen,
      onRightPanelOpenChange,
      onRightPanelTabChange,
      rightPanelTab,
      setIsExplorerOpen,
      setIsWorkspaceTabsPanelVisible,
      workspaceFileTabCount,
    ]);
  
    const handleOpenDiffPanel = useCallback(() => {
      setIsExplorerOpen(false);
      if (isSidebarOpen) {
        setIsWorkspaceTabsPanelVisible(false);
      } else if (workspaceFileTabCount > 0) {
        setIsWorkspaceTabsPanelVisible(true);
      }
      if (isRightPanelOpen && rightPanelTab === "diff") {
        onRightPanelOpenChange(false);
        return;
      }
  
      onRightPanelTabChange("diff");
      onRightPanelOpenChange(true);
    }, [
      isRightPanelOpen,
      isSidebarOpen,
      onRightPanelOpenChange,
      onRightPanelTabChange,
      rightPanelTab,
      setIsExplorerOpen,
      setIsWorkspaceTabsPanelVisible,
      workspaceFileTabCount,
    ]);
  
    const handleToggleExplorerPanel = useCallback(() => {
      const nextOpen = !isExplorerOpen;
      if (!nextOpen) {
        sidebarPanelRestoreRef.current = null;
        setIsSidebarOpen(true);
        setIsWorkspaceTabsPanelVisible(false);
        setIsExplorerOpen(false);
        return;
      }

      // Replace the right terminal in this event, before Explorer can affect layout.
      if (terminalPanelPosition === 'right') {
        setIsTerminalOpen(false);
      }
      if (isSidebarOpen) {
        sidebarPanelRestoreRef.current = null;
        setIsSidebarOpen(false);
      }
      if (workspaceFileTabCount > 0) {
        setIsWorkspaceTabsPanelVisible(true);
      }
      onRightPanelOpenChange(false);
      setIsExplorerOpen(true);
    }, [
      isExplorerOpen,
      isSidebarOpen,
      onRightPanelOpenChange,
      sidebarPanelRestoreRef,
      setIsExplorerOpen,
      setIsSidebarOpen,
      setIsTerminalOpen,
      setIsWorkspaceTabsPanelVisible,
      terminalPanelPosition,
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
    handleTerminalFullScreenChange,
    handleTerminalOpenChange,
    handleToggleExplorerPanel,
    handleWorkspaceExplorerWidthChange,
    handleWorkspaceExplorerWidthCommit,
  };
}
