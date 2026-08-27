import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { ChatProviderId } from '../../../src/types/chat'

export type OpenAIResponsesSystemPromptTransport = ProviderOptions & {
  openai: {
    instructions: string
    systemMessageMode: 'remove'
  }
}

/**
 * TideCode owns one canonical system prompt. Provider adapters may only choose
 * how that exact string is carried on the wire. OpenAI Responses transports
 * use top-level instructions and remove the duplicate system/developer item.
 */
export function resolveSystemPromptTransportProviderOptions(
  providerId: ChatProviderId,
  system?: string,
): OpenAIResponsesSystemPromptTransport | undefined {
  if (!system || (providerId !== 'openai' && providerId !== 'codex')) {
    return undefined
  }

  return {
    openai: {
      instructions: system,
      systemMessageMode: 'remove',
    },
  }
}
