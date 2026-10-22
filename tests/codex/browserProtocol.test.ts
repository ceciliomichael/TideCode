import '../configureAppRoot'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { WebContents } from 'electron'
import { AgentBrowserOperation } from '../../electron/browser/agentBrowserOperation'
import { withBrowserProtocol, type CdpSend } from '../../electron/browser/agentCdpSession'
import { registerVisibleBrowserTab, withAgentBrowserTab } from '../../electron/browser/agentTabs'

test('a stalled protocol command names its stage, detaches and releases the tab queue without replaying input', async () => {
  const events = new EventEmitter()
  const debuggerEvents = new EventEmitter()
  let attached = false
  let stalled = true
  let lateReject: ((reason: Error) => void) | undefined
  const commands: string[] = []
  const contents = Object.assign(events, {
    id: 820001,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    getURL: () => 'http://localhost/',
    debugger: Object.assign(debuggerEvents, {
      isAttached: () => attached,
      attach: () => { attached = true },
      detach: () => {
        attached = false
        debuggerEvents.emit('detach')
      },
      sendCommand: async (method: string) => {
        commands.push(method)
        if (method === 'Page.captureScreenshot' && stalled) {
          return new Promise((_resolve, reject) => { lateReject = reject })
        }
        return { method }
      },
    }),
  }) as unknown as WebContents
  const project = 'C:/browser-protocol-test'
  registerVisibleBrowserTab({ id: 'protocol-test', contents, ownerId: 1, projectPath: project })
  let oldSend: CdpSend | undefined
  try {
    const first = withAgentBrowserTab(project, 'protocol-test', () => withBrowserProtocol(contents, async (send) => {
      oldSend = send
      return send('Page.captureScreenshot')
    }, new AgentBrowserOperation(40)))
    const queued = withAgentBrowserTab(project, 'protocol-test', () => withBrowserProtocol(contents, (send) => send('DOM.getDocument')))
    await assert.rejects(first, /timed out during Page.captureScreenshot/)
    assert.deepEqual(await queued, { method: 'DOM.getDocument' })
    assert.ok(attached, 'the next operation attaches a fresh session')
    await assert.rejects(oldSend!('Input.dispatchMouseEvent'), /timed out during Page.captureScreenshot/)
    assert.ok(!commands.includes('Input.dispatchMouseEvent'), 'the expired operation cannot dispatch late input')
    lateReject?.(new Error('late protocol rejection'))
    stalled = false
    assert.deepEqual(await withBrowserProtocol(contents, (send) => send('Page.captureScreenshot')), { method: 'Page.captureScreenshot' })
    assert.equal(commands.filter((method) => method === 'Page.captureScreenshot').length, 2, 'no automatic screenshot or input replay')
  } finally {
    events.emit('destroyed')
  }
})

test('one operation shares its deadline across stages and names an expired stage before starting it', async () => {
  const operation = new AgentBrowserOperation(20)
  let stopped = false
  await assert.rejects(operation.run('prepare surface', () => new Promise(() => undefined), () => { stopped = true }), /prepare surface/)
  assert.ok(stopped)
  let laterStarted = false
  await assert.rejects(operation.run('click', async () => { laterStarted = true }, () => undefined), /prepare surface/)
  assert.equal(laterStarted, false)
  assert.equal(await new AgentBrowserOperation().run('read', async () => 42, () => undefined), 42)
})
