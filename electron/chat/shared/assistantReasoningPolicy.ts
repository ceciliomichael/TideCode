import type { ChatProviderId } from '../../../src/types/chat'

const PROVIDERS_REQUIRING_ASSISTANT_REASONING_REPLAY: readonly ChatProviderId[] = [
  'deepseek',
  'openai',
]

/**
 * Returns whether provider-visible assistant reasoning must be rebuilt into
 * model messages before an API request is serialized.
 *
 * DeepSeek requires the complete reasoning_content value on assistant turns
 * that contain tool calls. OpenAI-compatible serialization also uses reasoning
 * parts to recreate that field. Plain DeepSeek assistant reasoning is removed
 * later by deepSeekWire.ts because it is not needed on ordinary turns.
 */
export function shouldReplayAssistantReasoning(providerId: ChatProviderId) {
  return PROVIDERS_REQUIRING_ASSISTANT_REASONING_REPLAY.includes(providerId)
}
