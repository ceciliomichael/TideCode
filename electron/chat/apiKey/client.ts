import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  streamText,
  type LanguageModel,
  type ModelMessage,
  type PrepareStepFunction,
  type StopCondition,
  type ToolCallRepairFunction,
  type ToolSet,
} from 'ai'
import type { ReasoningEffort } from '../../../src/types/chat'
import { findCatalogModel } from '../../models/catalog/catalog'
import { isCustomApiKeyProviderId } from '../../providers/providerIds'
import { mergeProviderOptions, resolvePromptCacheExtraBody, resolvePromptCacheProviderOptions } from '../cache/providerPolicies'
import { normalizeLanguageModelUsage } from '../cache/usage'
import type { ProviderStepRecord } from '../history/contracts'
import type { ApiKeyChatProviderConfig } from './config'
import { normalizeDeepSeekRequestBody } from './deepSeekWire'
import { createExtraBodyFetch } from './requestBody'
import {
  mergeRequestExtras,
  resolveModelExtraBody,
  resolveProviderReasoningOptions,
  resolveReasoningExtraBody,
} from './reasoning'

export interface ApiKeyChatCompletionsCreateInput {
  cacheKey?: string
  maxOutputTokens?: number
  messages: ModelMessage[]
  model: string
  reasoningEffort: ReasoningEffort
  signal?: AbortSignal
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  maxSteps?: number
  system?: string
  repairToolCall?: ToolCallRepairFunction<ToolSet>
  tools?: ToolSet
  onStepEnd?: (step: ProviderStepRecord) => void | Promise<void>
  prepareStep?: PrepareStepFunction<ToolSet>
}

function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/u, '')
}

function normalizeCompatibleBaseUrl(baseUrl: string, appendVersion = false) {
  const parsedUrl = new URL(baseUrl)
  const normalizedPath = stripTrailingSlashes(parsedUrl.pathname)
  if (appendVersion && !normalizedPath.endsWith('/v1')) {
    parsedUrl.pathname = `${normalizedPath || ''}/v1`
  }
  parsedUrl.hash = ''
  return stripTrailingSlashes(parsedUrl.toString())
}

function createModelFactory(
  config: ApiKeyChatProviderConfig,
  modelId: string,
  reasoningEffort: ReasoningEffort,
  cacheKey?: string,
): (modelId: string) => LanguageModel {
  const fetchWithExtraBody = createExtraBodyFetch(
    mergeRequestExtras(
      mergeRequestExtras(
        mergeRequestExtras(config.extraBody, resolveModelExtraBody(config, modelId)),
        resolveReasoningExtraBody(config, modelId, reasoningEffort),
      ),
      cacheKey ? resolvePromptCacheExtraBody({ cacheKey, providerId: config.providerId }) : {},
    ),
    fetch,
    config.providerId === 'deepseek' ? normalizeDeepSeekRequestBody : undefined,
  )
  const baseURL = stripTrailingSlashes(config.baseUrl)

  switch (config.providerId) {
    case 'openai':
      return (modelId) => createOpenAI({ apiKey: config.apiKey, baseURL, fetch: fetchWithExtraBody }).responses(modelId)
    case 'anthropic':
      return (modelId) => createAnthropic({ apiKey: config.apiKey, baseURL, fetch: fetchWithExtraBody })(modelId)
    case 'google':
      return (modelId) => createGoogle({ apiKey: config.apiKey, baseURL, fetch: fetchWithExtraBody })(modelId)
    case 'mistral':
      return (modelId) => createMistral({ apiKey: config.apiKey, baseURL, fetch: fetchWithExtraBody })(modelId)
    default: {
      const appendVersion = isCustomApiKeyProviderId(config.providerId)
      const provider = createOpenAICompatible({
        apiKey: config.apiKey || undefined,
        baseURL: normalizeCompatibleBaseUrl(baseURL, appendVersion),
        fetch: fetchWithExtraBody,
        name: 'openai-compatible',
      })
      return (modelId) => provider.chatModel(modelId)
    }
  }
}

export function createApiKeyChatClient(config: ApiKeyChatProviderConfig) {
  async function createChatCompletionStream(input: ApiKeyChatCompletionsCreateInput) {
    const modelFactory = createModelFactory(config, input.model, input.reasoningEffort, input.cacheKey)
    const model = modelFactory(input.model)
    const providerOptions = mergeProviderOptions(
      resolveProviderReasoningOptions(config, input.model, input.reasoningEffort),
      input.cacheKey
        ? resolvePromptCacheProviderOptions({ cacheKey: input.cacheKey, providerId: config.providerId })
        : undefined,
    )
    const normalizedModelId = input.model.trim().toLowerCase()
    const catalogModel = findCatalogModel(config.providerId, normalizedModelId)
    const modelConfig = catalogModel ?? config.models.find(
      (model) => model.apiModelId.trim().toLowerCase() === normalizedModelId,
    )
    const maxOutputTokens = input.maxOutputTokens === undefined
      ? modelConfig?.maxTokens
      : modelConfig?.maxTokens === undefined
        ? input.maxOutputTokens
        : Math.min(input.maxOutputTokens, modelConfig.maxTokens)

    return streamText({
      ...(input.stopWhen ? { stopWhen: input.stopWhen } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      ...(input.repairToolCall ? { repairToolCall: input.repairToolCall } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      model,
      messages: input.messages,
      temperature: 0.1,
      ...(input.system ? { system: input.system } : {}),
      ...(input.tools ? { tools: input.tools } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(input.onStepEnd
        ? {
            onStepEnd: (step) => input.onStepEnd?.({
              finishReason: step.finishReason,
              durationMs: step.performance.stepTimeMs,
              providerMetadata: step.providerMetadata,
              responseMessages: step.response.messages,
              stepNumber: step.stepNumber,
              usage: normalizeLanguageModelUsage(step.usage),
            }),
          }
        : {}),
      ...(input.prepareStep ? { prepareStep: input.prepareStep } : {}),
      abortSignal: input.signal,
    })
  }

  return {
    chat: {
      completions: {
        create: createChatCompletionStream,
      },
    },
  }
}
