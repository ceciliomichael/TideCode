import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCliReasoningEffortSettingsUpdate } from '../../electron/cli/cliReasoningEffortSettings'
import type { CliSessionState } from '../../electron/cli/types'
import { DEFAULT_APP_SETTINGS } from '../../src/lib/defaultAppSettings'

function createState(): CliSessionState {
  return {
    activeStreamId: null,
    chatMode: 'agent',
    conversationId: 'conversation-1',
    isStreaming: false,
    messages: [],
    modelId: 'gpt-test',
    providerId: 'openai',
    reasoningEffort: 'medium',
    terminalExecutionMode: 'full',
    workspaceRootPath: 'C:/workspace',
  }
}

test('/effort builds the same global and conversation settings update used by desktop', () => {
  const update = buildCliReasoningEffortSettingsUpdate(
    createState(),
    DEFAULT_APP_SETTINGS,
    'high',
    'GPT Test',
    true,
  )

  assert.equal(update.chatReasoningEffort, 'high')
  assert.deepEqual(update.conversationModelPreferences?.['conversation-1'], {
    chatMode: 'agent',
    label: 'GPT Test',
    modelId: 'gpt-test',
    providerId: 'openai',
    reasoningEffort: 'high',
  })
})

test('/effort on a new draft updates the global preference without creating an orphan conversation preference', () => {
  const update = buildCliReasoningEffortSettingsUpdate(
    createState(),
    DEFAULT_APP_SETTINGS,
    'low',
    'GPT Test',
    false,
  )

  assert.deepEqual(update, { chatReasoningEffort: 'low' })
})
