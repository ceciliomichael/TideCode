import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampTerminalPollingMs,
  MAX_TERMINAL_POLLING_MS,
} from '../../electron/terminal/configuration'

test('terminal polling defaults to and never exceeds the five-minute read limit', () => {
  assert.equal(clampTerminalPollingMs(undefined), MAX_TERMINAL_POLLING_MS)
  assert.equal(clampTerminalPollingMs(MAX_TERMINAL_POLLING_MS + 1), MAX_TERMINAL_POLLING_MS)
  assert.equal(clampTerminalPollingMs(Number.POSITIVE_INFINITY), 0)
  assert.equal(clampTerminalPollingMs(-1), 0)
})
