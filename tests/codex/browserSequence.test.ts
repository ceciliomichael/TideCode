import '../configureAppRoot'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents } from 'electron'
import { executeAgentBrowserSequenceInViewport, validateBrowserSequence, type AgentBrowserStep } from '../../electron/browser/agentPageSequence'
const FIXTURE_VIEWPORT = { width: 1280, height: 720 } as const
import type { CdpSend } from '../../electron/browser/agentCdpSession'

const contents = {
  isDestroyed: () => false,
  getURL: () => 'https://example.test/game',
  getTitle: () => 'Game',
} as WebContents

function screenshot(bytes = 24) {
  const png = Buffer.alloc(bytes)
  png.writeUInt32BE(1280, 16)
  png.writeUInt32BE(720, 20)
  return { data: png.toString('base64') }
}

test('sequence dispatches input and observations in order, retaining labeled images and measured times', async () => {
  const commands: string[] = []
  const send: CdpSend = async (method, params) => {
    commands.push(method + ':' + (params?.type ?? ''))
    if (method === 'Page.captureScreenshot') {
      return screenshot()
    }
    return {}
  }
  const result = await executeAgentBrowserSequenceInViewport(contents, [
    { action: 'read', view: 'visual', label: 'Before' },
    { action: 'key', key: 'Space' },
    { action: 'wait', duration_ms: 10 },
    { action: 'read', view: 'visual', label: 'During' },
  ], send, FIXTURE_VIEWPORT)
  assert.deepEqual(commands, [
    'Page.captureScreenshot:', 'Input.dispatchKeyEvent:keyDown',
    'Input.dispatchKeyEvent:keyUp', 'Page.captureScreenshot:',
  ])
  assert.equal(result.completed_steps, 4)
  assert.equal(result.error, undefined)
  assert.deepEqual(result.captures.map(({ label, step }) => ({ label, step })), [
    { label: 'Before', step: 1 }, { label: 'During', step: 4 },
  ])
  assert.ok(result.captures.every((capture) => capture.imageBase64))
  assert.ok(result.captures[1].started_ms >= result.captures[0].completed_ms + 8)
  assert.ok(result.elapsed_ms >= result.captures[1].completed_ms)
})

test('sequence wait accepts ms alias from browser tool calls', async () => {
  validateBrowserSequence([{ action: 'wait', ms: 3 }])
  assert.throws(() => validateBrowserSequence([
    { action: 'wait', ms: 3, duration_ms: 3 },
  ]), /not both/)
  const result = await executeAgentBrowserSequenceInViewport(contents, [
    { action: 'wait', ms: 3 },
  ], async () => ({}), FIXTURE_VIEWPORT)
  assert.equal(result.completed_steps, 1)
  assert.equal(result.error, undefined)
})

test('an invalid later action or out-of-viewport scroll is rejected before earlier input executes', async () => {
  let dispatched = false
  const send: CdpSend = async () => { dispatched = true }
  for (const invalid of [
    { action: 'key', key: 'UnknownKey' },
    { action: 'click', element_ref: 'el-1', x: 10 },
    { action: 'navigate', url: 'file:///secret' },
    { action: 'wait', duration_ms: -1 },
    { action: 'scroll', x: 1300 },
    { action: 'stroke', points: [{ x: 10, y: 10 }, { x: 10, y: 750 }] },
    { action: 'read', view: 'annotations' },
  ]) {
    await assert.rejects(executeAgentBrowserSequenceInViewport(contents, [
      { action: 'type', text: 'must not be sent' }, invalid,
    ] as AgentBrowserStep[], send, FIXTURE_VIEWPORT))
  }
  assert.equal(dispatched, false)
  assert.throws(() => validateBrowserSequence([]), /1 and 32/)
  assert.throws(() => validateBrowserSequence(Array(33).fill({ action: 'key', key: 'Space' })), /1 and 32/)
  assert.throws(() => validateBrowserSequence([
    { action: 'wait', duration_ms: 3000 }, { action: 'wait', duration_ms: 3000 },
  ]), /total at most/)
  assert.throws(() => validateBrowserSequence(Array(9).fill({ action: 'read' })), /at most 8/)
})

