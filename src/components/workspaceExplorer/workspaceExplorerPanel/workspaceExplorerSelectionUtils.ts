import type { WorkspaceExplorerEntry } from '../../../types/chat'
import { getPathDirname } from '../../../lib/pathPresentation'
import { ROOT_DIRECTORY_KEY, normalizeEntryPath, toDirectoryKey } from './workspaceExplorerPanelUtils'

export function getSelectionDirectoryPath(entry: WorkspaceExplorerEntry) {
  return toDirectoryKey(getPathDirname(entry.relativePath))
}

export function getDirectoryEntriesForSelection(
  directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]>,
  rootEntries: WorkspaceExplorerEntry[],
  directoryPath: string,
) {
  return directoryPath === ROOT_DIRECTORY_KEY ? rootEntries : directoryEntriesByPath[directoryPath] ?? []
}

export function collectLoadedExplorerEntryPaths(
  entries: readonly WorkspaceExplorerEntry[],
  directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]>,
) {
  const relativePaths: string[] = []

  for (const entry of entries) {
    relativePaths.push(entry.relativePath)
    if (!entry.isDirectory) {
      continue
    }

    relativePaths.push(
      ...collectLoadedExplorerEntryPaths(
        directoryEntriesByPath[normalizeEntryPath(entry.relativePath)] ?? [],
        directoryEntriesByPath,
      ),
    )
  }

  return relativePaths
}

export function findLoadedExplorerEntry(
  entries: readonly WorkspaceExplorerEntry[],
  directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]>,
  relativePath: string,
): WorkspaceExplorerEntry | null {
  for (const entry of entries) {
    if (entry.relativePath === relativePath) {
      return entry
    }

    if (!entry.isDirectory) {
      continue
    }

    const nestedEntry = findLoadedExplorerEntry(
      directoryEntriesByPath[normalizeEntryPath(entry.relativePath)] ?? [],
      directoryEntriesByPath,
      relativePath,
    )
    if (nestedEntry) {
      return nestedEntry
    }
  }

  return null
}

export function isTreeShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return !target.matches('input, textarea, [contenteditable="true"]')
}

export function resolvePasteTargetDirectoryPath({
  directoryEntriesByPath,
  rootEntries,
  selectedEntryPaths,
  selectionDirectoryPath,
}: {
  directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]>
  rootEntries: WorkspaceExplorerEntry[]
  selectedEntryPaths: Set<string>
  selectionDirectoryPath: string
}) {
  if (selectedEntryPaths.size !== 1) {
    return selectionDirectoryPath
  }

  const selectedPath = Array.from(selectedEntryPaths)[0]
  const selectedEntry = findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, selectedPath)
  if (!selectedEntry?.isDirectory) {
    return selectionDirectoryPath
  }

  return toDirectoryKey(selectedEntry.relativePath)
}
