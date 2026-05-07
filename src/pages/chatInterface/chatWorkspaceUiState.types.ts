import type { ChatInterfaceRightPanelTab } from "../../hooks/useChatInterfaceController";
import type { AppSettings } from "../../types/chat";
import type { WorkspaceTab } from "../../components/workspaceExplorer/types";
import type { WorkspaceClipboardEntry } from "../../components/workspaceExplorer/workspaceClipboardTypes";
export type { WorkspaceClipboardEntry } from "../../components/workspaceExplorer/workspaceClipboardTypes";

export const DEFAULT_TERMINAL_WORKSPACE_KEY = "__global__";

export interface WorkspaceUiSession {
  activeFilePath: string | null;
  activeTabKey: string | null;
  isExplorerOpen: boolean;
  isRightPanelOpen: boolean;
  isTabsVisible: boolean;
  rightPanelTab: ChatInterfaceRightPanelTab;
  tabs: WorkspaceTab[];
}

export interface UseChatWorkspaceUiStateInput {
  activeConversationId: string | null;
  activeWorkspacePath: string | null;
  diffPanelWidth: number;
  isRightPanelOpen: boolean;
  isSidebarOpen: boolean;
  onDiffPanelWidthChange: (nextWidth: number) => void;
  onDiffPanelWidthCommit: (nextWidth: number) => void;
  onRightPanelOpenChange: (nextValue: boolean) => void;
  onRightPanelTabChange: (nextTab: ChatInterfaceRightPanelTab) => void;
  onUpdateSettings: (
    input: Partial<AppSettings>,
  ) => Promise<AppSettings | null>;
  rightPanelTab: ChatInterfaceRightPanelTab;
  selectedFolderId: string | null;
  setIsSidebarOpen: (nextValue: boolean) => void;
  settings: AppSettings;
}

export interface ChatWorkspaceUiState {
  activeWorkspaceFilePath: string | null;
  activeTerminalWorkspaceKey: string;
  activeWorkspaceTabKey: string | null;
  activeWorkspacePath: string | null;
  conversationDiffPanelWidth: number;
  handleCloseWorkspaceTab: (relativePath: string) => void;
  handleConversationDiffPanelWidthChange: (nextWidth: number) => void;
  handleConversationDiffPanelWidthCommit: (nextWidth: number) => void;
  handleCopyWorkspaceEntry: (relativePaths: string[]) => Promise<void>;
  handleCreateWorkspaceEntry: (
    relativePath: string,
    isDirectory: boolean,
  ) => Promise<void>;
  handleCutWorkspaceEntry: (relativePaths: string[]) => Promise<void>;
  handleDeleteWorkspaceEntry: (relativePaths: string[]) => Promise<void>;
  handleImportWorkspaceEntry: (
    sourcePath: string,
    targetDirectoryRelativePath: string,
  ) => Promise<void>;
  handleMoveWorkspaceEntry: (
    relativePath: string,
    targetDirectoryRelativePath: string,
  ) => Promise<void>;
  handleOpenDiffPanel: () => void;
  handleOpenSourceControlPanel: () => void;
  handleOpenWorkspaceFile: (relativePath: string) => void;
  handleOpenWorkspaceMarkdownPreview: (relativePath: string) => void;
  handlePasteWorkspaceEntry: (
    targetDirectoryRelativePath: string,
  ) => Promise<void>;
  handleRefreshWorkspaceFileTabs: () => Promise<void>;
  handleRenameWorkspaceEntry: (
    relativePath: string,
    nextRelativePath: string,
  ) => Promise<void>;
  handleSelectWorkspaceTab: (relativePath: string) => void;
  handleSourceControlPanelWidthChange: (nextWidth: number) => void;
  handleSourceControlPanelWidthCommit: (nextWidth: number) => void;
  handleSidebarOpenChange: (nextSidebarOpen: boolean) => void;
  handleToggleExplorerPanel: () => void;
  handleWorkspaceEditorWidthChange: (nextWidth: number) => void;
  handleWorkspaceEditorWidthCommit: (nextWidth: number) => void;
  handleWorkspaceExplorerWidthChange: (nextWidth: number) => void;
  handleWorkspaceExplorerWidthCommit: (nextWidth: number) => void;
  handleWorkspaceFileContentChange: (
    relativePath: string,
    content: string,
  ) => void;
  isExplorerOpen: boolean;
  isTerminalOpen: boolean;
  isWorkspaceTabsPanelOpen: boolean;
  sourceControlPanelWidth: number;
  terminalPanelHeight: number;
  workspaceClipboard: WorkspaceClipboardEntry | null;
  workspaceEditorWidth: number;
  workspaceExplorerWidth: number;
  workspaceFileTabs: WorkspaceTab[];
}
