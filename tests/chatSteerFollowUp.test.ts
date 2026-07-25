import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canInterruptStreamForSteer,
  getLatestSuccessfulToolCompletionSignal,
} from '../src/pages/chatInterface/chatSteerFollowUp'

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

test('latest successful tool completion ignores failed and running tools', () => {
  assert.equal(
    getLatestSuccessfulToolCompletionSignal([
      {
        completedAt: 20,
        id: 'completed-1',
        startedAt: 10,
        state: 'completed',
      },
      {
        completedAt: 30,
        id: 'failed-1',
        startedAt: 15,
        state: 'failed',
      },
      {
        id: 'running-1',
        startedAt: 40,
        state: 'running',
      },
    ]),
    'completed-1:20',
  )
})

test('latest successful tool completion selects the most recent completion', () => {
  assert.equal(
    getLatestSuccessfulToolCompletionSignal([
      {
        completedAt: 30,
        id: 'completed-older',
        startedAt: 10,
        state: 'completed',
      },
      {
        completedAt: 50,
        id: 'completed-latest',
        startedAt: 20,
        state: 'completed',
      },
    ]),
    'completed-latest:50',
  )
})

test('latest successful tool completion returns null without a successful tool', () => {
  assert.equal(
    getLatestSuccessfulToolCompletionSignal([
      {
        completedAt: 30,
        id: 'failed-1',
        startedAt: 10,
        state: 'failed',
      },
    ]),
    null,
  )
})
