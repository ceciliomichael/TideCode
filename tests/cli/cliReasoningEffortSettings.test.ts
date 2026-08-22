import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCliReasoningEffortSettingsUpdate } from '../../electron/cli/cliReasoningEffortSettings'
test('/effort persists only the CLI surface reasoning preference', () => {
  assert.deepEqual(buildCliReasoningEffortSettingsUpdate('high'), { chatReasoningEffort: 'high' })
  assert.deepEqual(buildCliReasoningEffortSettingsUpdate('low'), { chatReasoningEffort: 'low' })
})
