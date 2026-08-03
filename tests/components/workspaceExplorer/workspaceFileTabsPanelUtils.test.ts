import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceFileTab } from '../../../src/components/workspaceExplorer/types'
import { findWorkspaceTabByKey } from '../../../src/components/workspaceExplorer/workspaceFileTabsPanel/workspaceFileTabsPanelUtils'

const nestedFileTab: WorkspaceFileTab = {
  kind: 'file',
  tabKey: 'daily\\daily-update-2026-08-04.md',
  content: '',
  originalContent: '',
  fileName: 'daily-update-2026-08-04.md',
  isBinary: false,
  isTruncated: false,
  relativePath: 'daily\\daily-update-2026-08-04.md',
  sizeBytes: 0,
  status: 'ready',
}

test('workspace tabs match active keys across Windows and web path separators', () => {
  assert.equal(
    findWorkspaceTabByKey([nestedFileTab], 'daily/daily-update-2026-08-04.md'),
    nestedFileTab,
  )
})

test('workspace tab lookup returns null when no active key is selected', () => {
  assert.equal(findWorkspaceTabByKey([nestedFileTab], null), null)
})
