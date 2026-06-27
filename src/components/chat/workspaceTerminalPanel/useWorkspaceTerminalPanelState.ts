import type {
  WorkspaceTerminalPanelProps,
  WorkspaceTerminalPanelState,
} from "./workspaceTerminalPanelTypes";
import { useWorkspaceTerminalPanelSizing } from "./useWorkspaceTerminalPanelSizing";
import { useWorkspaceTerminalSessionState } from "./useWorkspaceTerminalSessionState";

export function useWorkspaceTerminalPanelState({
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
    isOpen,
    onHeightCommit,
    storedHeight,
  });
  const sessionState = useWorkspaceTerminalSessionState({
    isOpen,
    isResizing: sizingState.isResizing,
    onClose,
    resolvedTheme,
    workspaceKey,
    workspacePath,
  });

  return {
    activeTerminalTab: sessionState.activeTerminalTab,
    activeTerminalTabKey: sessionState.activeTerminalTabKey,
    closeTerminalTab: sessionState.closeTerminalTab,
    handleResizePointerDown: sizingState.handleResizePointerDown,
    isOpen: sizingState.isOpen,
    isResizing: sizingState.isResizing,
    openTerminalTab: sessionState.openTerminalTab,
    onClose,
    panelHeight: sizingState.panelHeight,
    panelRef: sizingState.panelRef,
    selectTerminalTab: sessionState.selectTerminalTab,
    terminalHostRef: sessionState.terminalHostRef,
    terminalTabs: sessionState.terminalTabs,
    isFullScreen,
    onFullScreenChange,
  };
}
