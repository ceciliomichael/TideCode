import type {
  ApiKeyProviderId,
  ContextUsageEstimate,
  ProvidersState,
  SaveApiKeyProviderInput,
  SaveCustomModelInput,
  StartChatStreamInput,
  StartChatStreamResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
} from '../src/types/chat'

const RESET_MESSAGE = 'Chat backend has been reset. Rebuild the backend before using this feature.'

function buildEmptyProvidersState(): ProvidersState {
  return {
    apiKeyProviders: [],
    codex: {
      accountId: null,
      accountKey: null,
      accounts: [],
      authFilePath: '',
      email: null,
      isAuthenticated: false,
      lastRefreshAt: null,
      tokenExpiresAt: null,
    },
  }
}

export async function initializeBackendResetState() {}

export async function getResetProvidersState() {
  return buildEmptyProvidersState()
}

export async function addResetCodexAccountWithOAuth() {
  return buildEmptyProvidersState()
}

export async function connectResetCodexWithOAuth() {
  return buildEmptyProvidersState()
}

export async function disconnectResetCodex() {
  return buildEmptyProvidersState()
}

export async function switchResetCodexAccount(accountId: string) {
  void accountId
  return buildEmptyProvidersState()
}

export async function saveResetApiKeyProvider(input: SaveApiKeyProviderInput) {
  void input
  return buildEmptyProvidersState()
}

export async function removeResetApiKeyProvider(providerId: ApiKeyProviderId) {
  void providerId
  return buildEmptyProvidersState()
}

export async function listResetCustomModels() {
  return []
}

export async function listResetProviderModels(providerId: ApiKeyProviderId) {
  void providerId
  return []
}

export async function saveResetCustomModel(input: SaveCustomModelInput) {
  void input
  return []
}

export async function removeResetCustomModel(modelId: string) {
  void modelId
  return []
}

export async function estimateResetChatContextUsage(): Promise<ContextUsageEstimate> {
  return {
    historyTokens: 0,
    maxTokens: 0,
    systemPromptTokens: 0,
    toolSchemaTokens: 0,
    toolResultsTokens: 0,
    totalTokens: 0,
  }
}

export async function startResetChatStream(input: StartChatStreamInput): Promise<StartChatStreamResult> {
  void input
  throw new Error(RESET_MESSAGE)
}

export async function cancelResetChatStream(streamId: string) {
  void streamId
}

export async function submitResetToolDecision(input: SubmitToolDecisionInput): Promise<SubmitToolDecisionResult> {
  void input
  throw new Error(RESET_MESSAGE)
}
