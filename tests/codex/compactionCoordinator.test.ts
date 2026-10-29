import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { coordinateCompaction, createCompactionSession } from '../../electron/chat/shared/compaction/coordinator'
import { prepareContextRequest } from '../../electron/chat/shared/contextRequest'
import type { CompactionResult, CompactionAttemptDiagnostic } from '../../electron/chat/shared/compaction/contracts'
import { CompactionError } from '../../electron/chat/shared/compaction/gate'
import { largeContextScenario, temporaryImageScenario } from '../fixtures/contextCompactionScenarios'
import { createCompactionPacketFixture } from './compactionFixtures'

function harness(tokens = 210_000) {
  const makeRequest = (messages: ModelMessage[]) => prepareContextRequest({
    messages, capabilities: { contextWindowTokens: 256_000, maxOutputTokens: 20_000, countingMethod: 'heuristic' },
    systemPromptTokens: 0, toolSchemaTokens: 0, triggerRatio: 0.8,
  })
  const request = makeRequest(largeContextScenario(tokens))
  const result: CompactionResult = {
    boundaryIndex: 2, durableMemory: { schema: 'tidecode.conversation_memory/v1', markdown: 'Task remains active.', sourceDigest: 'source' },
    packet: createCompactionPacketFixture({ sourceDigest: 'source', sourceMessageIds: ['model:0'] }), projectedMessages: [request.durableMessages[0], { role: 'assistant', content: 'Supported progress and next action.' }],
    sourceDigest: 'source', projectionVersion: 'tidecode.compaction_projection/v2',
    reasoningRetention: { mode: 'summarized_visible', modelId: 'unknown', providerId: 'openai', note: 'Visible only.' },
  }
  let commits = 0
  let calls = 0
  const reports: CompactionAttemptDiagnostic[] = []
  const input: Parameters<typeof coordinateCompaction>[0] = {
    request, session: createCompactionSession(), previousPacket: null, retainedContextTokens: 10_000,
    run: async () => { calls += 1; return result },
    rebuild: async (candidate) => makeRequest([...candidate.projectedMessages, ...request.visualMessages]),
    commit: async () => { commits += 1 },
    report: async (diagnostic) => { reports.push(diagnostic) },
  }
  return { input, makeRequest, result, reports, calls: () => calls, commits: () => commits }
}

test('preferred worker failure continues safely and is not retried each step', async () => {
  const h = harness()
  let attempts = 0
  h.input.run = async () => { attempts += 1; throw new CompactionError('worker_timeout') }
  assert.equal((await coordinateCompaction(h.input)).status, 'deferred')
  assert.equal((await coordinateCompaction(h.input)).status, 'deferred')
  assert.equal(attempts, 1)
  assert.equal(h.commits(), 0)
  assert.equal(h.reports[0].reason, 'worker_timeout')
})

test('required worker failure blocks the next request', async () => {
  const h = harness(230_000)
  h.input.run = async () => { throw new CompactionError('worker_timeout') }
  await assert.rejects(coordinateCompaction(h.input), (error: unknown) => error instanceof CompactionError && error.reason === 'worker_timeout')
  assert.equal(h.commits(), 0)
  assert.equal(h.reports[0].outcome, 'blocked')
})

test('failed durable save cannot produce a committed live projection', async () => {
  const h = harness()
  h.input.commit = async () => { throw new Error('disk failure') }
  const outcome = await coordinateCompaction(h.input)
  assert.equal(outcome.status, 'deferred')
  assert.equal(h.reports[0].reason, 'commit_failed')
})

test('successful snapshot is returned only after persistence completes', async () => {
  const h = harness()
  let persisted = false
  h.input.commit = async () => { await Promise.resolve(); persisted = true }
  assert.equal((await coordinateCompaction(h.input)).status, 'compacted')
  assert.equal(persisted, true)
})

test('temporary images must fit again after projection before any commit', async () => {
  const h = harness(230_000)
  h.input.rebuild = async () => h.makeRequest([h.result.projectedMessages[0], ...Array.from({ length: 60 }, () => temporaryImageScenario(16))])
  await assert.rejects(coordinateCompaction(h.input), (error: unknown) => error instanceof CompactionError && error.reason === 'projection_too_large')
  assert.equal(h.commits(), 0)
})

test('a protected latest request expands the retained target without being truncated', async () => {
  const h = harness()
  h.input.request = h.makeRequest([{ role: 'user', content: 'Request '.repeat(10_000) }, ...largeContextScenario().slice(1)])
  let target = 0
  h.input.run = async (_window, targetTokens) => {
    target = targetTokens
    return { ...h.result, projectedMessages: [h.input.request.durableMessages[0]] }
  }
  assert.equal((await coordinateCompaction(h.input)).status, 'compacted')
  assert.ok(target > 20_000)
})

test('cancellation during a worker never commits or continues', async () => {
  const h = harness()
  const controller = new AbortController()
  h.input.signal = controller.signal
  h.input.run = async () => { controller.abort(); return h.result }
  assert.equal((await coordinateCompaction(h.input)).status, 'aborted')
  assert.equal(h.commits(), 0)
})

test('an unmatched tool result is recorded as blocked without calling a worker', async () => {
  const h = harness()
  h.input.request = h.makeRequest([{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'orphan', toolName: 'read', output: { type: 'text', value: 'Evidence' } }] }])
  await assert.rejects(coordinateCompaction(h.input), { reason: 'invalid_tool_pairs' })
  assert.equal(h.calls(), 0)
  assert.equal(h.reports[0].outcome, 'blocked')
})

test('a small context does not call either compaction worker', async () => {
  const h = harness(1_000)
  assert.equal((await coordinateCompaction(h.input)).status, 'not_needed')
  assert.equal(h.calls(), 0)
})
