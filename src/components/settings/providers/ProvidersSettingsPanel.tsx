import { useEffect, useMemo, useState } from 'react'
import type { ApiKeyProviderId, ProvidersState, SaveApiKeyProviderInput } from '../../../types/chat'
import { ApiKeyProviderAccordion, type ProviderActionFeedback } from './ApiKeyProviderAccordion'
import { CodexProviderAccordion } from './CodexProviderAccordion'
import {
  buildInitialDraftMap,
  isValidMaxTokens,
  isValidTemperature,
  normalizeOptionalIntegerInput,
  normalizeOptionalNumericInput,
  operationForProvider,
} from './providerDraftUtils'
import { readProviderDefaults, writeProviderDefaults } from './providerLocalDefaults'
import { getApiKeyProviderSchema } from './providerSchemas'
import type { ApiKeyProviderDraft } from './providerTypes'
import { SettingsPanelLayout, SettingsSection } from '../shared/SettingsPanelPrimitives'
import { PRIMARY_ACTION_BUTTON_CLASS_NAME } from '../shared/actionButtonStyles'

interface ProvidersSettingsPanelProps {
  activeOperation: string | null
  errorMessage: string | null
  isLoading: boolean
  onAddCodexAccountWithOAuth: () => Promise<boolean>
  onConnectCodexWithOAuth: () => Promise<boolean>
  onDisconnectCodex: () => Promise<boolean>
  onRemoveCodexAccount: (accountKey: string) => Promise<boolean>
  onRemoveApiKeyProvider: (providerId: ApiKeyProviderId) => Promise<boolean>
  onRefreshProvidersState: () => Promise<void>
  onSaveApiKeyProvider: (input: SaveApiKeyProviderInput) => Promise<boolean>
  onSwitchCodexAccount: (accountKey: string) => Promise<boolean>
  providersState: ProvidersState | null
}

