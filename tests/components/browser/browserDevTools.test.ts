import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BROWSER_DEVTOOLS_DOCK_MODES,
  isBrowserDevToolsDockMode,
} from '../../../src/types/browser'

test('browser DevTools exposes the supported native dock modes', () => {
  assert.deepEqual(BROWSER_DEVTOOLS_DOCK_MODES, ['right', 'bottom', 'undocked'])
})

test('browser DevTools dock mode validation rejects unsupported values', () => {
  assert.equal(isBrowserDevToolsDockMode('right'), true)
  assert.equal(isBrowserDevToolsDockMode('bottom'), true)
  assert.equal(isBrowserDevToolsDockMode('undocked'), true)
  assert.equal(isBrowserDevToolsDockMode('detach'), false)
  assert.equal(isBrowserDevToolsDockMode('left'), false)
  assert.equal(isBrowserDevToolsDockMode(''), false)
  assert.equal(isBrowserDevToolsDockMode(null), false)
})
