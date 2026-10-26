import '../configureAppRoot'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents } from 'electron'
import { getAgentCursor, observeAgentCursor } from '../../electron/browser/agentCursor'
import { assertAgentObservation, rememberAgentObservation } from '../../electron/browser/agentObservation'
import { interactWithAgentPageInViewport, validateBrowserInteraction } from '../../electron/browser/agentPageInput'
import { DEFAULT_AGENT_VIEWPORT } from '../../electron/browser/agentViewport'
import type { CdpSend } from '../../electron/browser/agentCdpSession'

function createPage() {
  let url = 'https://example.test/'
  const contents = { getURL: () => url } as WebContents
  return { contents, navigate: (next: string) => { url = next } }
}

test('coordinate cursor never accesses the system pointer and requires a current observation', async () => {
  const page = createPage()
  const commands: Array<{ method: string; parameters?: Record<string, unknown> }> = []
  const send: CdpSend = async (method, parameters) => {
    commands.push({ method, parameters })
    return {}
  }
  const observation_id = rememberAgentObservation(page.contents, DEFAULT_AGENT_VIEWPORT)
  await interactWithAgentPageInViewport(page.contents, {
    action: 'hover', x: 320, y: 180, observation_id,
  }, send, DEFAULT_AGENT_VIEWPORT)
  assert.equal(getAgentCursor(page.contents)?.x, 320)
  assert.equal(getAgentCursor(page.contents)?.y, 180)
  assert.deepEqual(commands.filter((value) => value.method === 'Input.dispatchMouseEvent').map((value) => value.parameters?.type), ['mouseMoved'])
  await interactWithAgentPageInViewport(page.contents, {
    action: 'click', x: 320, y: 180, observation_id,
  }, send, DEFAULT_AGENT_VIEWPORT)
  assert.deepEqual(commands.filter((value) => value.method === 'Input.dispatchMouseEvent').slice(-3).map((value) => value.parameters?.type), [
    'mouseMoved', 'mousePressed', 'mouseReleased',
  ])
  await assert.rejects(interactWithAgentPageInViewport(page.contents, {
    action: 'click', x: 320, y: 180, observation_id,
  }, send, DEFAULT_AGENT_VIEWPORT), /stale/u)
})

test('observation expires on URL or viewport change', () => {
  const page = createPage()
  const id = rememberAgentObservation(page.contents, DEFAULT_AGENT_VIEWPORT)
  assertAgentObservation(page.contents, id, DEFAULT_AGENT_VIEWPORT)
  assert.throws(() => assertAgentObservation(page.contents, id, { width: 390, height: 844 }), /stale/u)
  page.navigate('https://example.test/other')
  assert.throws(() => assertAgentObservation(page.contents, id, DEFAULT_AGENT_VIEWPORT), /stale/u)
})

test('double-click dispatches two clicks and drag releases the pressed button', async () => {
  const page = createPage()
  const calls: Array<{ type: unknown; x: unknown; y: unknown }> = []
  const send: CdpSend = async (_method, parameters) => {
    calls.push({ type: parameters?.type, x: parameters?.x, y: parameters?.y })
    return {}
  }
  let id = rememberAgentObservation(page.contents, DEFAULT_AGENT_VIEWPORT)
  await interactWithAgentPageInViewport(page.contents, {
    action: 'double_click', x: 20, y: 30, observation_id: id,
  }, send, DEFAULT_AGENT_VIEWPORT)
  assert.deepEqual(calls.map((c) => c.type).filter(Boolean), [
    'mouseMoved', 'mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased',
  ])
  calls.length = 0
  id = rememberAgentObservation(page.contents, DEFAULT_AGENT_VIEWPORT)
  await interactWithAgentPageInViewport(page.contents, {
    action: 'drag', x: 20, y: 30, to_x: 220, to_y: 130, observation_id: id,
  }, send, DEFAULT_AGENT_VIEWPORT)
  assert.equal(calls[0].type, 'mouseMoved')
  assert.equal(calls.filter((c) => c.type)[1].type, 'mousePressed')
  assert.equal(calls.at(-1)?.type, 'mouseReleased')
  assert.equal(getAgentCursor(page.contents)?.x, 220)
  assert.equal(getAgentCursor(page.contents)?.y, 130)
})

test('coordinate validation refuses unobserved, mixed, or invalid destinations', () => {
  for (const action of [
    { action: 'click', x: 20, y: 30 },
    { action: 'click', x: 20, y: 30, observation_id: 'x', element_ref: 'ref' },
    { action: 'drag', x: 20, y: 30, to_x: -1, to_y: 0, observation_id: 'x' },
  ]) assert.throws(() => validateBrowserInteraction(action as never))
})

test('hover reports CSS cursor type before completing the browser action', async () => {
  const page = createPage()
  const observed: Array<{ x: number; y: number; kind?: string }> = []
  observeAgentCursor(page.contents, (cursor) => observed.push(cursor))
  const observation_id = rememberAgentObservation(page.contents, DEFAULT_AGENT_VIEWPORT)
  const report = await interactWithAgentPageInViewport(page.contents, {
    action: 'hover', x: 420, y: 240, observation_id,
  }, async (method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseMoved') {
      assert.equal(observed[0]?.x, 420)
    }
    if (method === 'Runtime.evaluate') return { result: { value: 'pointer' } }
    return {}
  }, DEFAULT_AGENT_VIEWPORT)
  assert.equal(getAgentCursor(page.contents)?.kind, 'pointer')
  assert.equal(report?.method, 'coordinates')
  assert.deepEqual([report?.x, report?.y], [420, 240])
  assert.equal(observed.at(-1)?.kind, 'pointer')
})

test('click produces cursor effect without changing movement identity at the same position', async () => {
  const page = createPage()
  const observation_id = rememberAgentObservation(page.contents, DEFAULT_AGENT_VIEWPORT)
  const send: CdpSend = async () => ({})
  await interactWithAgentPageInViewport(page.contents, {
    action: 'hover', x: 45, y: 30, observation_id,
  }, send, DEFAULT_AGENT_VIEWPORT)
  const originalMotion = getAgentCursor(page.contents)?.motionRevision
  await interactWithAgentPageInViewport(page.contents, {
    action: 'click', x: 45, y: 30, observation_id,
  }, send, DEFAULT_AGENT_VIEWPORT)
  assert.equal(getAgentCursor(page.contents)?.effect, 'click')
  assert.equal(getAgentCursor(page.contents)?.motionRevision, originalMotion)
})