export function ProvidersSettingsPanel({
  activeOperation,
  errorMessage,
  isLoading,
  onAddCodexAccountWithOAuth,
  onConnectCodexWithOAuth,
  onDisconnectCodex,
  onRemoveCodexAccount,
  onRemoveApiKeyProvider,
  onRefreshProvidersState,
  onSaveApiKeyProvider,
  onSwitchCodexAccount,
  providersState,
}: ProvidersSettingsPanelProps) {
  const schema = getApiKeyProviderSchema('openai-compatible')
  const [draft, setDraft] = useState<ApiKeyProviderDraft>(() => buildInitialDraftMap()['openai-compatible'])
  const [validationError, setValidationError] = useState<string | undefined>(undefined)
  const [actionFeedback, setActionFeedback] = useState<ProviderActionFeedback | null>(null)
  const [isOpenAICompatibleExpanded, setIsOpenAICompatibleExpanded] = useState(true)
  const [isCodexExpanded, setIsCodexExpanded] = useState(true)
  const providerStatus = providersState?.apiKeyProviders.find((provider) => provider.id === 'openai-compatible')
  const operationState = operationForProvider(activeOperation, 'openai-compatible')
  const isBusy = isLoading || operationState.isRemoving || operationState.isSaving

  useEffect(() => {
    const fallbackDraft = buildInitialDraftMap()['openai-compatible']

    setDraft((currentValue) => ({
      apiKey: providerStatus?.apiKey ?? currentValue.apiKey,
      baseUrl: providerStatus?.baseUrl ?? currentValue.baseUrl ?? fallbackDraft.baseUrl,
      maxTokens: currentValue.maxTokens || fallbackDraft.maxTokens,
      temperature: currentValue.temperature || fallbackDraft.temperature,
    }))
  }, [providerStatus?.apiKey, providerStatus?.baseUrl])

  function updateDraft(input: Partial<ApiKeyProviderDraft>) {
    setDraft((currentValue) => ({
      ...currentValue,
      ...input,
    }))
    setValidationError(undefined)
    setActionFeedback(null)
  }

  function persistAdvancedDefaults() {
    const currentDefaults = readProviderDefaults()

    writeProviderDefaults({
      ...currentDefaults,
      'openai-compatible': {
        maxTokens: draft.maxTokens,
        temperature: draft.temperature,
      },
    })
  }

  async function handleSave() {
    if (!schema) {
      return
    }

    const apiKey = draft.apiKey.trim()
    const inputBaseUrl = draft.baseUrl.trim()
    const fallbackBaseUrl = providerStatus?.baseUrl?.trim() ?? ''
    const resolvedBaseUrl = inputBaseUrl || fallbackBaseUrl
    const hasStoredApiKey = Boolean(providerStatus?.hasApiKey)
    const wasConfigured = Boolean(providerStatus?.configured)

    if (!schema.apiKeyOptional && !apiKey && !hasStoredApiKey) {
      setValidationError('API key is required for this provider.')
      return
    }

    if (schema.showBaseUrl && schema.baseUrlRequired && !resolvedBaseUrl) {
      setValidationError('Base URL is required for this provider.')
      return
    }

    if (!isValidTemperature(draft.temperature) || !isValidMaxTokens(draft.maxTokens)) {
      setValidationError('Temperature must be between 0 and 2, and Max Tokens must be a positive number.')
      return
    }

    const didSave = await onSaveApiKeyProvider({
      apiKey,
      baseUrl: resolvedBaseUrl,
      providerId: 'openai-compatible',
    })

    if (!didSave) {
      setActionFeedback({ label: 'Save failed', tone: 'error' })
      return
    }

    persistAdvancedDefaults()
    setActionFeedback({ label: wasConfigured ? 'Updated' : 'Saved', tone: 'success' })
    setDraft((currentValue) => ({
      ...currentValue,
      apiKey,
      baseUrl: resolvedBaseUrl,
    }))
    await onRefreshProvidersState()
  }

  async function handleClear() {
    const didClear = await onRemoveApiKeyProvider('openai-compatible')
    if (!didClear) {
      setActionFeedback({ label: 'Clear failed', tone: 'error' })
      return
    }

    setDraft(buildInitialDraftMap()['openai-compatible'])
    setValidationError(undefined)
    setActionFeedback({ label: 'Cleared', tone: 'success' })
    await onRefreshProvidersState()
  }

  const providerDescription = useMemo(() => {
    if (!schema) {
      return ''
    }

    return schema.description
  }, [schema])

  if (!schema) {
    return null
  }

  return (
    <SettingsPanelLayout>
      <SettingsSection title="Provider Setup">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <CodexProviderAccordion
            activeOperation={activeOperation}
            isBusy={isLoading}
            isExpanded={isCodexExpanded}
            isFirst
            onAddAccount={async () => {
              await onAddCodexAccountWithOAuth()
            }}
            onConnect={async () => {
              await onConnectCodexWithOAuth()
            }}
            onDisconnect={async () => {
              await onDisconnectCodex()
            }}
            onRemoveAccount={async (accountKey) => {
              await onRemoveCodexAccount(accountKey)
            }}
            onSwitchAccount={async (accountKey) => {
              await onSwitchCodexAccount(accountKey)
            }}
            onToggle={() => setIsCodexExpanded((currentValue) => !currentValue)}
            primaryButtonClassName={PRIMARY_ACTION_BUTTON_CLASS_NAME}
            providerStatus={providersState?.codex}
          />
          <ApiKeyProviderAccordion
            actionFeedback={actionFeedback}
            draft={draft}
            errorMessage={validationError}
            isBusy={isBusy}
            isExpanded={isOpenAICompatibleExpanded}
            onBaseUrlChange={(value) => updateDraft({ baseUrl: value })}
            onClear={handleClear}
            onMaxTokensChange={(value) => updateDraft({ maxTokens: normalizeOptionalIntegerInput(value) })}
            onSave={handleSave}
            onTemperatureChange={(value) => updateDraft({ temperature: normalizeOptionalNumericInput(value) })}
            onToggle={() => setIsOpenAICompatibleExpanded((currentValue) => !currentValue)}
            onUpdateApiKey={(value) => updateDraft({ apiKey: value })}
            primaryButtonClassName={PRIMARY_ACTION_BUTTON_CLASS_NAME}
            providerStatus={providerStatus}
            schema={{
              ...schema,
              description: providerDescription,
            }}
          />
        </div>
      </SettingsSection>

      {errorMessage ? (
        <section className="rounded-2xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
          {errorMessage}
        </section>
      ) : null}
    </SettingsPanelLayout>
  )
}
