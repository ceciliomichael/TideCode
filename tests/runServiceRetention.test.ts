import './configureAppRoot'
import assert from 'node:assert/strict'
import test from 'node:test'
import { TideCodeRunServiceServer } from '../electron/runService/server'

test('completed run cleanup releases sequence numbers, projections, follow-ups, and both timers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const removedStreams: string[] = []
  const server = Object.create(TideCodeRunServiceServer.prototype) as {
    registry: { getByRunId: (id: string) => { streamId: string }; remove: (id: string) => void; listActive: () => unknown[] }
    followUps: { remove: (id: string) => void }
    runRetentionTimers: Map<string, NodeJS.Timeout>
    projectionTextIdleTimers: Map<string, NodeJS.Timeout>
    nextSeqByRunId: Map<string, number>
    projectionsByRunId: Map<string, unknown>
    runtimeBySurfaceConversationKey: Map<string, unknown>
    chatModeByConversationId: Map<string, unknown>
    compactionStateByConversationId: Map<string, unknown>
    scheduleRunRelease: (id: string) => void
  }
  const runs = new Map([['run', { streamId: 'stream' }]])
  server.registry = { getByRunId: (id) => runs.get(id)!, remove: (id) => { runs.delete(id) }, listActive: () => [] }
  server.followUps = { remove: (id) => { removedStreams.push(id) } }
  server.runRetentionTimers = new Map()
  let idleCallbackFired = false
  server.projectionTextIdleTimers = new Map([['run', setTimeout(() => { idleCallbackFired = true }, 70_000)]])
  server.nextSeqByRunId = new Map([['run', 123]])
  server.projectionsByRunId = new Map([['run', { messages: ['large transcript'] }]])
  server.runtimeBySurfaceConversationKey = new Map()
  server.chatModeByConversationId = new Map()
  server.compactionStateByConversationId = new Map()
  server.scheduleRunRelease('run')
  t.mock.timers.tick(59_999)
  assert.equal(runs.size, 1)
  t.mock.timers.tick(1)
  assert.equal(runs.size, 0)
  assert.deepEqual(removedStreams, ['stream'])
  assert.equal(server.nextSeqByRunId.size, 0)
  assert.equal(server.projectionsByRunId.size, 0)
  assert.equal(server.projectionTextIdleTimers.size, 0)
  assert.equal(server.runRetentionTimers.size, 0)
  t.mock.timers.tick(10_000)
  assert.equal(idleCallbackFired, false)
})

test('conversation metadata retention preserves active runs and in-progress compaction', () => {
  const server = Object.create(TideCodeRunServiceServer.prototype) as {
    registry: { listActive: () => { conversationId: string }[] }
    runtimeBySurfaceConversationKey: Map<string, { conversationId: string }>
    chatModeByConversationId: Map<string, string>
    compactionStateByConversationId: Map<string, { phase: string }>
    pruneConversationMetadata: () => void
  }
  server.registry = { listActive: () => [{ conversationId: 'active' }] }
  server.runtimeBySurfaceConversationKey = new Map([['desktop:active', { conversationId: 'active' }]])
  server.chatModeByConversationId = new Map([['active', 'agent']])
  server.compactionStateByConversationId = new Map([['compaction', { phase: 'compacting' }]])
  for (let index = 0; index < 140; index += 1) {
    const id = `inactive-${index}`
    server.runtimeBySurfaceConversationKey.set(`desktop:${id}`, { conversationId: id })
    server.chatModeByConversationId.set(id, 'agent')
    server.compactionStateByConversationId.set(id, { phase: 'compacted' })
  }
  server.pruneConversationMetadata()
  assert.equal(server.runtimeBySurfaceConversationKey.size, 128)
  assert.equal(server.chatModeByConversationId.size, 128)
  assert.equal(server.compactionStateByConversationId.size, 128)
  assert.ok(server.runtimeBySurfaceConversationKey.has('desktop:active'))
  assert.ok(server.chatModeByConversationId.has('active'))
  assert.ok(server.compactionStateByConversationId.has('compaction'))
  assert.equal(server.chatModeByConversationId.has('inactive-0'), false)
})
