import assert from 'node:assert/strict'
import test from 'node:test'
import { getTaskModelConfigurationSummary } from '../src/components/settings/taskModels/taskModelConfiguration'

test('configuration summary shows inherited chat input setup without a saved effort', () => {
  assert.equal(getTaskModelConfigurationSummary({
    modelId: '',
    modelLabel: '',
    providerId: null,
    reasoningEffort: 'high',
  }), 'Use chat input model')
})

test('configuration summary shows the saved model, provider, and normalized reasoning effort', () => {
  assert.equal(getTaskModelConfigurationSummary({
    defaultReasoningEffort: 'medium',
    modelId: 'gpt-test',
    modelLabel: 'GPT Test',
    providerId: 'openai',
    providerLabel: 'OpenAI',
    reasoningEffort: 'low',
    reasoningEfforts: ['low', 'medium', 'high'],
  }), 'OpenAI · GPT Test · Low')
})

test('configuration summary omits reasoning for models without configurable reasoning', () => {
  assert.equal(getTaskModelConfigurationSummary({
    modelId: 'plain-model',
    modelLabel: 'Plain Model',
    providerId: 'openai',
    providerLabel: 'OpenAI',
    reasoningEffort: 'high',
  }), 'OpenAI · Plain Model')
})
