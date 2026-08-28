import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTaskModelSelection } from '../src/lib/taskModelSelection'

test('explicit commit model carries its configured low reasoning effort', () => {
  const selection = resolveTaskModelSelection({
    defaultSelection: {
      hasConfiguredProvider: true,
      modelId: 'chat-runtime',
      providerId: 'codex',
      providerLabel: 'Codex',
      reasoningEffort: 'high',
    },
    modelOptions: [{
      defaultReasoningEffort: 'medium',
      id: 'commit-model',
      providerId: 'openai',
      providerLabel: 'OpenAI',
      reasoningEfforts: ['low', 'medium', 'high'],
      runtimeModelId: 'commit-runtime',
    }],
    taskModelId: 'commit-model',
    taskModelProviderId: 'openai',
    taskReasoningEffort: 'low',
  })

  assert.equal(selection.modelId, 'commit-runtime')
  assert.equal(selection.reasoningEffort, 'low')
})

test('task model reasoning is normalized when the saved effort is unsupported', () => {
  const selection = resolveTaskModelSelection({
    defaultSelection: {
      hasConfiguredProvider: true,
      modelId: 'chat-runtime',
      providerId: 'codex',
      providerLabel: 'Codex',
      reasoningEffort: 'high',
    },
    modelOptions: [{
      defaultReasoningEffort: 'medium',
      id: 'summary-model',
      providerId: 'openai',
      providerLabel: 'OpenAI',
      reasoningEfforts: ['low', 'medium'],
      runtimeModelId: 'summary-runtime',
    }],
    taskModelId: 'summary-model',
    taskModelProviderId: 'openai',
    taskReasoningEffort: 'xhigh',
  })

  assert.equal(selection.reasoningEffort, 'medium')
})

test('Use chat input model keeps the active chat reasoning effort', () => {
  const defaultSelection = {
    hasConfiguredProvider: true,
    modelId: 'chat-runtime',
    providerId: 'codex' as const,
    providerLabel: 'Codex',
    reasoningEffort: 'high' as const,
  }
  assert.deepEqual(resolveTaskModelSelection({
    defaultSelection,
    modelOptions: [],
    taskModelId: '',
    taskModelProviderId: null,
    taskReasoningEffort: 'low',
  }), defaultSelection)
})
