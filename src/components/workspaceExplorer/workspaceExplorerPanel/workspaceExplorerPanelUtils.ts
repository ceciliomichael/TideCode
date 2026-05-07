import type { CSSProperties } from 'react'
import type {
  WorkspaceExplorerContextMenuDimensions,
  WorkspaceExplorerContextMenuState,
} from './workspaceExplorerPanelTypes'

export const ROOT_DIRECTORY_KEY = '.'

export function normalizeEntryPath(relativePath: string) {
  return relativePath.replace(/\\/g, '/')
}

export function toDirectoryKey(relativePath: string | undefined) {
  const normalized = normalizeEntryPath((relativePath ?? ROOT_DIRECTORY_KEY).trim())
    .replace(/^\.\/+/u, '')
    .replace(/\/+$/u, '')
  return normalized.length === 0 ? ROOT_DIRECTORY_KEY : normalized
}

export function isPathWithinTarget(relativePath: string, targetPath: string) {
  const normalizedRelativePath = normalizeEntryPath(relativePath)
  const normalizedTargetPath = normalizeEntryPath(targetPath)
  return normalizedRelativePath === normalizedTargetPath || normalizedRelativePath.startsWith(`${normalizedTargetPath}/`)
}

export function joinRelativePath(parentPath: string, childName: string) {
  const normalizedParentPath = normalizeEntryPath(parentPath).replace(/^\.\/+/u, '').replace(/\/+$/u, '')
  const normalizedChildName = normalizeEntryPath(childName).replace(/^\/+/u, '').replace(/\/+$/u, '')
  if (normalizedParentPath === '' || normalizedParentPath === ROOT_DIRECTORY_KEY) {
    return normalizedChildName
  }
  return `${normalizedParentPath}/${normalizedChildName}`
}

export function getAncestorDirectoryPaths(relativePath: string) {
  const normalizedPath = normalizeEntryPath(relativePath).replace(/^\.\/+/u, '').replace(/\/+$/u, '')
  const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0)
  if (pathSegments.length <= 1) {
    return []
  }

  const ancestorPaths: string[] = []
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    ancestorPaths.push(pathSegments.slice(0, index + 1).join('/'))
  }

  return ancestorPaths
}

interface ActiveFileAncestorSyncState {
  activeFilePath: string | null
  activeWorkspacePath: string | null
  lastSyncedFilePath: string | null
  lastSyncedWorkspacePath: string | null
}

export function shouldSyncActiveFileAncestors({
  activeFilePath,
  activeWorkspacePath,
  lastSyncedFilePath,
  lastSyncedWorkspacePath,
}: ActiveFileAncestorSyncState) {
  const nextWorkspacePath = activeWorkspacePath?.trim() ?? ''
  const nextFilePath = activeFilePath?.trim() ?? ''
  if (nextWorkspacePath.length === 0 || nextFilePath.length === 0) {
    return false
  }

  const previousWorkspacePath = lastSyncedWorkspacePath?.trim() ?? ''
  const previousFilePath = lastSyncedFilePath?.trim() ?? ''
  return nextWorkspacePath !== previousWorkspacePath || nextFilePath !== previousFilePath
}

export function getWorkspaceExplorerContextMenuStyle(
  contextMenuState: WorkspaceExplorerContextMenuState | null,
  viewportSize: {
    width: number
    height: number
  },
  menuDimensions: WorkspaceExplorerContextMenuDimensions | null,
): CSSProperties {
  if (!contextMenuState) {
    return {
      left: 0,
      top: 0,
      visibility: 'hidden',
    }
  }

  const fallbackMenuWidth = 210
  const fallbackMenuHeight = 280
  const menuWidth = menuDimensions?.width ?? fallbackMenuWidth
  const menuHeight = menuDimensions?.height ?? fallbackMenuHeight
  const viewportPadding = 8
  const left = Math.min(contextMenuState.position.x, viewportSize.width - menuWidth - viewportPadding)
  const top = Math.min(contextMenuState.position.y, viewportSize.height - menuHeight - viewportPadding)

  return {
    left: Math.max(left, viewportPadding),
    top: Math.max(top, viewportPadding),
    maxHeight: `${Math.max(viewportSize.height - viewportPadding * 2, 0)}px`,
    overflowY: 'auto',
    visibility: 'visible',
  }
}
