import '../configureAppRoot'
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { createBrowserToolSet } from '../../electron/chat/shared/tools/browserTools'
import { setRunServiceBrowserHandler } from '../../electron/runService/browserService'
import { navigateAgentPage, validateBrowserNavigation } from '../../electron/browser/agentPageNavigation'
import { validateBrowserInteraction } from '../../electron/browser/agentPageInput'
import { validateBrowserSequence } from '../../electron/browser/agentPageSequence'

function mockPage() {
  const emitter = new EventEmitter()
  let url = 'http://localhost:3000/'
  const contents = Object.assign(emitter, {
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => 'Settings',
    isLoading: () => false,
    loadURL: async (next: string) => {
      url = next
      queueMicrotask(() => { emitter.emit('did-navigate'); emitter.emit('dom-ready'); emitter.emit('did-finish-load') })
    },
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    reload: () => queueMicrotask(() => { emitter.emit('did-navigate'); emitter.emit('dom-ready'); emitter.emit('did-finish-load') }),
    stop: () => undefined,
  }) as unknown as WebContents
  return { contents, emitter }
}

test('navigate waits for a page milestone and records final URL', async () => {
  const { contents } = mockPage()
  const result = await navigateAgentPage(contents, { action: 'goto', url: 'http://localhost:3000/settings' })
  assert.equal(result.status, 'reached domcontentloaded')
  assert.equal(result.from, 'http://localhost:3000/')
  assert.equal(result.url, 'http://localhost:3000/settings')
})

test('navigation rejects invalid URLs, unsupported history and aborted work', async () => {
  assert.throws(() => validateBrowserNavigation({ action: 'goto', url: 'file:///etc/passwd' }), /URL|http|protocol/i)
  assert.throws(() => validateBrowserNavigation({ action: 'reload', url: 'http://localhost' }), /Only goto/)
  const { contents } = mockPage()
  await assert.rejects(navigateAgentPage(contents, { action: 'back' }), /cannot navigate backward/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(navigateAgentPage(contents, { action: 'reload' }, controller.signal), /cancelled/)
})

test('browser.interact and sequences reject navigation actions', () => {
  for (const action of ['navigate', 'back', 'forward', 'reload']) {
    assert.throws(() => validateBrowserInteraction({ action } as never), /Unknown browser interaction/)
    assert.throws(() => validateBrowserSequence([{ action }] as never), /Unknown browser interaction/)
  }
})

test('browser.navigate forwards the request and returns plain text', async () => {
  setRunServiceBrowserHandler(async (request) => {
    assert.equal(request.operation, 'navigate')
    if (request.operation !== 'navigate') throw new Error('wrong operation')
    assert.equal(request.input.wait_until, 'load')
    return { data: { action: 'goto', from: 'http://localhost:3000/', url: 'http://localhost:3000/settings', status: 'reached load', loading: false, title: 'Settings' } }
  })
  try {
    const tool = createBrowserToolSet({ workspaceRootPath: 'C:/navigate-test' })['browser.navigate']
    const result = await tool.execute!({ tab_id: 'tab-1', action: 'goto', url: 'http://localhost:3000/settings', wait_until: 'load' }, {} as never)
    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /From: http:\/\/localhost:3000\//)
    assert.match(result.body ?? '', /Status: reached load/)
    assert.doesNotMatch(result.body ?? '', /\| --- |## /)
  } finally {
    setRunServiceBrowserHandler(null)
  }
})
