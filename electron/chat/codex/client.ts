import { createOpenAI } from '@ai-sdk/openai'
import {
  streamText,
  type ModelMessage,
  type PrepareStepFunction,
  type StopCondition,
  type ToolCallRepairFunction,
  type ToolSet,
} from 'ai'
import type { ReasoningEffort } from '../../../src/types/chat'
import { normalizeLanguageModelUsage } from '../cache/usage'
import type { ProviderStepRecord } from '../history/contracts'
import { buildCodexProviderOptions } from './providerOptions'
import { normalizeCodexRequestBody } from './requestNormalization'
import { refreshCodexOAuthTokensIfNeeded } from '../../providers/codex/refresh'
import { maybeRotateCodexAccountForChat } from '../../providers/codex/service'
import { writeStoredCodexAuthData, type StoredCodexAuthData } from '../../providers/codex/store'

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const DUMMY_API_KEY = 'codex-oauth-placeholder'

function stripAuthorizationHeader(headers: HeadersInit | undefined) {
  const nextHeaders = new Headers(headers)
  nextHeaders.delete('authorization')
  return nextHeaders
}

async function resolveCodexAuthData(): Promise<StoredCodexAuthData> {
  const storedAuthData = await maybeRotateCodexAccountForChat()
  if (!storedAuthData) {
    throw new Error('Codex is not connected. Sign in from Settings before starting a chat.')
  }

  const refreshedAuthData = await refreshCodexOAuthTokensIfNeeded(storedAuthData)
  if (
    refreshedAuthData.tokens.access_token !== storedAuthData.tokens.access_token ||
    refreshedAuthData.tokens.refresh_token !== storedAuthData.tokens.refresh_token ||
    refreshedAuthData.tokens.id_token !== storedAuthData.tokens.id_token ||
    refreshedAuthData.expires_at !== storedAuthData.expires_at ||
    refreshedAuthData.last_refresh !== storedAuthData.last_refresh
  ) {
    await writeStoredCodexAuthData(refreshedAuthData)
  }

  return refreshedAuthData
}

export interface CodexChatCompletionsCreateInput {
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

export function createCodexClient() {
  const provider = createOpenAI({
    apiKey: DUMMY_API_KEY,
    baseURL: CODEX_BASE_URL,
    name: 'codex',
    fetch: async (input, init) => {
      const authData = await resolveCodexAuthData()
      const nextHeaders = stripAuthorizationHeader(init?.headers)
      nextHeaders.set('authorization', `Bearer ${authData.tokens.access_token}`)
      nextHeaders.set('chatgpt-account-id', authData.tokens.account_id)

      let nextBody = init?.body

      // The Vercel AI SDK may pass the body as a string, Buffer, Uint8Array, or ArrayBuffer.
      // Decode all binary variants to a UTF-8 string so the JSON interceptor always executes.
      let bodyString: string | null = null
      if (typeof nextBody === 'string') {
        bodyString = nextBody
      } else if (nextBody instanceof Uint8Array || Buffer.isBuffer(nextBody)) {
        bodyString = Buffer.from(nextBody as Uint8Array).toString('utf-8')
      } else if (nextBody instanceof ArrayBuffer) {
        bodyString = Buffer.from(nextBody).toString('utf-8')
      }

      if (bodyString !== null) {
        nextBody = normalizeCodexRequestBody(bodyString)
      }

      return fetch(input, {
        ...init,
        headers: nextHeaders,
        body: nextBody,
      })
    },
  })
  async function createChatCompletionStream(
    input: CodexChatCompletionsCreateInput,
  ) {
    return streamText({
      ...(input.stopWhen ? { stopWhen: input.stopWhen } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
      ...(input.repairToolCall ? { repairToolCall: input.repairToolCall } : {}),
      model: provider.responses(input.model),
      messages: input.messages,
      ...(input.system ? { system: input.system } : {}),
      ...(input.tools ? { tools: input.tools } : {}),
      providerOptions: buildCodexProviderOptions(input),
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
