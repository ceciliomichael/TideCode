import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldSyncActiveFileAncestors } from '../../../src/components/workspaceExplorer/workspaceExplorerPanel/workspaceExplorerPanelUtils'

test('active file ancestor sync skips repeated syncs for the same workspace file', () => {
  assert.equal(
    shouldSyncActiveFileAncestors({
      activeFilePath: 'src/components/App.tsx',
      activeWorkspacePath: '/projects/atlas',
      lastSyncedFilePath: 'src/components/App.tsx',
      lastSyncedWorkspacePath: '/projects/atlas',
    }),
    false,
  )
})

test('active file ancestor sync runs when the workspace or file changes', () => {
  assert.equal(
    shouldSyncActiveFileAncestors({
      activeFilePath: 'src/components/Sidebar.tsx',
      activeWorkspacePath: '/projects/atlas',
      lastSyncedFilePath: 'src/components/App.tsx',
      lastSyncedWorkspacePath: '/projects/atlas',
    }),
    true,
  )

  assert.equal(
    shouldSyncActiveFileAncestors({
      activeFilePath: 'src/components/App.tsx',
      activeWorkspacePath: '/projects/beta',
      lastSyncedFilePath: 'src/components/App.tsx',
      lastSyncedWorkspacePath: '/projects/atlas',
    }),
    true,
  )
})

test('active file ancestor sync ignores empty workspace or file paths', () => {
  assert.equal(
    shouldSyncActiveFileAncestors({
      activeFilePath: 'src/components/App.tsx',
      activeWorkspacePath: '   ',
      lastSyncedFilePath: null,
      lastSyncedWorkspacePath: null,
    }),
    false,
  )

  assert.equal(
    shouldSyncActiveFileAncestors({
      activeFilePath: null,
      activeWorkspacePath: '/projects/atlas',
      lastSyncedFilePath: null,
      lastSyncedWorkspacePath: null,
    }),
    false,
  )
})
