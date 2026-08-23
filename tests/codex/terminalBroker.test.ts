import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

test('Windows cleanup falls back to node-pty when taskkill returns nonzero', () => {
  let alive = true
  let ptyKillCalls = 0
  const pty = {
    kill: () => {
      ptyKillCalls += 1
      alive = false
    },
    pid: 4242,
  } as unknown as IPty
  const failedSpawn = (() => ({
    error: undefined,
    output: [],
    pid: 1,
    signal: null,
    status: 1,
    stderr: '',
    stdout: '',
  })) as unknown as typeof spawnSync

  const result = terminatePtyProcessTree(pty, {
    isProcessAlive: () => alive,
    platform: 'win32',
    spawn: failedSpawn,
    systemRoot: 'C:\\Windows',
  })

  assert.equal(ptyKillCalls, 1)
  assert.equal(result.terminated, true)
  assert.deepEqual(result.attempts.map((attempt) => attempt.method), ['taskkill', 'pty-kill'])
  assert.match(result.attempts[0]?.error ?? '', /status 1/u)
})

test('Windows cleanup retains a failed result when both termination mechanisms fail', () => {
  const pty = {
    kill: () => {
      throw new Error('pty kill failed')
    },
    pid: 4343,
  } as unknown as IPty
  const failedSpawn = (() => ({
    error: undefined,
    output: [],
    pid: 1,
    signal: null,
    status: 5,
    stderr: '',
    stdout: '',
  })) as unknown as typeof spawnSync

  const result = terminatePtyProcessTree(pty, {
    isProcessAlive: () => true,
    platform: 'win32',
    spawn: failedSpawn,
  })

  assert.equal(result.terminated, false)
  assert.equal(result.attempts[1]?.error, 'pty kill failed')
})
