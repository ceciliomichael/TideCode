import { DEFAULT_TERMINAL_WORKSPACE_KEY } from "./chatWorkspaceUiState.types";

export function toWorkspaceScopedKey(workspacePath: string | null) {
  const normalizedPath = workspacePath?.trim() ?? "";
  if (normalizedPath.length === 0) {
    return DEFAULT_TERMINAL_WORKSPACE_KEY;
  }

  return normalizedPath;
}

interface TerminalWorkspaceKeyInput {
  activeConversationId: string | null;
  activeWorkspacePath: string | null;
  selectedFolderId?: string | null;
}

export function getTerminalWorkspaceKey({
  activeConversationId,
  activeWorkspacePath,
}: TerminalWorkspaceKeyInput) {
  const workspaceKey = toWorkspaceScopedKey(activeWorkspacePath);

  if (workspaceKey !== DEFAULT_TERMINAL_WORKSPACE_KEY) {
    return workspaceKey;
  }

  if (activeConversationId) {
    return `chats:${activeConversationId}`;
  }

  return workspaceKey;
}

export function normalizeWorkspaceRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, "/");
}

export function isWorkspacePathWithinTarget(
  entryPath: string,
  targetPath: string,
) {
  const normalizedEntryPath = normalizeWorkspaceRelativePath(entryPath);
  const normalizedTargetPath = normalizeWorkspaceRelativePath(targetPath);
  return (
    normalizedEntryPath === normalizedTargetPath ||
    normalizedEntryPath.startsWith(`${normalizedTargetPath}/`)
  );
}
