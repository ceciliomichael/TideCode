import type { RefObject } from "react";
import type { TerminalTabState, WorkspaceTerminalPanelProps } from "./workspaceTerminalPanelTypes";

export interface TerminalWorkspaceState {
  activeTerminalTabKey: string | null;
  nextTabIndex: number;
  terminalTabs: TerminalTabState[];
}

export interface UseWorkspaceTerminalSessionStateArgs
  extends Pick<
    WorkspaceTerminalPanelProps,
    "isOpen" | "onClose" | "resolvedTheme" | "workspaceKey" | "workspacePath"
  > {
  isResizing: boolean;
}

export interface WorkspaceTerminalSessionState {
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
