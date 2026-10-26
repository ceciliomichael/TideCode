import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents } from 'electron'
import type { AgentBrowserTab } from '../../electron/browser/agentTabs'
import { withBrowserTabAccess } from '../../electron/browser/agentTabAccess'

function tab(kind: 'visible' | 'agent'): AgentBrowserTab {
  return {
    id: `${kind}-tab`, projectPath: 'C:/workspace', kind,
    createdByAgent: kind === 'agent', ownerId: 7,
    contents: { getURL: () => 'https://example.test/' } as WebContents,
  }
}

test('user-owned and AI-owned browser tabs both allow operations without grants', async () => {
  for (const kind of ['visible', 'agent'] as const) {
    const result = await withBrowserTabAccess(tab(kind), undefined, async () => 'accessible')
    assert.equal(result, 'accessible')
  }
})

test('run cancellation applies equally to both tab ownership kinds', async () => {
  for (const kind of ['visible', 'agent'] as const) {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      withBrowserTabAccess(tab(kind), controller.signal, async () => 'unexpected'),
      /cancelled/u,
    )
  }
})
