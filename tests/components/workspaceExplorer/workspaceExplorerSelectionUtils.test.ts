import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceExplorerEntry } from '../../../src/types/chat'
import { ROOT_DIRECTORY_KEY } from '../../../src/components/workspaceExplorer/workspaceExplorerPanel/workspaceExplorerPanelUtils'
import { resolvePasteTargetDirectoryPath } from '../../../src/components/workspaceExplorer/workspaceExplorerPanel/workspaceExplorerSelectionUtils'

function createEntry(relativePath: string, isDirectory: boolean): WorkspaceExplorerEntry {
  return {
    relativePath,
    isDirectory,
    name: relativePath.split('/').pop() ?? relativePath,
  }
}

const rootEntries: WorkspaceExplorerEntry[] = [
  createEntry('file1.txt', false),
  createEntry('folder1', true),
  createEntry('folder2', true),
]

const directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]> = {
  folder1: [
    createEntry('folder1/file1.txt', false),
    createEntry('folder1/subfolder', true),
  ],
  folder2: [
    createEntry('folder2/file2.txt', false),
  ],
}

test('paste target is the selected directory when a single directory is selected', () => {
  assert.equal(
    resolvePasteTargetDirectoryPath({
      directoryEntriesByPath,
      rootEntries,
      selectedEntryPaths: new Set(['folder1']),
      selectionDirectoryPath: ROOT_DIRECTORY_KEY,
    }),
    'folder1',
  )
})

test('paste target is the parent directory when a single file inside a folder is selected', () => {
  assert.equal(
    resolvePasteTargetDirectoryPath({
      directoryEntriesByPath,
      rootEntries,
      selectedEntryPaths: new Set(['folder1/file1.txt']),
      selectionDirectoryPath: 'folder1',
    }),
    'folder1',
  )
})

test('paste target is the root when a single file at the root is selected', () => {
  assert.equal(
    resolvePasteTargetDirectoryPath({
      directoryEntriesByPath,
      rootEntries,
      selectedEntryPaths: new Set(['file1.txt']),
      selectionDirectoryPath: ROOT_DIRECTORY_KEY,
    }),
    ROOT_DIRECTORY_KEY,
  )
})

test('paste target falls back to the selection directory for multiple selected entries', () => {
  assert.equal(
    resolvePasteTargetDirectoryPath({
      directoryEntriesByPath,
      rootEntries,
      selectedEntryPaths: new Set(['folder1/file1.txt', 'folder1/subfolder']),
      selectionDirectoryPath: 'folder1',
    }),
    'folder1',
  )
})

test('paste target is the selection directory when nothing is selected', () => {
  assert.equal(
    resolvePasteTargetDirectoryPath({
      directoryEntriesByPath,
      rootEntries,
      selectedEntryPaths: new Set(),
      selectionDirectoryPath: ROOT_DIRECTORY_KEY,
    }),
    ROOT_DIRECTORY_KEY,
  )

  assert.equal(
    resolvePasteTargetDirectoryPath({
      directoryEntriesByPath,
      rootEntries,
      selectedEntryPaths: new Set(),
      selectionDirectoryPath: 'folder2',
    }),
    'folder2',
  )
})

test('paste target falls back to the selection directory when the selected directory is not loaded', () => {
  assert.equal(
    resolvePasteTargetDirectoryPath({
      directoryEntriesByPath,
      rootEntries,
      selectedEntryPaths: new Set(['folder1/not-loaded-dir']),
      selectionDirectoryPath: 'folder1',
    }),
    'folder1',
  )
})
