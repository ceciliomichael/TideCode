import assert from 'node:assert/strict'
import test from 'node:test'
import { canInterruptStreamForSteer } from '../src/pages/chatInterface/chatSteerFollowUp'

test('steer can interrupt a plain streaming response immediately', () => {
  assert.equal(canInterruptStreamForSteer([]), true)
})

test('steer waits for a running terminal tool to finish', () => {
  assert.equal(
    canInterruptStreamForSteer([
      {
        state: 'running',
        toolName: 'get_terminal_output',
      },
    ]),
    false,
  )
})

test('steer waits for any running tool to finish', () => {
  assert.equal(
    canInterruptStreamForSteer([
      {
        state: 'running',
        toolName: 'read',
      },
    ]),
    false,
  )
})

test('steer can interrupt once tool execution has settled', () => {
  assert.equal(
    canInterruptStreamForSteer([
      {
        state: 'completed',
        toolName: 'execute_terminal',
      },
      {
        state: 'failed',
        toolName: 'grep',
      },
    ]),
    true,
  )
})
