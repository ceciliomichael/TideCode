import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendTerminalReplayBuffer,
  boundTerminalReplayBuffer,
} from '../../src/components/chat/workspaceTerminalPanel/terminalOutputBuffer'

test('terminal replay buffer retains only the newest bounded output', () => {
  assert.equal(appendTerminalReplayBuffer('1234', '5678', 6), '345678')
  assert.equal(appendTerminalReplayBuffer('old', 'abcdefgh', 5), 'defgh')
})

test('terminal replay buffer bounding preserves already-small content', () => {
  assert.equal(boundTerminalReplayBuffer('abc', 5), 'abc')
  assert.equal(boundTerminalReplayBuffer('abcdefgh', 5), 'defgh')
})
