import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfiguredProviderModels, type SystemModelsSnapshot } from '../../electron/cli/models'

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
