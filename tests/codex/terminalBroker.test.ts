import assert from 'node:assert/strict'
import test from 'node:test'
import type { IPty } from 'node-pty'
import { TerminalBrokerOutputStore } from '../../electron/terminal/broker/outputStore'
import { terminatePtyProcessTree } from '../../electron/terminal/broker/processTermination'
import {
  transitionTerminalOperationState,
  transitionTerminalSessionState,
} from '../../electron/terminal/broker/stateMachine'

test('terminal broker output cursors replay retained output and report eviction', () => {
  const output = new TerminalBrokerOutputStore(5)
  output.append('session-1', 'abc')
  output.append('session-1', 'def')

  assert.deepEqual(output.cursors, { endCursor: 6, startCursor: 1 })
  assert.deepEqual(output.read('session-1', 0), {
    brokerSessionId: 'session-1',
    data: 'bcdef',
    endCursor: 6,
    outputEvicted: true,
    startCursor: 1,
  })
  assert.equal(output.read('session-1', 4).data, 'ef')
})

test('terminal broker output store preserves cursor semantics across many small chunks', () => {
  const output = new TerminalBrokerOutputStore(300_000)
  const chunk = '0123456789abcdef'
  for (let index = 0; index < 25_000; index += 1) {
    output.append('session-1', chunk)
  }

  assert.deepEqual(output.cursors, { endCursor: 400_000, startCursor: 100_000 })
  assert.equal(output.retainedData.length, 300_000)
  assert.equal(output.read('session-1', 399_984).data, chunk)
  assert.equal(output.read('session-1', 0).outputEvicted, true)
})

test('terminal broker output store bounds a single oversized chunk without retaining its prefix', () => {
  const output = new TerminalBrokerOutputStore(5)
  output.append('session-1', 'abc')
  const appended = output.append('session-1', '0123456789')

  assert.deepEqual(output.cursors, { endCursor: 13, startCursor: 8 })
  assert.equal(output.retainedData, '56789')
  assert.equal(appended.outputEvicted, true)
  assert.equal(output.read('session-1', 0).data, '56789')
})

test('terminal broker state machines reject lifecycle shortcuts', () => {
  assert.equal(transitionTerminalSessionState('creating', 'ready'), 'ready')
  assert.equal(transitionTerminalOperationState('queued', 'writing'), 'writing')
  assert.throws(
    () => transitionTerminalSessionState('ready', 'terminated'),
    /Invalid terminal session state transition/u,
  )
  assert.throws(
    () => transitionTerminalOperationState('queued', 'completed'),
    /Invalid terminal operation state transition/u,
  )
})

test('Windows cleanup falls back to node-pty when taskkill returns nonzero', async () => {
  let alive = true
  let ptyKillCalls = 0
  const pty = {
    kill: () => {
      ptyKillCalls += 1
      alive = false
    },
    pid: 4242,
  } as unknown as IPty
  const result = await terminatePtyProcessTree(pty, {
    isProcessAlive: () => alive,
    platform: 'win32',
    runTaskkill: async () => ({
      error: 'Process terminator exited with status 1.',
      method: 'taskkill',
      status: 1,
    }),
    systemRoot: 'C:\\Windows',
  })

  assert.equal(ptyKillCalls, 1)
  assert.equal(result.terminated, true)
  assert.deepEqual(result.attempts.map((attempt) => attempt.method), ['taskkill', 'pty-kill'])
  assert.match(result.attempts[0]?.error ?? '', /status 1/u)
})

test('Windows cleanup retains a failed result when both termination mechanisms fail', async () => {
  const pty = {
    kill: () => {
      throw new Error('pty kill failed')
    },
    pid: 4343,
  } as unknown as IPty
  const result = await terminatePtyProcessTree(pty, {
    isProcessAlive: () => true,
    platform: 'win32',
    runTaskkill: async () => ({
      error: 'Process terminator exited with status 5.',
      method: 'taskkill',
      status: 5,
    }),
  })

  assert.equal(result.terminated, false)
  assert.equal(result.attempts[1]?.error, 'pty kill failed')
})

test('Windows cleanup falls back to node-pty when taskkill times out', async () => {
  let alive = true
  let ptyKillCalls = 0
  const pty = {
    kill: () => {
      ptyKillCalls += 1
      alive = false
    },
    pid: 4545,
  } as unknown as IPty

  const result = await terminatePtyProcessTree(pty, {
    isProcessAlive: () => alive,
    platform: 'win32',
    runTaskkill: async (_command, _args, timeoutMs) => ({
      error: 'Process terminator timed out after ' + timeoutMs + 'ms.',
      method: 'taskkill',
      status: null,
    }),
    taskkillTimeoutMs: 25,
  })

  assert.equal(ptyKillCalls, 1)
  assert.equal(result.terminated, true)
  assert.match(result.attempts[0]?.error ?? '', /timed out after 25ms/u)
})

test('Windows cleanup falls back to node-pty when the taskkill runner rejects', async () => {
  let alive = true
  let ptyKillCalls = 0
  const pty = {
    kill: () => {
      ptyKillCalls += 1
      alive = false
    },
    pid: 4747,
  } as unknown as IPty

  const result = await terminatePtyProcessTree(pty, {
    isProcessAlive: () => alive,
    platform: 'win32',
    runTaskkill: async () => {
      throw new Error('simulated taskkill spawn failure')
    },
  })

  assert.equal(ptyKillCalls, 1)
  assert.equal(result.terminated, true)
  assert.equal(result.attempts[0]?.error, 'simulated taskkill spawn failure')
})

test('non-Windows cleanup continues to use node-pty directly', async () => {
  let alive = true
  const pty = {
    kill: () => { alive = false },
    pid: 4646,
  } as unknown as IPty

  const result = await terminatePtyProcessTree(pty, {
    isProcessAlive: () => alive,
    platform: 'linux',
  })

  assert.equal(result.terminated, true)
  assert.deepEqual(result.attempts.map((attempt) => attempt.method), ['pty-kill'])
})
