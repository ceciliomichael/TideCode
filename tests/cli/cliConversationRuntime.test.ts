import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCliConversationRuntime } from '../../electron/cli/cliConversationRuntime'
import type { TerminalScreen } from '../../electron/cli/terminalScreen'
import type { CliSessionState } from '../../electron/cli/types'

test('shared conversation runtime applies thread mode and runtime model to the CLI session', async () => {
  const state: CliSessionState = {
    activeStreamId: null,
    chatMode: 'agent',
    conversationId: 'thread-1',
    isStreaming: false,
    messages: [],
    modelId: 'old-runtime-model',
    providerId: 'codex',
    reasoningEffort: 'medium',
    terminalExecutionMode: 'full',
    workspaceRootPath: 'C:/workspace',
  }
  const sessionUpdates: unknown[] = []
  const composerUpdates: unknown[] = []
  const screen = {
    updateComposerStatus: (patch: unknown) => composerUpdates.push(patch),
    updateSession: (patch: unknown) => sessionUpdates.push(patch),
  } as unknown as TerminalScreen

  const result = await applyCliConversationRuntime(state, screen, {
    chatMode: 'plan',
    conversationId: 'thread-1',
    model: {
      label: 'GPT Test',
      modelId: 'catalog-model',
      providerId: 'openai',
      reasoningEffort: 'high',
      runtimeModelId: 'provider-runtime-model',
    },
    updatedAt: 1,
  })

  assert.equal(state.chatMode, 'plan')
  assert.equal(state.modelId, 'provider-runtime-model')
  assert.equal(state.providerId, 'openai')
  assert.equal(state.reasoningEffort, 'high')
  assert.deepEqual(sessionUpdates, [{
    mode: 'plan',
    model: 'provider-runtime-model',
    provider: 'openai',
  }])
  assert.deepEqual(composerUpdates, [{ reasoningEffort: 'high' }])
  assert.equal(result.refreshCodexUsage, false)
})
