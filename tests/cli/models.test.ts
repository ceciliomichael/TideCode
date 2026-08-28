import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getConfiguredProviderModels,
  resolveCliDefaultModelSelection,
  type SystemModelItem,
  type SystemModelsSnapshot,
} from '../../electron/cli/models'

function configuredModel(apiModelId: string, providerId: SystemModelItem['providerId']): SystemModelItem {
  return {
    apiModelId,
    id: `${providerId}:${apiModelId}`,
    isConfigured: true,
    isCustom: false,
    label: apiModelId,
    providerId,
    providerLabel: providerId,
    reasoningEfforts: ['high', 'medium', 'low'],
    defaultReasoningEffort: 'medium',
  }
}

test('CLI fresh-chat defaults follow the configured model for the active mode', () => {
  const models = [
    configuredModel('chat-default', 'google'),
    configuredModel('agent-default', 'openai'),
    configuredModel('plan-default', 'anthropic'),
  ]
  const settings = {
    agentModelId: 'agent-default',
    agentModelProviderId: 'openai' as const,
    agentReasoningEffort: 'low' as const,
    chatModelId: 'chat-default',
    chatModelProviderId: 'google' as const,
    chatReasoningEffort: 'high' as const,
    planModelId: 'plan-default',
    planModelProviderId: 'anthropic' as const,
    planReasoningEffort: 'high' as const,
  }

  const agentDefault = resolveCliDefaultModelSelection('agent', models, settings)
  const planDefault = resolveCliDefaultModelSelection('plan', models, settings)

  assert.deepEqual(agentDefault, {
    defaultModelId: 'agent-default',
    defaultProviderId: 'openai',
    selectedReasoningEffort: 'low',
  })
  assert.deepEqual(planDefault, {
    defaultModelId: 'plan-default',
    defaultProviderId: 'anthropic',
    selectedReasoningEffort: 'high',
  })
})

test('CLI fresh-chat defaults inherit the chat input model when the mode override is unset', () => {
  const models = [configuredModel('chat-default', 'google')]
  const settings = {
    agentModelId: '',
    agentModelProviderId: null,
    chatModelId: 'chat-default',
    chatModelProviderId: 'google' as const,
    chatReasoningEffort: 'medium' as const,
    planModelId: '',
    planModelProviderId: null,
    agentReasoningEffort: 'low' as const,
    planReasoningEffort: 'high' as const,
  }

  assert.deepEqual(resolveCliDefaultModelSelection('agent', models, settings), {
    defaultModelId: 'chat-default',
    defaultProviderId: 'google',
    selectedReasoningEffort: 'medium',
  })
  assert.deepEqual(resolveCliDefaultModelSelection('plan', models, settings), {
    defaultModelId: 'chat-default',
    defaultProviderId: 'google',
    selectedReasoningEffort: 'medium',
  })
})

test('/model catalog excludes every model owned by an unconfigured provider', () => {
  const readyModel = {
    apiModelId: 'ready-model',
    id: 'openai:ready-model',
    isConfigured: true,
    isCustom: false,
    label: 'Ready model',
    providerId: 'openai' as const,
    providerLabel: 'OpenAI',
  }
  const snapshot: SystemModelsSnapshot = {
    allModels: [
      readyModel,
      { ...readyModel, apiModelId: 'other-ready-model', id: 'openai:other-ready-model', isConfigured: false },
      {
        ...readyModel,
        apiModelId: 'hidden-model',
        id: 'anthropic:hidden-model',
        isConfigured: false,
        providerId: 'anthropic',
        providerLabel: 'Anthropic',
      },
    ],
    configuredModels: [readyModel],
    defaultModelId: readyModel.apiModelId,
    defaultProviderId: readyModel.providerId,
    selectedReasoningEffort: 'medium',
  }

  const visibleModels = getConfiguredProviderModels(snapshot)
  assert.deepEqual(visibleModels.map((model) => model.apiModelId), ['ready-model', 'other-ready-model'])
  assert.ok(visibleModels.every((model) => model.providerId === 'openai'))
})
