import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveUpdatedConversationRuntimeModel } from '../src/lib/conversationRuntimeModel'

const previousModel = {
  label: 'Plan Model',
  modelId: 'plan-model',
  providerId: 'anthropic' as const,
  reasoningEffort: 'high' as const,
}

test('mode-only runtime updates do not carry the previous mode model forward', () => {
  assert.equal(resolveUpdatedConversationRuntimeModel({
    hasModeUpdate: true,
    previousModel,
  }), null)
})

test('model-only runtime updates retain the previous model when no replacement is supplied', () => {
  assert.deepEqual(resolveUpdatedConversationRuntimeModel({
    hasModeUpdate: false,
    previousModel,
  }), previousModel)
})

test('an explicit target-mode model wins during a mode update', () => {
  const agentModel = {
    label: 'Agent Model',
    modelId: 'agent-model',
    providerId: 'openai' as const,
    reasoningEffort: 'medium' as const,
  }

  assert.deepEqual(resolveUpdatedConversationRuntimeModel({
    hasModeUpdate: true,
    model: agentModel,
    previousModel,
  }), agentModel)
})
