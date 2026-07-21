import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, type LanguageModel, type ModelMessage, type StopCondition, type ToolSet } from 'ai'
import type { ReasoningEffort } from '../../../src/types/chat'
import { isCustomApiKeyProviderId } from '../../providers/providerIds'
import type { ApiKeyChatProviderConfig } from './config'
import { createExtraBodyFetch } from './requestBody'
import { mergeRequestExtras, resolveProviderReasoningOptions, resolveReasoningExtraBody } from './reasoning'

export interface ApiKeyChatCompletionsCreateInput {
  messages: ModelMessage[]
  model: string
  reasoningEffort: ReasoningEffort
  signal?: AbortSignal
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  maxSteps?: number
  system?: string
  tools?: ToolSet
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
): (modelId: string) => LanguageModel {
  const fetchWithExtraBody = createExtraBodyFetch(
    mergeRequestExtras(config.extraBody, resolveReasoningExtraBody(config, modelId, reasoningEffort)),
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
    const modelFactory = createModelFactory(config, input.model, input.reasoningEffort)
    const model = modelFactory(input.model)
    const providerOptions = resolveProviderReasoningOptions(config, input.model, input.reasoningEffort)

    return streamText({
      ...(input.stopWhen ? { stopWhen: input.stopWhen } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      model,
      messages: input.messages,
      ...(input.system ? { system: input.system } : {}),
      ...(input.tools ? { tools: input.tools } : {}),
      ...(providerOptions ? { providerOptions } : {}),
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
