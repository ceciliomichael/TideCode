import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TerminalBroker } from '../../electron/terminal/broker/terminalBroker'
import { sessions } from '../../electron/terminal/sessionRegistry'

test('broker retains an attached exited terminal, then releases output and owner state after detach', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-terminal-lifecycle-'))
  const broker = new TerminalBroker({ recordRetentionMs: 0, reaperIntervalMs: 60_000 })
  const internals = broker as unknown as {
    reap: () => Promise<void>
    persistence: { save: () => Promise<void>; flush: () => Promise<void> }
  }
  // Exercise real PTY ownership without writing test state into the user's home.
  internals.persistence.save = async () => undefined
  internals.persistence.flush = async () => undefined
  t.after(async () => {
    await broker.shutdown()
    await fs.rm(directory, { recursive: true, force: true })
  })
  const created = await broker.createSession({
    clientId: 'lifecycle-client', cols: 80, rows: 24, ownerKind: 'desktop',
    workspaceRootPath: directory,
  })
  const reference = { brokerSessionId: created.brokerSessionId, clientId: 'lifecycle-client', workspaceRootPath: directory }
  const exited = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test terminal did not exit')), 20_000)
    const unsubscribe = broker.onEvent((event) => {
      if (event.type === 'terminal_session_changed' && event.session.brokerSessionId === created.brokerSessionId && event.session.state === 'exited') {
        clearTimeout(timeout)
        unsubscribe()
        resolve()
      }
    })
  })
  broker.write({ ...reference, data: 'exit\r' })
  await exited
  await internals.reap()
  assert.equal(broker.getSession(reference).state, 'exited')
  assert.ok(sessions.has(created.legacySessionId))
  broker.detach(reference)
  await internals.reap()
  assert.throws(() => broker.getSession(reference), /Unknown terminal/)
  assert.equal(sessions.has(created.legacySessionId), false)
})

test('broker operation retention keeps active work while bounding completed command metadata', async (t) => {
  const broker = new TerminalBroker({ recordRetentionMs: 300_000, reaperIntervalMs: 60_000 })
  const internals = broker as unknown as {
    operations: Map<string, { snapshot: { state: string; completedAt: number; createdAt: number } }>
    pruneOperations: (record: { snapshot: { operationIds: string[] } }, now: number) => void
    persistence: { save: () => Promise<void>; flush: () => Promise<void> }
  }
  internals.persistence.save = async () => undefined
  internals.persistence.flush = async () => undefined
  t.after(() => broker.shutdown())
  const operationIds = ['active', ...Array.from({ length: 80 }, (_, index) => `completed-${index}`)]
  for (const id of operationIds) {
    internals.operations.set(id, { snapshot: { state: id === 'active' ? 'running' : 'completed', completedAt: 1_000, createdAt: 1_000 } })
  }
  const record = { snapshot: { operationIds } }
  internals.pruneOperations(record, 2_000)
  assert.equal(internals.operations.size, 65)
  assert.ok(internals.operations.has('active'))
  assert.ok(internals.operations.has('completed-79'))
  assert.equal(internals.operations.has('completed-0'), false)
  internals.pruneOperations(record, 400_000)
  assert.deepEqual(record.snapshot.operationIds, ['active'])
})
