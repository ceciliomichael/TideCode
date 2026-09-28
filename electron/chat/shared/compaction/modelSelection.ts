import type { ChatProviderId, ReasoningEffort } from '../../../../src/types/chat'
import { resolveReasoningEffortTransition } from '../../../../src/lib/reasoningEffortTransition'
import { getStoredSettings } from '../../../settings/store'
import { getTideCodeSystemModels } from '../../../cli/models'
import { createCodexClient } from '../../codex/client'
import { createApiKeyChatClient } from '../../apiKey/client'
import { readApiKeyChatProviderConfig } from '../../apiKey/config'
import { isApiKeyProviderId } from '../../../providers/providerIds'
import type { CompactionStreamFactory } from './contracts'

export interface CompactionModelSelection {
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
}

export async function resolveCompactionModelSelection(input: CompactionModelSelection) {
  const settings = await getStoredSettings()
  const configuredModelId = settings.summarizationModelId.trim()
  const configuredProviderId = settings.summarizationModelProviderId

  if (!configuredModelId || configuredProviderId === null) {
    return input
  }

  const models = await getTideCodeSystemModels()
  const selectedModel = models.allModels.find((model) => (
    model.providerId === configuredProviderId &&
    (model.id === configuredModelId || model.apiModelId === configuredModelId)
  ))

  if (!selectedModel || !selectedModel.isConfigured) {
    return input
  }

  return {
    modelId: selectedModel.apiModelId,
    providerId: selectedModel.providerId,
    reasoningEffort: resolveReasoningEffortTransition({
      currentEffort: settings.summarizationReasoningEffort,
      defaultEffort: selectedModel.defaultReasoningEffort,
      supportedEfforts: selectedModel.reasoningEfforts,
    }),
  }
}

export async function createCompactionStreamFactory(
  providerId: ChatProviderId,
  cacheKey: string,
): Promise<CompactionStreamFactory> {
  if (providerId === 'codex') {
    const client = createCodexClient()
    return (input) => client.chat.completions.create({
      cacheKey,
      maxOutputTokens: input.maxOutputTokens,
      messages: input.messages,
      model: input.model,
      reasoningEffort: input.reasoningEffort as ReasoningEffort,
      signal: input.signal,
      system: input.system,
    })
  }

  if (!isApiKeyProviderId(providerId)) {
    throw new Error(`Unsupported summarization provider: ${providerId}`)
  }

  const config = await readApiKeyChatProviderConfig(providerId)
  const client = createApiKeyChatClient(config)
  return (input) => client.chat.completions.create({
    cacheKey,
    maxOutputTokens: input.maxOutputTokens,
    messages: input.messages,
    model: input.model,
    reasoningEffort: input.reasoningEffort as ReasoningEffort,
    signal: input.signal,
    system: input.system,
  })
}
