import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationModelPreference } from '../src/lib/conversationModelPreference'

test('preserves the active provider and model when reasoning changes before a conversation preference exists', () => {
  const preference = createConversationModelPreference({
    activeChatMode: 'chat',
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
    chatMode: 'chat',
    reasoningEffort: 'high',
  })
})

test('keeps an existing conversation model preference while changing only reasoning effort', () => {
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
      chatMode: 'chat',
      reasoningEffort: 'low',
    },
    reasoningEffort: 'medium',
  })

  assert.deepEqual(preference, {
    label: 'Saved DeepSeek',
    modelId: 'saved-deepseek',
    providerId: 'deepseek',
    chatMode: 'chat',
    reasoningEffort: 'medium',
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
