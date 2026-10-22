import './configureAppRoot'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationRunLifecycle } from '../electron/runService/applicationRunLifecycle'
import { isRunServiceRequest } from '../electron/runService/protocol'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runToolEnabledChatStream } from '../electron/chat/shared/runtime'
import { getTerminalBroker } from '../electron/terminal/broker/instance'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../src/lib/contextCompactionSettings'
import type { ChatStreamEvent } from '../src/types/chat'
import { createAgentToolBundle } from '../electron/chat/shared/tools/factory'
import { createTerminalSessionOwner } from '../electron/chat/shared/tools/terminalToolShared'

function deferred() {
  let resolve = () => undefined as void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

test('desktop cleanup awaits every cancellation and leaves other clients alone', async () => {
  const lifecycle = new ApplicationRunLifecycle()
  const first = {}
  const second = {}
  lifecycle.register(first)
  lifecycle.register(second)
  const release = deferred()
  let cancellations = 0
  lifecycle.begin(first, 'first')!.attach(async () => {
    cancellations += 1
    await release.promise
  })
  lifecycle.begin(first, 'second')!.attach(async () => { cancellations += 1 })
  lifecycle.begin(second, 'other')!.attach(async () => { assert.fail('another desktop must retain its work') })
  assert.equal(lifecycle.begin({}, 'cli'), null)
  let stopped = false
  const stopping = lifecycle.stop(first).then(() => { stopped = true })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(cancellations, 2)
  assert.equal(stopped, false)
  assert.throws(() => lifecycle.begin(first, 'late'), /closing its AI work/u)
  release.resolve()
  await stopping
  assert.equal(stopped, true)
  lifecycle.begin(first, 'reopened')!.finish()
})

test('disconnect waits for an in-flight start, cancels it, and prevents later starts', async () => {
  const lifecycle = new ApplicationRunLifecycle()
  const owner = {}
  lifecycle.register(owner)
  const run = lifecycle.begin(owner, 'starting')!
  const done = deferred()
  let cancelled = false
  const stopping = lifecycle.stop(owner, true)
  run.attach(async () => {
    cancelled = true
    await done.promise
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(cancelled, true)
  done.resolve()
  await stopping
  assert.throws(() => lifecycle.begin(owner, 'late'), /closing its AI work/u)
})

test('failed starts and completed runs release ownership without cancellation', async () => {
  const lifecycle = new ApplicationRunLifecycle()
  const owner = {}
  lifecycle.register(owner)
  const completed = lifecycle.begin(owner, 'completed')!
  completed.attach(async () => { assert.fail('completed runs must not be cancelled') })
  completed.finish()
  const starting = lifecycle.begin(owner, 'failed-start')!
  const stopping = lifecycle.stop(owner)
  starting.finish()
  await stopping
})

test('one cleanup failure does not skip other runs and remains retryable', async (t) => {
  t.mock.method(console, 'error', () => undefined)
  const lifecycle = new ApplicationRunLifecycle()
  const owner = {}
  lifecycle.register(owner)
  let attempts = 0
  let otherStopped = false
  lifecycle.begin(owner, 'failure')!.attach(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('termination failed')
  })
  lifecycle.begin(owner, 'other')!.attach(async () => { otherStopped = true })
  await assert.rejects(lifecycle.stop(owner), /could not be stopped/u)
  assert.equal(otherStopped, true)
  await lifecycle.stop(owner)
  assert.equal(attempts, 2)
})

test('application cleanup requests cannot supply arbitrary cancellation targets', () => {
  const request = { id: 'request', token: 'token', method: 'stopApplicationRuns' }
  assert.equal(isRunServiceRequest(request), true)
  assert.equal(isRunServiceRequest({ ...request, params: { owner: 'another-desktop' } }), false)
})

test('the real tool factory forwards turn ownership to terminal creation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-terminal-owner-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const create = t.mock.method(getTerminalBroker(), 'createSession', async (input) => {
    assert.equal(input.runId, 'owner-turn')
    assert.equal(input.clientId, 'ai:owner-turn')
    assert.equal(input.conversationId, 'owner-conversation')
    throw new Error('Stop after checking ownership, before spawning a process.')
  })
  const bundle = await createAgentToolBundle({
    workspaceRootPath: directory,
    conversationId: 'owner-conversation',
    turnId: 'owner-turn',
    terminalExecutionMode: 'full',
    webContents: createTerminalSessionOwner({ emit: () => undefined }),
  }, { chatMode: 'agent' })
  try {
    const terminal = bundle.nativeTools['terminal.execute']
    await terminal.execute!({ command: 'echo ownership' }, { toolCallId: 'ownership', messages: [] })
    assert.equal(create.mock.callCount(), 1)
    assert.equal(create.mock.calls[0].arguments[0].runId, 'owner-turn')
  } finally {
    await bundle.codeModeExecutor.dispose()
    create.mock.restore()
  }
})

test('runtime waits for terminal termination before completed, error and aborted events', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-turn-cleanup-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  for (const outcome of ['completed', 'error', 'aborted', 'cleanup_failed']) {
    const cleanupStarted = deferred()
    const release = deferred()
    const events: ChatStreamEvent[] = []
    const controller = new AbortController()
    const cleanup = t.mock.method(getTerminalBroker(), 'applyRunCancellation', async (_runId, provenance) => {
      assert.equal(provenance.policy, 'terminate')
      cleanupStarted.resolve()
      await release.promise
      if (outcome === 'cleanup_failed') {
        return [{ state: 'orphaned' }]
      }
      return []
    })
    const logging = t.mock.method(console, 'error', () => undefined)
    const running = runToolEnabledChatStream({
      abortController: controller,
      createStream: async () => ({
        fullStream: (async function* () {
          if (outcome === 'error') throw new Error('provider failed')
          if (outcome === 'aborted') {
            controller.abort({ policy: 'detach', reason: 'surface_shutdown', requestedAt: Date.now(), surface: 'desktop' })
          }
          yield { type: 'text-delta' as const, text: 'done' }
          yield { type: 'finish' as const, finishReason: 'stop' }
        })(),
      }),
      startInput: {
        agentContextRootPath: directory,
        chatMode: 'agent',
        contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
        messages: [{ id: 'user', content: 'test cleanup', role: 'user', timestamp: 1 }],
        modelId: 'gpt-5.6-luna', providerId: 'codex', reasoningEffort: 'high', terminalExecutionMode: 'sandbox',
      },
      streamId: `cleanup-${outcome}`,
      webContents: { emit: (event) => events.push(event) },
    })
    try {
      await Promise.race([
        cleanupStarted.promise,
        running.then(() => { throw new Error('Runtime ended without terminal cleanup') }),
      ])
      assert.equal(events.some((event) => ['completed', 'error', 'aborted'].includes(event.type)), false)
      release.resolve()
      await running
      const expected = outcome === 'cleanup_failed' ? 'error' : outcome
      assert.equal(events.filter((event) => ['completed', 'error', 'aborted'].includes(event.type)).at(-1)?.type, expected)
      assert.equal(cleanup.mock.callCount(), 1)
    } finally {
      release.resolve()
      await running
      cleanup.mock.restore()
      logging.mock.restore()
    }
  }
})
