export interface CodexProviderConnectionStatus {
  accountId: string | null
  accountKey: string | null
  authFilePath: string
  email: string | null
  accounts: CodexAccountSummary[]
  isAuthenticated: boolean
  lastRefreshAt: string | null
  tokenExpiresAt: string | null
}

export interface CodexUsageWindow {
  usedPercent: number
  limitWindowSeconds: number
  resetAfterSeconds: number
  resetAt: number
}

export interface CodexUsageSnapshot {
  fetchedAt: string
  primary: CodexUsageWindow | null
  secondary: CodexUsageWindow | null
}

export interface CodexAccountSummary {
  accountId: string
  accountKey: string
  email: string | null
  isActive: boolean
  label: string
  lastRefreshAt: string | null
  tokenExpiresAt: string | null
  usage: CodexUsageSnapshot | null
}

export type BuiltInApiKeyProviderId = 'anthropic' | 'deepseek' | 'google' | 'mistral' | 'openai'
export type CustomApiKeyProviderId = `custom:${string}`
export type ApiKeyProviderId = BuiltInApiKeyProviderId | CustomApiKeyProviderId
export type ChatProviderId = 'codex' | ApiKeyProviderId
export type CustomModelProviderId = ChatProviderId
export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | (string & Record<never, never>)

export type ReasoningRequestBodies = Partial<Record<ReasoningEffort, Record<string, unknown>>>

export interface ConfigurableProviderModel {
  apiModelId: string
  defaultReasoningEffort?: ReasoningEffort
  enabledByDefault?: boolean
  extraBody?: Record<string, unknown>
  id?: string
  label?: string
  reasoningCapable?: boolean
  reasoningBodies?: ReasoningRequestBodies
  reasoningEfforts?: ReasoningEffort[]
  maxTokens?: number
  supportsImageInput?: boolean
}

export interface ApiKeyProviderStatus {
  apiKey: string | null
  baseUrl: string | null
  configured: boolean
  extraBody: string
  hasApiKey: boolean
  id: ApiKeyProviderId
  isCustom: boolean
  label: string
  models: ConfigurableProviderModel[]
}

export interface ProvidersState {
  apiKeyProviders: ApiKeyProviderStatus[]
  codex: CodexProviderConnectionStatus
}

export interface SaveApiKeyProviderInput {
  apiKey: string
  baseUrl?: string
  extraBody?: string
  label?: string
  models?: ConfigurableProviderModel[]
  providerId: ApiKeyProviderId
}

export interface CustomModelConfig {
  apiModelId: string
  createdAt: string
  defaultReasoningEffort?: ReasoningEffort
  extraBody?: Record<string, unknown>
  id: string
  label: string
  providerId: CustomModelProviderId
  reasoningCapable: boolean
  reasoningBodies?: ReasoningRequestBodies
  reasoningEfforts?: ReasoningEffort[]
  maxTokens?: number
  supportsImageInput?: boolean
  updatedAt: string
}

export interface SaveCustomModelInput {
  apiModelId: string
  defaultReasoningEffort?: ReasoningEffort
  extraBody?: Record<string, unknown>
  label?: string
  modelId?: string
  providerId: CustomModelProviderId
  reasoningCapable: boolean
  reasoningBodies?: ReasoningRequestBodies
  reasoningEfforts?: ReasoningEffort[]
  maxTokens?: number
  supportsImageInput?: boolean
}

export interface ProviderModelConfig {
  apiModelId: string
  defaultReasoningEffort?: ReasoningEffort
  enabledByDefault: boolean
  extraBody?: Record<string, unknown>
  id: string
  label: string
  providerId: ChatProviderId
  reasoningCapable: boolean
  reasoningBodies?: ReasoningRequestBodies
  maxTokens?: number
  reasoningEfforts?: ReasoningEffort[]
  supportsImageInput?: boolean
}
