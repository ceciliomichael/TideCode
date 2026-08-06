import type { ChatProviderId } from '../../../src/types/chat'
import { resolveProviderReasoningCapability } from './compaction/reasoning'

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
  return resolveProviderReasoningCapability({ modelId: 'provider-default', providerId }).mode === 'provider_native'
}

export function resolveAssistantReasoningReplayPolicy(input: {
  modelId: string
  providerId: ChatProviderId
  exactReplayAvailable?: boolean
}) {
  return resolveProviderReasoningCapability(input)
}
