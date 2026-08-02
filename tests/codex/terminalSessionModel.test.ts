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
    cwd: '/workspace',
    enableIdleTimeout: false,
    exitCode: null,
    hasExited: false,
    idleTimerId: null,
    isAiSession: true,
    label: null,
    lastReadAt: Date.now(),
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
