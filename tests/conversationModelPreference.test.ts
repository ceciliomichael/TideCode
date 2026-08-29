import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createConversationModelPreference,
  getConversationModeModelPreference,
  mergeConversationModeModelPreference,
} from '../src/lib/conversationModelPreference'

test('preserves the active provider and model when reasoning changes before a conversation preference exists', () => {
  const preference = createConversationModelPreference({
    activeChatMode: 'agent',
    activeSelection: {
      label: 'DeepSeek Reasoner',
      modelId: 'deepseek-reasoner',
      providerId: 'deepseek',
    },
    reasoningEffort: 'high',
  })

  assert.deepEqual(preference, {
    label: 'DeepSeek Reasoner',
    modelId: 'deepseek-reasoner',
    providerId: 'deepseek',
    chatMode: 'agent',
    reasoningEffort: 'high',
    modeSelections: {
      agent: {
        label: 'DeepSeek Reasoner',
        modelId: 'deepseek-reasoner',
        providerId: 'deepseek',
        reasoningEffort: 'high',
      },
    },
  })
})

test('reasoning changes use the existing preference for the active mode only', () => {
  const preference = createConversationModelPreference({
    activeChatMode: 'plan',
    activeSelection: {
      label: 'Current model',
      modelId: 'current-model',
      providerId: 'openai',
    },
    previousPreference: {
      label: 'Saved DeepSeek',
      modelId: 'saved-deepseek',
      providerId: 'deepseek',
      chatMode: 'agent',
      reasoningEffort: 'low',
    },
    reasoningEffort: 'medium',
  })

  assert.deepEqual(preference, {
    label: 'Current model',
    modelId: 'current-model',
    providerId: 'openai',
    chatMode: 'plan',
    reasoningEffort: 'medium',
    modeSelections: {
      agent: {
        label: 'Saved DeepSeek',
        modelId: 'saved-deepseek',
        providerId: 'deepseek',
        reasoningEffort: 'low',
      },
      plan: {
        label: 'Current model',
        modelId: 'current-model',
        providerId: 'openai',
        reasoningEffort: 'medium',
      },
    },
  })
})

test('does not create an invalid empty-model conversation preference', () => {
  const preference = createConversationModelPreference({
    activeChatMode: 'chat',
    activeSelection: {
      label: '',
      modelId: '  ',
      providerId: null,
    },
    reasoningEffort: 'minimal',
  })

  assert.equal(preference, null)
})

test('merging a plan selection preserves the conversation agent selection', () => {
  const agentPreference = mergeConversationModeModelPreference(null, 'agent', {
    label: 'Agent Two',
    modelId: 'agent-2',
    providerId: 'openai',
    reasoningEffort: 'high',
  })
  const combinedPreference = mergeConversationModeModelPreference(agentPreference, 'plan', {
    label: 'Plan Three',
    modelId: 'plan-3',
    providerId: 'codex',
    reasoningEffort: 'low',
  })

  assert.deepEqual(getConversationModeModelPreference(combinedPreference, 'agent'), {
    label: 'Agent Two',
    modelId: 'agent-2',
    providerId: 'openai',
    reasoningEffort: 'high',
  })
  assert.deepEqual(getConversationModeModelPreference(combinedPreference, 'plan'), {
    label: 'Plan Three',
    modelId: 'plan-3',
    providerId: 'codex',
    reasoningEffort: 'low',
  })
})
