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
        brokerSessionId: null, key: 'terminal-1', label: 'Terminal 1', status,
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


test('terminal docking changes the action and resize axis while preserving tab content', () => {
  const noop = () => {}
  const tab: TerminalTabState = {
    brokerSessionId: 'running-shell', key: 'terminal-1', label: 'Running server', status: 'ready',
    errorMessage: null, exitCode: null, sessionId: 1, workspaceRootPath: null,
  }
  const state: WorkspaceTerminalPanelState = {
    activeTerminalTab: tab, activeTerminalTabKey: tab.key, terminalTabs: [tab],
    autoCreateTabOnOpen: false, isOpen: true, isResizing: false, panelHeight: 240, panelWidth: 448,
    panelRef: { current: null }, terminalHostRef: { current: null }, closeTerminalTab: noop,
    clearTerminalTab: noop, restartTerminalTab: noop, handleResizePointerDown: noop, openTerminalTab: noop,
    onClose: noop, reorderTerminalTabs: noop, selectTerminalTab: noop, onPositionChange: noop, onFullScreenChange: noop,
  }
  for (const position of ['bottom', 'right'] as const) {
    const markup = renderToStaticMarkup(createElement(WorkspaceTerminalPanelView, { panelState: { ...state, position } }))
    assert.match(markup, /Running server/u)
    const dockingAction = markup.indexOf(`aria-label="Move panel ${position === 'right' ? 'bottom' : 'right'}"`)
    assert(dockingAction > markup.indexOf('aria-label="New terminal tab"'), 'docking action follows the new-terminal action')
    assert(dockingAction > markup.indexOf('aria-label="Full screen"'), 'docking action follows fullscreen at the right end')
    assert.match(markup, /data-terminal-tab-actions="true" class="relative z-10 -ml-px[^"]*border-l/u)
    if (position === 'right') {
      assert.match(markup, /aria-label="Move panel bottom"/u)
      assert.match(markup, /cursor-col-resize/u)
      assert.match(markup, /width:448px;height:100%/u)
    } else {
      assert.match(markup, /aria-label="Move panel right"/u)
      assert.match(markup, /cursor-row-resize/u)
      assert.match(markup, /width:100%;height:240px/u)
    }
  }
})
