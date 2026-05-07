import type { WorkspaceClipboardEntry } from '../../components/workspaceExplorer/workspaceClipboardTypes'
import type {
  WorkspaceExplorerImportEntryInput,
  WorkspaceExplorerTransferEntryInput,
} from '../../types/chat'
import { normalizeWorkspaceRelativePath } from './chatWorkspaceUiState.utils'

export type WorkspaceClipboardPasteInput =
  | {
      kind: 'import'
      input: WorkspaceExplorerImportEntryInput
    }
  | {
      kind: 'transfer'
      input: WorkspaceExplorerTransferEntryInput
    }

function uniqueRelativePaths(relativePaths: readonly string[]) {
  return Array.from(
    new Set(
      relativePaths
        .map((relativePath) => relativePath.trim())
        .filter((relativePath) => relativePath.length > 0),
    ),
  )
}

export function normalizeWorkspaceRootPath(workspaceRootPath: string) {
  const normalizedRootPath = workspaceRootPath.trim().replace(/\\/g, '/')
  if (normalizedRootPath === '/') {
    return normalizedRootPath
  }

  return normalizedRootPath.replace(/\/+$/u, '')
}

function joinWorkspacePaths(basePath: string, relativePath: string) {
  const normalizedBasePath = normalizeWorkspaceRootPath(basePath)
  const normalizedRelativePath = normalizeWorkspaceRelativePath(relativePath).trim().replace(/^\/+/u, '')

  if (normalizedBasePath.length === 0) {
    return normalizedRelativePath
  }

  if (normalizedBasePath === '/') {
    return `/${normalizedRelativePath}`
  }

  return `${normalizedBasePath}/${normalizedRelativePath}`
}

export function createWorkspaceClipboardEntry({
  mode,
  relativePaths,
  sourceWorkspaceRootPath,
}: {
  mode: WorkspaceClipboardEntry['mode']
  relativePaths: readonly string[]
  sourceWorkspaceRootPath: string
}): WorkspaceClipboardEntry {
  return {
    mode,
    relativePaths: uniqueRelativePaths(relativePaths),
    sourceWorkspaceRootPath: sourceWorkspaceRootPath.trim(),
  }
}

export function shouldClearWorkspaceClipboardByPathPrefix({
  clipboard,
  targetPath,
  workspaceRootPath,
}: {
  clipboard: WorkspaceClipboardEntry | null
  targetPath: string
  workspaceRootPath: string | null
}) {
  if (!clipboard || !workspaceRootPath) {
    return false
  }

  if (
    normalizeWorkspaceRootPath(clipboard.sourceWorkspaceRootPath) !==
    normalizeWorkspaceRootPath(workspaceRootPath)
  ) {
    return false
  }

  const normalizedTargetPath = normalizeWorkspaceRelativePath(targetPath)
  return clipboard.relativePaths.some((relativePath) => {
    const normalizedRelativePath = normalizeWorkspaceRelativePath(relativePath)
    return normalizedRelativePath === normalizedTargetPath || normalizedRelativePath.startsWith(`${normalizedTargetPath}/`)
  })
}

export function resolveWorkspaceClipboardPasteInputs({
  clipboard,
  targetDirectoryRelativePath,
  workspaceRootPath,
}: {
  clipboard: WorkspaceClipboardEntry
  targetDirectoryRelativePath: string
  workspaceRootPath: string
}): WorkspaceClipboardPasteInput[] {
  const relativePaths = uniqueRelativePaths(clipboard.relativePaths)

  if (
    normalizeWorkspaceRootPath(clipboard.sourceWorkspaceRootPath) ===
    normalizeWorkspaceRootPath(workspaceRootPath)
  ) {
    return relativePaths.map((relativePath) => ({
      kind: 'transfer' as const,
      input: {
        mode: clipboard.mode === 'cut' ? 'move' : 'copy',
        relativePath,
        targetDirectoryRelativePath,
        workspaceRootPath,
      },
    }))
  }

  if (clipboard.mode === 'cut') {
    throw new Error('Cannot paste a cut entry into a different project.')
  }

  return relativePaths.map((relativePath) => ({
    kind: 'import' as const,
    input: {
      sourcePath: joinWorkspacePaths(clipboard.sourceWorkspaceRootPath, relativePath),
      targetDirectoryRelativePath,
      workspaceRootPath,
    },
  }))
}
