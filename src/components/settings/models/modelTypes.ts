import type { BuiltInApiKeyProviderId, ChatProviderId, ReasoningEffort } from '../../../types/chat'

export type ModelProviderId = 'codex' | BuiltInApiKeyProviderId

export interface ModelCatalogItem {
  apiModelId?: string
  defaultReasoningEffort?: ReasoningEffort
  enabledByDefault: boolean
  id: string
  isCustom?: boolean
  label: string
  providerId: ChatProviderId
  reasoningCapable?: boolean
  reasoningBodies?: Partial<Record<ReasoningEffort, Record<string, unknown>>>
  reasoningEfforts?: readonly ReasoningEffort[]
}

export interface ProviderSectionDefinition {
  description: string
  id: ModelProviderId
  label: string
}

export type ModelToggleState = Record<string, boolean>
