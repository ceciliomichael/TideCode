import assert from 'node:assert/strict'
import test from 'node:test'
import type { IPty } from 'node-pty'
import {
  appendSessionOutputBuffer,
  consumePendingAiOutput,
  MAX_SESSION_OUTPUT_BUFFER_LENGTH,
  type ActiveTerminalSession,
} from '../../electron/terminal/sessionModel'

function createTestSession(): ActiveTerminalSession {
  return {
    aiTurnId: null,
    capturePendingAiOutput: true,
    cwd: '/workspace',
    exitCode: null,
    hasExited: false,
    isAiSession: true,
    label: null,
    outputBuffer: '',
    pendingAiOutputChunks: [],
    outputWaiters: new Set(),
    ownerWebContentsId: 1,
    ptyProcess: {} as IPty,
    shellLabel: 'test-shell',
    signal: null,
    venvName: null,
    workspaceRootPath: '/workspace',
    workspaceSessionKey: 'test-session',
  }
}

test('broker-style sessions do not retain obsolete pending AI output chunks', () => {
  const session = createTestSession()
  session.capturePendingAiOutput = false

  appendSessionOutputBuffer(session, 'broker-owned output')

  assert.equal(session.outputBuffer, 'broker-owned output')
  assert.deepEqual(session.pendingAiOutputChunks, [])
  assert.equal(consumePendingAiOutput(session), '')
})

test('AI output remains available after the bounded display buffer rolls over', () => {
  const session = createTestSession()
  const retainedDisplayOutput = 'd'.repeat(MAX_SESSION_OUTPUT_BUFFER_LENGTH)
  const rolloverOutput = 'r'.repeat(128)

  appendSessionOutputBuffer(session, retainedDisplayOutput)
  appendSessionOutputBuffer(session, rolloverOutput)

  assert.equal(session.outputBuffer.length, MAX_SESSION_OUTPUT_BUFFER_LENGTH)
  assert.equal(
    session.pendingAiOutputChunks.join(''),
    `${retainedDisplayOutput}${rolloverOutput}`,
  )
  assert.equal(
    consumePendingAiOutput(session),
    `${retainedDisplayOutput}${rolloverOutput}`,
  )
  assert.deepEqual(session.pendingAiOutputChunks, [])
})

test('snapshot consumption leaves output appended after the snapshot queued', () => {
  const session = createTestSession()

  appendSessionOutputBuffer(session, 'before-marker')
  const snapshotLength = session.pendingAiOutputChunks.join('').length
  appendSessionOutputBuffer(session, '__EDONE_marker__:0\r\n')

  assert.equal(
    consumePendingAiOutput(session, snapshotLength),
    'before-marker',
  )
  assert.deepEqual(session.pendingAiOutputChunks, ['__EDONE_marker__:0\r\n'])
  assert.equal(
    consumePendingAiOutput(session, '__EDONE_marker__:0\r\n'.length),
    '__EDONE_marker__:0\r\n',
  )
  assert.deepEqual(session.pendingAiOutputChunks, [])
})
