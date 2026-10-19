import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceTerminalPanelView } from '../../src/components/chat/workspaceTerminalPanel/WorkspaceTerminalPanelView'
import type { TerminalTabState, WorkspaceTerminalPanelState } from '../../src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelTypes'

test('terminal restart keeps its header slot when connecting or empty and is enabled for restartable sessions', () => {
  for (const status of [null, 'connecting', 'ready', 'exited', 'error'] as const) {
    let tab: TerminalTabState | null = null
    if (status) {
      tab = {
        key: 'terminal-1', label: 'Terminal 1', status,
        errorMessage: null, exitCode: null, sessionId: null, workspaceRootPath: null,
      }
    }
    const noop = () => {}
    const panelState: WorkspaceTerminalPanelState = {
      activeTerminalTab: tab,
      activeTerminalTabKey: tab?.key ?? null,
      terminalTabs: tab ? [tab] : [],
      autoCreateTabOnOpen: false,
      isOpen: true,
      isResizing: false,
      panelHeight: 240,
      panelRef: { current: null },
      terminalHostRef: { current: null },
      closeTerminalTab: noop,
      clearTerminalTab: noop,
      restartTerminalTab: noop,
      handleResizePointerDown: noop,
      openTerminalTab: noop,
      onClose: noop,
      reorderTerminalTabs: noop,
      selectTerminalTab: noop,
    }
    const markup = renderToStaticMarkup(createElement(WorkspaceTerminalPanelView, { panelState }))
    const restartButton = markup.match(/<button[^>]*aria-label="Restart active terminal"[^>]*>/u)?.[0]
    assert.ok(restartButton, `restart remains visible for ${status ?? 'no tab'}`)
    assert.equal(restartButton.includes('disabled=""'), status === null || status === 'connecting')
  }
})
