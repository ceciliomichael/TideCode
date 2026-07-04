import type {
  RefObject,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { ResolvedTheme } from "../../../lib/theme";

export type TerminalTabStatus = "connecting" | "ready" | "error" | "exited";

export interface WorkspaceTerminalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onHeightCommit: (nextHeight: number) => void;
  resolvedTheme: ResolvedTheme;
  storedHeight: number;
  workspaceKey: string;
  workspacePath: string | null;
  isFullScreen?: boolean;
  onFullScreenChange?: (nextFullScreen: boolean) => void;
}

export interface TerminalTabState {
  errorMessage: string | null;
  exitCode: number | null;
  key: string;
  label: string;
  sessionId: number | null;
  status: TerminalTabStatus;
  workspaceRootPath: string | null;
}

export interface WorkspaceTerminalPanelState {
  activeTerminalTab: TerminalTabState | null;
  activeTerminalTabKey: string | null;
  closeTerminalTab: (tabKey: string) => void;
  clearTerminalTab: (tabKey: string) => void;
  restartTerminalTab: (tabKey: string) => void;
  handleResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  isOpen: boolean;
  isResizing: boolean;
  openTerminalTab: () => void;
  onClose: () => void;
  panelHeight: number;
  panelRef: RefObject<HTMLElement>;
  reorderTerminalTabs: (
    sourceTabKey: string,
    targetTabKey: string,
    position: "before" | "after",
  ) => void;
  selectTerminalTab: (tabKey: string) => void;
  terminalHostRef: RefObject<HTMLDivElement>;
  terminalTabs: readonly TerminalTabState[];
  isFullScreen?: boolean;
  onFullScreenChange?: (nextFullScreen: boolean) => void;
}
