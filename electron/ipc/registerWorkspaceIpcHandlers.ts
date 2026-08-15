import { clipboard, ipcMain } from 'electron'
import type {
  CreateWorkspaceCheckpointInput,
  WorkspaceExplorerCreateEntryInput,
  WorkspaceExplorerDeleteEntryInput,
  WorkspaceExplorerImportEntryInput,
  WorkspaceExplorerListDirectoryInput,
  WorkspaceExplorerPasteClipboardImageInput,
  WorkspaceExplorerReadFileInput,
  WorkspaceExplorerRenameEntryInput,
  WorkspaceExplorerTransferEntryInput,
  WorkspaceExplorerWatchChangesInput,
  WorkspaceExplorerWriteFileInput,
  WorkspaceRefactorCandidatesInput,
} from '../../src/types/chat'
import {
  createWorkspaceCheckpoint,
  createWorkspaceRedoCheckpointFromSource,
  createWorkspaceRedoCheckpointFromSources,
  restoreWorkspaceCheckpoint,
  restoreWorkspaceCheckpointSequence,
} from '../workspace/checkpoints'
import {
  subscribeWorkspaceExplorerChanges,
  unsubscribeWorkspaceExplorerChanges,
  updateWorkspaceExplorerWatchPaths,
} from '../workspace/explorerWatch'
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  importWorkspaceEntry,
  listWorkspaceDirectory,
  listWorkspaceRefactorCandidates,
  readWorkspaceFile,
  renameWorkspaceEntry,
  transferWorkspaceEntry,
  writeWorkspaceFile,
} from '../workspace/explorer'
import { windowsClipboard } from '../clipboard/windowsClipboardReader'
import { readClipboardFilesDirect } from '../clipboard/windowsDropFilesParser'
import { writeClipboardImageToWorkspace } from '../workspace/clipboardImage'

export function registerWorkspaceIpcHandlers() {
  ipcMain.handle('workspace:checkpoint:create', async (_event, input: CreateWorkspaceCheckpointInput) =>
    createWorkspaceCheckpoint(input),
  )
  ipcMain.handle('workspace:checkpoint:restore', async (_event, checkpointId: string) =>
    restoreWorkspaceCheckpoint(checkpointId),
  )
  ipcMain.handle('workspace:checkpoint:createRedoFromSource', async (_event, sourceCheckpointId: string) =>
    createWorkspaceRedoCheckpointFromSource(sourceCheckpointId),
  )
  ipcMain.handle('workspace:checkpoint:createRedoFromSources', async (_event, sourceCheckpointIds: string[]) =>
    createWorkspaceRedoCheckpointFromSources(sourceCheckpointIds),
  )
  ipcMain.handle('workspace:checkpoint:restoreSequence', async (_event, checkpointIds: string[]) =>
    restoreWorkspaceCheckpointSequence(checkpointIds),
  )
  ipcMain.handle('workspace:explorer:watch', async (event, input: WorkspaceExplorerWatchChangesInput) =>
    subscribeWorkspaceExplorerChanges(event.sender, input.workspaceRootPath, input.relativeDirectoryPaths),
  )
  ipcMain.handle('workspace:explorer:updateWatchPaths', async (event, input: WorkspaceExplorerWatchChangesInput) =>
    updateWorkspaceExplorerWatchPaths(event.sender.id, input.workspaceRootPath, input.relativeDirectoryPaths),
  )
  ipcMain.handle('workspace:explorer:unwatch', async (event, input: WorkspaceExplorerWatchChangesInput) =>
    unsubscribeWorkspaceExplorerChanges(event.sender.id, input.workspaceRootPath),
  )
  ipcMain.handle('workspace:explorer:listDirectory', async (_event, input: WorkspaceExplorerListDirectoryInput) =>
    listWorkspaceDirectory(input),
  )
  ipcMain.handle('workspace:refactorCandidates:list', async (_event, input: WorkspaceRefactorCandidatesInput) =>
    listWorkspaceRefactorCandidates(input),
  )
  ipcMain.handle('workspace:explorer:readFile', async (_event, input: WorkspaceExplorerReadFileInput) =>
    readWorkspaceFile(input),
  )
  ipcMain.handle('workspace:explorer:writeFile', async (_event, input: WorkspaceExplorerWriteFileInput) =>
    writeWorkspaceFile(input),
  )
  ipcMain.handle('workspace:explorer:createEntry', async (_event, input: WorkspaceExplorerCreateEntryInput) =>
    createWorkspaceEntry(input),
  )
  ipcMain.handle('workspace:explorer:renameEntry', async (_event, input: WorkspaceExplorerRenameEntryInput) =>
    renameWorkspaceEntry(input),
  )
  ipcMain.handle('workspace:explorer:deleteEntry', async (_event, input: WorkspaceExplorerDeleteEntryInput) =>
    deleteWorkspaceEntry(input),
  )
  ipcMain.handle('workspace:explorer:transferEntry', async (_event, input: WorkspaceExplorerTransferEntryInput) =>
    transferWorkspaceEntry(input),
  )
  ipcMain.handle('workspace:explorer:importEntry', async (_event, input: WorkspaceExplorerImportEntryInput) =>
    importWorkspaceEntry(input),
  )
  ipcMain.handle(
    'workspace:explorer:pasteClipboardImage',
    async (_event, input: WorkspaceExplorerPasteClipboardImageInput) => {
      const image = clipboard.readImage()
      if (image.isEmpty()) {
        return null
      }

      return writeClipboardImageToWorkspace(input, image.toPNG())
    },
  )
  ipcMain.handle('clipboard:readFiles', async () => {
    // 1. Direct memory binary reading (< 1ms)
    try {
      const directPaths = readClipboardFilesDirect(clipboard)
      if (directPaths.length > 0) {
        return directPaths
      }
    } catch (directError) {
      console.warn('Direct clipboard extraction failed, trying fallbacks:', directError)
    }

    // 2. Windows-specific fallback if direct buffers were not populated
    if (process.platform === 'win32') {
      if (clipboard.has('FileNameW') || clipboard.has('FileName')) {
        try {
          const paths = await windowsClipboard.readFiles()
          if (paths && paths.length > 0) {
            return paths
          }
        } catch (e) {
          console.error('Failed to read files from persistent clipboard reader', e)
        }
      }
    }

    const uriList = clipboard.read('text/uri-list')
    if (uriList && uriList.trim().length > 0) {
      const paths = uriList
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('file://'))
        .map((line) => decodeURIComponent(line.replace(/^file:\/\//, '')))
        .filter((filePath) => filePath.length > 0)

      if (paths.length > 0) {
        return paths
      }
    }

    if (process.platform === 'darwin') {
      const url = clipboard.read('public.file-url')
      if (url && url.startsWith('file://')) {
        return [decodeURIComponent(url.replace(/^file:\/\//, ''))]
      }
    }

    return []
  })
}
