import { createOpenAI } from '@ai-sdk/openai'
import { streamText, type ModelMessage, type StopCondition, type ToolSet } from 'ai'
import type { ReasoningEffort } from '../../../src/types/chat'
import { buildCodexProviderOptions } from './providerOptions'
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
  messages: ModelMessage[]
  model: string
  reasoningEffort: ReasoningEffort
  signal?: AbortSignal
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  maxSteps?: number
  system?: string
  tools?: ToolSet
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

      return fetch(input, {
        ...init,
        headers: nextHeaders,
      })
    },
  })

  async function createChatCompletionStream(
    input: CodexChatCompletionsCreateInput,
  ) {
    return streamText({
      ...(input.stopWhen ? { stopWhen: input.stopWhen } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      model: provider.responses(input.model),
      messages: input.messages,
      ...(input.system ? { system: input.system } : {}),
      ...(input.tools ? { tools: input.tools } : {}),
      providerOptions: buildCodexProviderOptions(input),
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