test('a failed action stops the chain without replay and preserves earlier observations', async () => {
  const commands: string[] = []
  const result = await executeAgentBrowserSequenceInViewport(contents, [
    { action: 'read', view: 'visual', label: 'Evidence' },
    { action: 'key', key: 'Space' },
    { action: 'type', text: 'must not run' },
  ], async (method) => {
    commands.push(method)
    if (method === 'Page.captureScreenshot') {
      return screenshot()
    }
    throw new Error('Input connection failed')
  }, FIXTURE_VIEWPORT)
  assert.equal(result.completed_steps, 1)
  assert.equal(result.failed_step, 2)
  assert.match(result.error!, /Input connection failed/)
  assert.equal(result.captures[0].label, 'Evidence')
  assert.deepEqual(commands, ['Page.captureScreenshot', 'Input.dispatchKeyEvent'])
})

test('aggregate image bytes are bounded and earlier captures survive a size failure', async () => {
  let captures = 0
  const result = await executeAgentBrowserSequenceInViewport(contents, [
    { action: 'read', view: 'visual' },
    { action: 'read', view: 'visual' },
    { action: 'key', key: 'Space' },
  ], async (method) => {
    assert.equal(method, 'Page.captureScreenshot')
    captures += 1
    return screenshot(5 * 1024 * 1024)
  }, FIXTURE_VIEWPORT)
  assert.equal(captures, 2)
  assert.equal(result.completed_steps, 1)
  assert.equal(result.failed_step, 2)
  assert.equal(result.captures.length, 1)
  assert.match(result.error!, /8 MiB/)
})

test('wait_for observes page conditions without a model round trip', async () => {
  let attempts = 0
  const result = await executeAgentBrowserSequenceInViewport(contents, [
    { action: 'wait_for', selector: '#ready', timeout_ms: 1000 },
    { action: 'key', key: 'Enter' },
  ], async (method) => {
    if (method === 'Runtime.evaluate') {
      attempts += 1
      return { result: { value: attempts >= 2 } }
    }
    return {}
  }, FIXTURE_VIEWPORT)
  assert.equal(result.completed_steps, 2)
  assert.equal(attempts, 2)
})

test('wait_for tolerates a navigation replacing the execution context', async () => {
  let attempts = 0
  const result = await executeAgentBrowserSequenceInViewport(contents, [
    { action: 'wait_for', selector: '#ready', timeout_ms: 1000 },
    { action: 'key', key: 'Enter' },
  ], async (method) => {
    if (method === 'Runtime.evaluate') {
      attempts += 1
      if (attempts === 1) throw new Error('Execution context was destroyed.')
      return { result: { value: true } }
    }
    return {}
  }, FIXTURE_VIEWPORT)
  assert.equal(result.completed_steps, 2)
  assert.equal(attempts, 2)
})

test('wait_for stops before later actions when its condition never becomes true', async () => {
  const sent: string[] = []
  const result = await executeAgentBrowserSequenceInViewport(contents, [
    { action: 'wait_for', url_contains: '/missing', timeout_ms: 0 },
    { action: 'click', element_ref: 'ref' },
  ], async (method) => {
    sent.push(method)
    return {}
  }, FIXTURE_VIEWPORT)
  assert.equal(result.completed_steps, 0)
  assert.equal(result.failed_step, 1)
  assert.match(result.error ?? '', /wait_for condition/u)
  assert.deepEqual(sent, [])
  assert.throws(() => validateBrowserSequence([{ action: 'wait_for' }]), /selector or url_contains/u)
  assert.throws(() => validateBrowserSequence([
    { action: 'wait_for', url_contains: 'a', timeout_ms: 3000 },
    { action: 'wait_for', url_contains: 'b', timeout_ms: 3000 },
  ]), /total at most/u)
})

test('cancelling an active wait prevents the next browser input', async () => {
  const controller = new AbortController()
  const sent: string[] = []
  const pending = executeAgentBrowserSequenceInViewport(contents, [
    { action: 'wait', duration_ms: 2000 },
    { action: 'key', key: 'Enter' },
  ], async (method) => { sent.push(method); return {} }, FIXTURE_VIEWPORT, controller.signal)
  setTimeout(() => controller.abort(), 20)
  const result = await pending
  assert.equal(result.failed_step, 1)
  assert.equal(result.completed_steps, 0)
  assert.match(result.error ?? '', /abort/iu)
  assert.deepEqual(sent, [])
})
