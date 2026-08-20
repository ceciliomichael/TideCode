import assert from 'node:assert/strict'
import test from 'node:test'
import { formatWorkspaceMonacoModuleTooltipDisplayText } from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoTypeScriptHover'

test('module tooltip preserves module text while replacing workspace URI with quoted relative path', () => {
  assert.equal(
    formatWorkspaceMonacoModuleTooltipDisplayText(
      'module "file:///workspace/src/components/panel"',
      "'./components/panel'",
    ),
    "module './components/panel'",
  )
})

test('module tooltip falls back to module plus quoted relative path', () => {
  assert.equal(
    formatWorkspaceMonacoModuleTooltipDisplayText('', '"../shared/runtime"'),
    'module "../shared/runtime"',
  )
})
