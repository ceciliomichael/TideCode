import type { ChatProviderId, ReasoningEffort, ReasoningRequestBodies } from '../../../src/types/chat'

export interface ProviderModelDefinition {
  apiModelId?: string
  defaultReasoningEffort?: ReasoningEffort
  enabledByDefault?: boolean
  id: string
  label?: string
  maxTokens?: number
  reasoningCapable?: boolean
  reasoningBodies?: ReasoningRequestBodies
  reasoningEfforts?: readonly ReasoningEffort[]
}

export interface ProviderModelJsonSource {
  readonly models: readonly ProviderModelDefinition[]
}

export type ProviderModelSourceId = ChatProviderId
