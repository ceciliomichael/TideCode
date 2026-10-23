import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import type { useChatWorkspacePanelActions } from '../../src/pages/chatInterface/useChatWorkspacePanelActions'

// The action hook uses only useCallback. Execute its real callbacks directly.
const compiled = await build({
  entryPoints: ['src/pages/chatInterface/useChatWorkspacePanelActions.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
})
const actionModule = { exports: {} as { useChatWorkspacePanelActions: typeof useChatWorkspacePanelActions } }
const require = createRequire(import.meta.url)
vm.runInThisContext(`(function(module, require) { ${compiled.outputFiles[0].text}\n })`)(actionModule, (name: string) => {
  if (name === 'react') {
    return { useCallback: (callback: unknown) => callback }
  }
  return require(name)
})

function createActions(overrides: Partial<Parameters<typeof useChatWorkspacePanelActions>[0]> = {}) {
  const calls: Array<[string, boolean]> = []
  const state = { explorer: false, terminal: true, sidebar: true, tabs: false, rightPanel: true }
  function setter(key: keyof typeof state) {
    return (next: unknown) => {
      assert.equal(typeof next, 'boolean', 'panel actions must not defer other state changes into an updater')
      state[key] = next as boolean
      calls.push([key, next as boolean])
    }
  }
  const noop = () => {}
  const input: Parameters<typeof useChatWorkspacePanelActions>[0] = {
    isExplorerOpen: false, isRightPanelOpen: true, isSidebarOpen: true,
    isWorkspaceTabsPanelVisible: false, rightPanelTab: 'diff', terminalPanelPosition: 'right',
    onDiffPanelWidthChange: noop, onDiffPanelWidthCommit: noop, onRightPanelOpenChange: setter('rightPanel'),
    onRightPanelTabChange: noop, onUpdateSettings: async () => null,
    setConversationDiffPanelWidth: noop, setIsExplorerOpen: setter('explorer'),
    setIsSidebarOpen: setter('sidebar'), setIsTerminalFullScreen: noop, setIsTerminalOpen: setter('terminal'),
    setIsWorkspaceTabsPanelVisible: setter('tabs'), setWorkspaceExplorerWidth: noop,
    settings: {} as Parameters<typeof useChatWorkspacePanelActions>[0]['settings'],
    sidebarPanelRestoreRef: { current: null }, workspaceFileTabCount: 1,
    ...overrides,
  }
  return { actions: actionModule.exports.useChatWorkspacePanelActions(input), calls, state }
}

test('opening Explorer hides the right terminal in the same event before opening Explorer', () => {
  const { actions, calls, state } = createActions()
  actions.handleToggleExplorerPanel()
  assert.deepEqual(state, { explorer: true, terminal: false, sidebar: false, tabs: true, rightPanel: false })
  assert(calls.findIndex(([key]) => key === 'terminal') < calls.findIndex(([key]) => key === 'explorer'))
})

test('opening Explorer preserves a bottom terminal and does not toggle an already collapsed sidebar', () => {
  const { actions, calls } = createActions({ terminalPanelPosition: 'bottom', isSidebarOpen: false })
  actions.handleToggleExplorerPanel()
  assert.deepEqual(calls, [['tabs', true], ['rightPanel', false], ['explorer', true]])
})

test('closing Explorer restores the sidebar and hides editor tabs without changing terminal state', () => {
  const { actions, calls } = createActions({ isExplorerOpen: true, isSidebarOpen: false })
  actions.handleToggleExplorerPanel()
  assert.deepEqual(calls, [['sidebar', true], ['tabs', false], ['explorer', false]])
})
