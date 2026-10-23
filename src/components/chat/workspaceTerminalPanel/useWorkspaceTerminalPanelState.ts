import type {
  WorkspaceTerminalPanelProps,
  WorkspaceTerminalPanelState,
} from "./workspaceTerminalPanelTypes";
import { useWorkspaceTerminalPanelSizing } from "./useWorkspaceTerminalPanelSizing";
import { useWorkspaceTerminalSessionState } from "./useWorkspaceTerminalSessionState";

export function useWorkspaceTerminalPanelState({
  position = "bottom",
  onPositionChange,
  panelWidth = 448,
  onWidthChange,
  onWidthCommit,
  autoCreateTabOnOpen = false,
  isOpen,
  onClose,
  onHeightCommit,
  resolvedTheme,
  storedHeight,
  workspaceKey,
  workspacePath,
  isFullScreen,
  onFullScreenChange,
}: WorkspaceTerminalPanelProps): WorkspaceTerminalPanelState {
  const sizingState = useWorkspaceTerminalPanelSizing({
    position,
    panelWidth,
    onWidthChange,
    onWidthCommit,
    isFullScreen,
    isOpen,
    onHeightCommit,
    storedHeight,
  });
  const sessionState = useWorkspaceTerminalSessionState({
    autoCreateTabOnOpen,
    isOpen,
    isResizing: sizingState.isResizing,
    onClose,
    resolvedTheme,
    workspaceKey,
    workspacePath,
  });

  return {
    position,
    onPositionChange,
    panelWidth: sizingState.panelWidth,
    activeTerminalTab: sessionState.activeTerminalTab,
    autoCreateTabOnOpen,
    activeTerminalTabKey: sessionState.activeTerminalTabKey,
    closeTerminalTab: sessionState.closeTerminalTab,
    clearTerminalTab: sessionState.clearTerminalTab,
    restartTerminalTab: sessionState.restartTerminalTab,
    handleResizePointerDown: sizingState.handleResizePointerDown,
    isOpen: sizingState.isOpen,
    isResizing: sizingState.isResizing,
    openTerminalTab: sessionState.openTerminalTab,
    onClose,
    panelHeight: sizingState.panelHeight,
    panelRef: sizingState.panelRef,
    reorderTerminalTabs: sessionState.reorderTerminalTabs,
    selectTerminalTab: sessionState.selectTerminalTab,
    terminalHostRef: sessionState.terminalHostRef,
    terminalTabs: sessionState.terminalTabs,
    isFullScreen,
    onFullScreenChange,
  };
}
