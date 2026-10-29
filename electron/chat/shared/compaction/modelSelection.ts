import type { ChatProviderId, ReasoningEffort } from '../../../../src/types/chat'
import { resolveReasoningEffortTransition } from '../../../../src/lib/reasoningEffortTransition'
import { getStoredSettings } from '../../../settings/store'
import { getTideCodeSystemModels } from '../../../cli/models'
import { createCodexClient } from '../../codex/client'
import { createApiKeyChatClient } from '../../apiKey/client'
import { readApiKeyChatProviderConfig } from '../../apiKey/config'
import { isApiKeyProviderId } from '../../../providers/providerIds'
import type { CompactionStreamFactory } from './contracts'
import { resolveContextCapabilities, resolveStoredOutputMaximum } from '../contextCapabilities'
import { prepareContextRequest } from '../contextRequest'
import { approximateTokenCount } from '../../../../src/lib/contextUsage'
import { requiresContextCompaction } from './budget'
import { CompactionError } from './gate'

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
  contextWindowTokens = 200_000,
): Promise<CompactionStreamFactory> {
  if (providerId === 'codex') {
    const client = createCodexClient()
    return budgetCompactionStream((input) => client.chat.completions.create({
      cacheKey: `${cacheKey}:${input.operation ?? 'handoff'}`,
      onStepEnd: input.onStepEnd,
      maxOutputTokens: input.maxOutputTokens,
      messages: input.messages,
      model: input.model,
      reasoningEffort: input.reasoningEffort as ReasoningEffort,
      signal: input.signal,
      system: input.system,
    }), providerId, contextWindowTokens)
  }

  if (!isApiKeyProviderId(providerId)) {
    throw new Error(`Unsupported summarization provider: ${providerId}`)
  }

  const config = await readApiKeyChatProviderConfig(providerId)
  const client = createApiKeyChatClient(config)
  return budgetCompactionStream((input) => client.chat.completions.create({
    cacheKey: `${cacheKey}:${input.operation ?? 'handoff'}`,
    onStepEnd: input.onStepEnd,
    maxOutputTokens: input.maxOutputTokens,
    messages: input.messages,
    model: input.model,
    reasoningEffort: input.reasoningEffort as ReasoningEffort,
    signal: input.signal,
    system: input.system,
  }), providerId, contextWindowTokens)
}


export function budgetCompactionStream(
  createStream: CompactionStreamFactory,
  providerId: ChatProviderId,
  contextWindowTokens: number,
): CompactionStreamFactory {
  return async (input) => {
    const storedOutputMaximum = await resolveStoredOutputMaximum(providerId, input.model)
    const capabilities = resolveContextCapabilities({
      providerId,
      modelId: input.model,
      contextWindowTokens,
      maximumOutputTokens: Math.min(input.maxOutputTokens ?? Infinity, storedOutputMaximum ?? Infinity),
    })
    const request = prepareContextRequest({
      messages: input.messages,
      capabilities,
      systemPromptTokens: approximateTokenCount(input.system),
      toolSchemaTokens: 0,
      triggerRatio: 0.8,
    })
    if (requiresContextCompaction(request.state.budget)) {
      throw new CompactionError('summarizer_context_too_large')
    }
    return createStream({ ...input, maxOutputTokens: capabilities.maxOutputTokens })
  }
}
