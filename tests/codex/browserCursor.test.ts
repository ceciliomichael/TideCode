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

test('coordinate cursor works without a preceding read or system pointer', async () => {
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
  await interactWithAgentPageInViewport(page.contents, {
    action: 'click', x: 320, y: 180,
  }, send, DEFAULT_AGENT_VIEWPORT)
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

test('stroke moves through all points with one press and one release', async () => {
  const events: Array<{ type: unknown; x: unknown; y: unknown; buttons: unknown }> = []
  const send: CdpSend = async (method, input) => {
    if (method === 'Input.dispatchMouseEvent') {
      events.push({ type: input?.type, x: input?.x, y: input?.y, buttons: input?.buttons })
    }
    return {}
  }
  const report = await interactWithAgentPageInViewport(createPage().contents, {
    action: 'stroke',
    points: [{ x: 20, y: 30 }, { x: 30, y: 40 }, { x: 40, y: 30 }],
  }, send, DEFAULT_AGENT_VIEWPORT)
  assert.equal(events[0].type, 'mouseMoved')
  assert.equal(events[1].type, 'mousePressed')
  assert.ok(events.length > 5, 'interpolation adds movements between points')
  assert.ok(events.slice(2, -1).every((event) => event.type === 'mouseMoved' && event.buttons === 1))
  assert.equal(events.at(-1)?.type, 'mouseReleased')
  assert.equal(report?.detail, '3 connected points')
  assert.throws(() => validateBrowserInteraction({ action: 'stroke', points: [{ x: 20, y: 30 }] }))
  assert.throws(() => validateBrowserInteraction({ action: 'stroke', points: [
    { x: 20, y: 30 }, { x: -1, y: 30 },
  ] }))
})

test('stroke releases at the last dispatched point after a failed move', async () => {
  const events: Array<{ type: unknown; x: unknown }> = []
  const send: CdpSend = async (method, input) => {
    if (method !== 'Input.dispatchMouseEvent') return {}
    events.push({ type: input?.type, x: input?.x })
    if (input?.type === 'mouseMoved' && input?.x === 40) throw new Error('Mouse move failed')
    return {}
  }
  await assert.rejects(interactWithAgentPageInViewport(createPage().contents, {
    action: 'stroke',
    points: [{ x: 20, y: 30 }, { x: 30, y: 40 }, { x: 40, y: 30 }],
  }, send, DEFAULT_AGENT_VIEWPORT), /Mouse move failed/)
  assert.deepEqual(events.at(-1), { type: 'mouseReleased', x: 35 })
})

test('long drags interpolate closely spaced movements and release at the destination', async () => {
  const events: Array<{ type: unknown; x: number; y: number; buttons?: number }> = []
  const page = createPage()
  await interactWithAgentPageInViewport(page.contents, {
    action: 'drag', x: 20, y: 30, to_x: 380, to_y: 270,
  }, async (method, input) => {
    if (method === 'Input.dispatchMouseEvent') {
      events.push({
        type: input?.type,
        x: Number(input?.x),
        y: Number(input?.y),
        buttons: input?.buttons as number | undefined,
      })
    }
    return {}
  }, DEFAULT_AGENT_VIEWPORT)
  const moves = events.filter((event) => event.type === 'mouseMoved' && event.buttons === 1)
  assert.ok(moves.length > 25, 'long drags need more than ten fixed mouse movements')
  const route = [{ x: 20, y: 30 }, ...moves]
  for (let i = 1; i < route.length; i += 1) {
    assert.ok(Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y) <= 12.01)
  }
  assert.deepEqual(events.at(-1), {
    type: 'mouseReleased', x: 380, y: 270, buttons: undefined,
  })
})

test('drag releases at last completed position after a movement error', async () => {
  const events: Array<{ type: unknown; x: number }> = []
  await assert.rejects(interactWithAgentPageInViewport(createPage().contents, {
    action: 'drag', x: 20, y: 30, to_x: 80, to_y: 30,
  }, async (method, input) => {
    if (method === 'Input.dispatchMouseEvent') {
      events.push({ type: input?.type, x: Number(input?.x) })
      if (input?.type === 'mouseMoved' && input?.x === 56) {
        throw new Error('Movement interrupted')
      }
    }
    return {}
  }, DEFAULT_AGENT_VIEWPORT), /Movement interrupted/)
  assert.deepEqual(events.at(-1), { type: 'mouseReleased', x: 44 })
})

test('coordinate validation accepts unobserved positions but rejects mixed or invalid destinations', () => {
  assert.doesNotThrow(() => validateBrowserInteraction({ action: 'click', x: 20, y: 30 }))
  assert.doesNotThrow(() => validateBrowserInteraction({ action: 'drag', x: 20, y: 30, to_x: 40, to_y: 60 }))
  for (const action of [
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
