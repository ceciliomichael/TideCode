import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TerminalBroker } from '../../electron/terminal/broker/terminalBroker'
import { sessions } from '../../electron/terminal/sessionRegistry'
import type { PersistedTerminalBrokerState } from '../../electron/terminal/broker/persistence'
import { ApplicationRunLifecycle } from '../../electron/runService/applicationRunLifecycle'

test('turn completion and desktop closure terminate a real server and child without touching other sessions', { timeout: 60_000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-process-tree-'))
  const broker = new TerminalBroker({ reaperIntervalMs: 60_000 })
  const internals = broker as unknown as { persistence: { save: () => Promise<void>; flush: () => Promise<void> } }
  internals.persistence.save = async () => undefined
  internals.persistence.flush = async () => undefined
  t.after(async () => {
    await broker.shutdown()
    await fs.rm(directory, { recursive: true, force: true })
  })
  const fixture = path.join(directory, 'server.cjs')
  const marker = path.join(directory, 'pids.json')
  await fs.writeFile(fixture, `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
http.createServer((req, res) => res.end('alive')).listen(0, '127.0.0.1', function () {
  fs.writeFileSync(process.argv[2], JSON.stringify({ parent: process.pid, child: child.pid, port: this.address().port }));
});
`)
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
  }
  const other = await broker.createSession({ clientId: 'ai:other', ownerKind: 'ai', runId: 'other', workspaceRootPath: directory })
  const manual = await broker.createSession({ clientId: 'desktop-manual', ownerKind: 'visible', workspaceRootPath: directory })
  for (const reason of ['run_completed', 'surface_shutdown'] as const) {
    await fs.rm(marker, { force: true })
    const runId = `cleanup-${reason}`
    const terminal = await broker.createSession({ clientId: `ai:${runId}`, ownerKind: 'ai', runId, workspaceRootPath: directory })
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const command = process.platform === 'win32'
      ? `& '${process.execPath.replaceAll("'", "''")}' '${fixture.replaceAll("'", "''")}' '${marker.replaceAll("'", "''")}'\r`
      : `${quote(process.execPath)} ${quote(fixture)} ${quote(marker)}\r`
    await broker.write({ brokerSessionId: terminal.brokerSessionId, clientId: `ai:${runId}`, data: command })
    let pids: { parent: number; child: number; port: number } | undefined
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try {
        pids = JSON.parse(await fs.readFile(marker, 'utf8'))
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    assert.ok(pids, 'the test server and child must actually start')
    assert.equal(alive(pids.parent), true)
    assert.equal(alive(pids.child), true)
    const cancel = async () => {
      const results = await broker.applyRunCancellation(runId, {
        policy: 'terminate', reason, requestedAt: Date.now(), surface: 'system', runId,
      })
      assert.equal(results[0].state, 'terminated')
    }
    if (reason === 'surface_shutdown') {
      const lifecycle = new ApplicationRunLifecycle()
      const desktop = {}
      lifecycle.register(desktop)
      lifecycle.begin(desktop, runId)!.attach(cancel)
      await lifecycle.stop(desktop, true)
    } else {
      await cancel()
    }
    const exitDeadline = Date.now() + 5_000
    while ((alive(pids.parent) || alive(pids.child)) && Date.now() < exitDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(alive(pids.parent), false, 'the server must exit')
    assert.equal(alive(pids.child), false, 'its child must exit')
    assert.equal(alive(other.snapshot.processId!), true, 'another run must stay alive')
    assert.equal(alive(manual.snapshot.processId!), true, 'the manual terminal must stay alive')
  }
})

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

test('lost broker sessions report stale references and allow a fresh terminal without targeting a reused numeric ID', { timeout: 60_000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-terminal-recovery-'))
  const createBroker = () => {
    const broker = new TerminalBroker({ reaperIntervalMs: 60_000 })
    const internals = broker as unknown as {
      restore: (state: PersistedTerminalBrokerState) => void
      persistence: { save: () => Promise<void>; flush: () => Promise<void> }
    }
    internals.persistence.save = async () => undefined
    internals.persistence.flush = async () => undefined
    return { broker, internals }
  }
  const original = createBroker()
  const replacement = createBroker()
  t.after(async () => {
    await original.broker.shutdown()
    await replacement.broker.shutdown()
    await fs.rm(directory, { recursive: true, force: true })
  })
  const input = {
    clientId: 'recovery-client', ownerKind: 'visible' as const,
    workspaceRootPath: directory, sessionKey: 'terminal-tab-1', cols: 80, rows: 24,
  }
  const exitShell = async (broker: TerminalBroker, brokerSessionId: string) => {
    const exited = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe()
        reject(new Error('Recovery test terminal did not exit'))
      }, 20_000)
      const unsubscribe = broker.onEvent((event) => {
        if (event.type === 'terminal_session_changed' && event.session.brokerSessionId === brokerSessionId && event.session.state === 'exited') {
          clearTimeout(timeout)
          unsubscribe()
          resolve()
        }
      })
    })
    await broker.write({ clientId: input.clientId, brokerSessionId, data: 'exit\r' })
    await exited
  }
  const old = await original.broker.createSession(input)
  await exitShell(original.broker, old.brokerSessionId)
  await original.broker.shutdown()
  replacement.internals.restore({
    schema: 'tidecode.terminal_broker_state/v1', savedAt: Date.now(), operations: [],
    sessions: [{ sessionKey: input.sessionKey, snapshot: old.snapshot, output: { data: 'saved output', startCursor: 0, endCursor: 12 } }],
  })
  const oldReference = { clientId: input.clientId, brokerSessionId: old.brokerSessionId, workspaceRootPath: directory }
  await assert.rejects(replacement.broker.write({ ...oldReference, data: 'must not execute\r' }), /is lost/)
  await assert.rejects(replacement.broker.write({ clientId: input.clientId, legacySessionId: old.legacySessionId, data: 'x' }), /Unknown terminal session id/)
  assert.throws(() => replacement.broker.getSession({ clientId: input.clientId }), /reference is required/)
  await replacement.broker.terminate({ ...oldReference, provenance: {
    policy: 'terminate', reason: 'user_stop', requestedAt: Date.now(), surface: 'desktop',
  } })
  replacement.broker.attach(oldReference)
  assert.equal((await replacement.broker.read(oldReference)).output.data, 'saved output', 'lost-session output remains readable')
  replacement.broker.detach(oldReference)
  const fresh = await replacement.broker.createSession(input)
  assert.notEqual(fresh.brokerSessionId, old.brokerSessionId)
  assert.equal(fresh.isReused, false)
  await assert.rejects(replacement.broker.write({ ...oldReference, legacySessionId: fresh.legacySessionId, data: 'must not execute\r' }), /is lost/)
  const reference = { ...oldReference, brokerSessionId: fresh.brokerSessionId }
  const marker = `RECOVERED_${Date.now()}`
  const output = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Replacement terminal did not produce output'))
    }, 20_000)
    const unsubscribe = replacement.broker.onEvent((event) => {
      if (event.type === 'terminal_output' && event.output.brokerSessionId === fresh.brokerSessionId && event.output.data.includes(marker)) {
        clearTimeout(timeout)
        unsubscribe()
        resolve()
      }
    })
  })
  await replacement.broker.write({ ...reference, data: `echo ${marker}\r` })
  await output
  assert.equal(replacement.broker.getSession(reference).state, 'ready')
  await exitShell(replacement.broker, fresh.brokerSessionId)
})
