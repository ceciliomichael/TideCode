import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, type ModelMessage, type StopCondition, type ToolSet } from 'ai'
import type { ReasoningEffort } from '../../../src/types/chat'

export interface OpenAICompatibleClientConfig {
  apiKey: string
  baseUrl: string
}

function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '')
}

function stripAuthorizationHeader(headers: HeadersInit | undefined) {
  const nextHeaders = new Headers(headers)
  nextHeaders.delete('authorization')
  return nextHeaders
}

export interface OpenAICompatibleModelListResponse {
  data: Array<{ id?: string }>
}

export interface OpenAICompatibleChatCompletionsCreateInput {
  model: string
  messages: ModelMessage[]
  reasoningEffort: ReasoningEffort
  signal?: AbortSignal
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  maxSteps?: number
  system?: string
  tools?: ToolSet
}

export function normalizeOpenAICompatibleBaseUrl(baseUrl: string) {
  const normalizedInput = baseUrl.trim()
  if (!normalizedInput) {
    throw new Error('Base URL is required.')
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(normalizedInput)
  } catch {
    throw new Error('Base URL must be a valid absolute URL.')
  }

  const normalizedPathname = stripTrailingSlashes(parsedUrl.pathname)
  parsedUrl.pathname =
    normalizedPathname.length === 0 || normalizedPathname === '/'
      ? '/v1'
      : normalizedPathname.endsWith('/v1')
        ? normalizedPathname
        : `${normalizedPathname}/v1`

  parsedUrl.hash = ''
  return stripTrailingSlashes(parsedUrl.toString())
}

export function createOpenAICompatibleClient(config: OpenAICompatibleClientConfig) {
  const apiKey = config.apiKey.trim()
  const hasApiKey = apiKey.length > 0
  const baseURL = normalizeOpenAICompatibleBaseUrl(config.baseUrl)
  const headers = hasApiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
  const provider = createOpenAICompatible({
    apiKey: hasApiKey ? apiKey : undefined,
    baseURL,
    name: 'openai-compatible',
    headers,
    fetch: async (input, init) => {
      const nextInit =
        hasApiKey || !init
          ? init
          : {
              ...init,
              headers: stripAuthorizationHeader(init.headers),
            }

      return fetch(input, nextInit)
    },
  })

  async function listModels(): Promise<OpenAICompatibleModelListResponse> {
    const response = await fetch(`${baseURL}/models`, {
      headers,
    })

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`)
    }

    return response.json()
  }

  async function createChatCompletionStream(
    input: OpenAICompatibleChatCompletionsCreateInput,
  ) {
    const model = provider.chatModel(input.model)
    return streamText({
      ...(input.stopWhen ? { stopWhen: input.stopWhen } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      model,
      messages: input.messages,
      ...(input.system ? { system: input.system } : {}),
      ...(input.tools ? { tools: input.tools } : {}),
      providerOptions: {
        openaiCompatible: {
          reasoningEffort: input.reasoningEffort,
        },
      },
      abortSignal: input.signal,
    })
  }

  return {
    models: {
      list: listModels,
    },
    chat: {
      completions: {
        create: createChatCompletionStream,
      },
    },
  }
}
