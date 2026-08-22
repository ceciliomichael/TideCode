import type { AppSettings, ChatMode, ChatProviderId, ConfigurableProviderModel, ReasoningEffort } from '../../src/types/chat'
import { listCatalogModels } from '../models/catalog/catalog'
import { listStoredCustomModels } from '../models/store'
import {
  readStoredApiKeyProviders,
  type StoredApiKeyProviderConfig,
  type StoredApiKeyProviders,
  PROVIDER_LABELS,
} from '../providers/store'
import { getCodexProviderStatus } from '../providers/codex/service'
import { getStoredSettings } from '../settings/store'
import { colors } from './renderer'
import { resolveReasoningEffortTransition } from '../../src/lib/reasoningEffortTransition'
import { isCustomApiKeyProviderId } from '../providers/providerIds'

export interface SystemModelItem {
  id: string
  apiModelId: string
  label: string
  providerId: ChatProviderId
  providerLabel: string
  isCustom: boolean
  isConfigured: boolean
  maxTokens?: number
  reasoningCapable?: boolean
  reasoningEfforts?: readonly ReasoningEffort[]
  defaultReasoningEffort?: ReasoningEffort
  supportsImageInput?: boolean
}

export interface SystemModelsSnapshot {
  allModels: SystemModelItem[]
  configuredModels: SystemModelItem[]
  defaultModelId: string
  defaultProviderId: ChatProviderId
  selectedReasoningEffort: ReasoningEffort
}

const KNOWN_PROVIDERS: ChatProviderId[] = [
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'codex',
  'mistral',
]

function toSystemModelItem(
  providerId: ChatProviderId,
  providerConfig: StoredApiKeyProviderConfig,
  model: ConfigurableProviderModel,
  isCustom: boolean,
  configuredProviders: ReadonlySet<string>,
): SystemModelItem {
  return {
    id: model.id || `${providerId}:${model.apiModelId}`,
    apiModelId: model.apiModelId,
    label: model.label || model.apiModelId,
    providerId,
    providerLabel: providerConfig.label || PROVIDER_LABELS[providerId as keyof typeof PROVIDER_LABELS] || providerId,
    isCustom,
    isConfigured: configuredProviders.has(providerId),
    maxTokens: model.maxTokens,
    reasoningCapable: model.reasoningCapable,
    reasoningEfforts: model.reasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportsImageInput: model.supportsImageInput,
  }
}

type CliDefaultModelSettings = Pick<
  AppSettings,
  | 'agentModelId'
  | 'agentModelProviderId'
  | 'chatModelId'
  | 'chatModelProviderId'
  | 'chatReasoningEffort'
  | 'planModelId'
  | 'planModelProviderId'
>

export function resolveCliDefaultModelSelection(
  chatMode: ChatMode,
  allModels: readonly SystemModelItem[],
  settings: CliDefaultModelSettings | null | undefined,
) {
  const configuredModels = allModels.filter((model) => model.isConfigured)
  const modeModelId = chatMode === 'plan' ? settings?.planModelId : settings?.agentModelId
  const modeProviderId = chatMode === 'plan' ? settings?.planModelProviderId : settings?.agentModelProviderId
  let defaultModelId = modeModelId?.trim() || settings?.chatModelId?.trim() || 'claude-3-7-sonnet'
  let defaultProviderId: ChatProviderId = modeProviderId ?? settings?.chatModelProviderId ?? 'anthropic'

  let foundMatch = allModels.find(
    (model) =>
      model.providerId === defaultProviderId &&
      (model.apiModelId.toLowerCase() === defaultModelId.toLowerCase() || model.id.toLowerCase() === defaultModelId.toLowerCase()),
  )

  if (!foundMatch) {
    foundMatch = configuredModels.find(
      (model) => model.apiModelId.toLowerCase() === defaultModelId.toLowerCase() || model.id.toLowerCase() === defaultModelId.toLowerCase(),
    )
  }

  if (!foundMatch && configuredModels.length > 0) foundMatch = configuredModels[0]

  if (foundMatch) {
    defaultModelId = foundMatch.apiModelId
    defaultProviderId = foundMatch.providerId
  }

  const storedReasoningEffort = settings?.chatReasoningEffort ?? 'medium'
  const selectedReasoningEffort = foundMatch
    ? resolveReasoningEffortTransition({
        currentEffort: storedReasoningEffort,
        defaultEffort: foundMatch.defaultReasoningEffort,
        supportedEfforts: foundMatch.reasoningEfforts,
      })
    : storedReasoningEffort

  return { defaultModelId, defaultProviderId, selectedReasoningEffort }
}

export async function getTideCodeSystemModels(chatMode: ChatMode = 'agent'): Promise<SystemModelsSnapshot> {
  const [storedApiKeyProviders, codexStatus, customModels, storedSettings] = await Promise.all([
    readStoredApiKeyProviders().catch(() => ({} as StoredApiKeyProviders)),
    getCodexProviderStatus(false).catch(() => ({ isAuthenticated: false })),
    listStoredCustomModels().catch(() => []),
        getStoredSettings('cli').catch(() => null),
  ])

  // Determine which providers are configured with API keys / accounts / env vars
  const configuredProviders = new Set<string>()

  if (process.env.ANTHROPIC_API_KEY || storedApiKeyProviders.anthropic?.api_key) {
    configuredProviders.add('anthropic')
  }
  if (process.env.OPENAI_API_KEY || storedApiKeyProviders.openai?.api_key) {
    configuredProviders.add('openai')
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || storedApiKeyProviders.google?.api_key) {
    configuredProviders.add('google')
  }
  if (process.env.DEEPSEEK_API_KEY || storedApiKeyProviders.deepseek?.api_key) {
    configuredProviders.add('deepseek')
  }
  if (process.env.MISTRAL_API_KEY || storedApiKeyProviders.mistral?.api_key) {
    configuredProviders.add('mistral')
  }
  if (codexStatus.isAuthenticated) {
    configuredProviders.add('codex')
  }

  // Check custom providers from storedApiKeyProviders
  for (const [providerKey, providerConfig] of Object.entries(storedApiKeyProviders)) {
    if (providerConfig?.api_key || providerConfig?.base_url) {
      configuredProviders.add(providerKey)
    }
  }

  const allModels: SystemModelItem[] = []
  const modelIndexes = new Map<string, number>()
  const addModel = (model: SystemModelItem) => {
    const identity = `${model.providerId}\u0000${model.apiModelId.toLowerCase()}`
    const existingIndex = modelIndexes.get(identity)
    if (existingIndex === undefined) {
      modelIndexes.set(identity, allModels.length)
      allModels.push(model)
      return
    }

    // Standalone custom model records are the current source of truth for
    // models migrated from the older provider.models storage format.
    if (model.isCustom) allModels[existingIndex] = model
  }

  // 1. Built-in Catalog Models from TideCode
  for (const providerId of KNOWN_PROVIDERS) {
    try {
      const catalogModels = listCatalogModels(providerId)
      const friendlyProviderLabel = (PROVIDER_LABELS as Record<string, string>)[providerId] || providerId.toUpperCase()

      for (const m of catalogModels) {
        addModel({
          id: m.id || `${providerId}:${m.apiModelId}`,
          apiModelId: m.apiModelId,
          label: m.label || m.apiModelId,
          providerId,
          providerLabel: friendlyProviderLabel,
          isCustom: false,
          isConfigured: configuredProviders.has(providerId),
          maxTokens: m.maxTokens,
          reasoningCapable: m.reasoningCapable,
          reasoningEfforts: m.reasoningEfforts,
          defaultReasoningEffort: m.defaultReasoningEffort,
          supportsImageInput: m.supportsImageInput,
        })
      }
    } catch {
      // Ignore provider catalog read errors
    }
  }

  // 2. Legacy custom-provider models are still readable. New CLI and desktop
  // edits are stored in the standalone model catalogs below, but showing this
  // data here keeps existing provider configurations usable during migration.
  for (const [providerKey, providerConfig] of Object.entries(storedApiKeyProviders)) {
    if (!isCustomApiKeyProviderId(providerKey)) continue
    if (!providerConfig) continue
    for (const model of providerConfig?.models ?? []) {
      addModel(toSystemModelItem(providerKey, providerConfig, model, true, configuredProviders))
    }
  }

  // 3. Custom User Models from TideCode Store
  for (const cm of customModels) {
    const customConfig = (storedApiKeyProviders as Record<string, StoredApiKeyProviderConfig | undefined>)[cm.providerId]
    const customLabel = customConfig?.label || (cm.providerId.startsWith('custom:') ? 'Custom Provider' : cm.providerId)

    addModel({
      id: cm.id,
      apiModelId: cm.apiModelId,
      label: cm.label || cm.apiModelId,
      providerId: cm.providerId,
      providerLabel: customLabel,
      isCustom: true,
      isConfigured: configuredProviders.has(cm.providerId),
      maxTokens: cm.maxTokens,
      reasoningCapable: cm.reasoningCapable,
      reasoningEfforts: cm.reasoningEfforts,
      defaultReasoningEffort: cm.defaultReasoningEffort,
      supportsImageInput: cm.supportsImageInput,
    })
  }

  const configuredModels = allModels.filter((model) => model.isConfigured)
  const { defaultModelId, defaultProviderId, selectedReasoningEffort } = resolveCliDefaultModelSelection(
    chatMode,
    allModels,
    storedSettings,
  )

  return {
    allModels,
    configuredModels,
    defaultModelId,
    defaultProviderId,
    selectedReasoningEffort,
  }
}

export function findSystemModel(
  allModels: SystemModelItem[],
  query: string,
  targetProvider?: string,
): SystemModelItem | null {
  const cleanQuery = query.toLowerCase().trim()
  if (!cleanQuery) return null

  // Exact match on ID or apiModelId
  let match = allModels.find(
    (m) =>
      (!targetProvider || m.providerId === targetProvider) &&
      (m.apiModelId.toLowerCase() === cleanQuery || m.id.toLowerCase() === cleanQuery),
  )

  if (match) return match

  // Partial match on apiModelId or label or providerLabel
  match = allModels.find(
    (m) =>
      (!targetProvider || m.providerId === targetProvider) &&
      (m.apiModelId.toLowerCase().includes(cleanQuery) ||
        m.label.toLowerCase().includes(cleanQuery) ||
        m.providerLabel.toLowerCase().includes(cleanQuery)),
  )

  return match ?? null
}

export function getConfiguredProviderModels(snapshot: SystemModelsSnapshot): SystemModelItem[] {
  const configuredProviderIds = new Set(snapshot.configuredModels.map((model) => model.providerId))
  return snapshot.allModels.filter((model) => configuredProviderIds.has(model.providerId))
}

export function renderModelsTable(
  snapshot: SystemModelsSnapshot,
  currentModelId: string,
  currentProviderId: string,
) {
  console.log(`\n${colors.bold}${colors.brightCyan}TideCode System Models Catalog:${colors.reset}\n`)

  const byProvider = new Map<string, { label: string; models: SystemModelItem[] }>()
  for (const model of getConfiguredProviderModels(snapshot)) {
    const entry = byProvider.get(model.providerId) ?? { label: model.providerLabel, models: [] }
    entry.models.push(model)
    byProvider.set(model.providerId, entry)
  }

  for (const entry of byProvider.values()) {
    console.log(`${colors.bold}${colors.yellow}Provider: ${entry.label.toUpperCase()}${colors.reset} ${colors.green}[Ready]${colors.reset}`)

    for (const m of entry.models) {
      const isCurrent =
        m.apiModelId.toLowerCase() === currentModelId.toLowerCase() &&
        m.providerId.toLowerCase() === currentProviderId.toLowerCase()

      const currentTag = isCurrent ? ` ${colors.brightGreen}◀ (ACTIVE)${colors.reset}` : ''
      const customTag = m.isCustom ? ` ${colors.magenta}(custom)${colors.reset}` : ''
      const reasoningTag = m.reasoningCapable ? ` ${colors.cyan}[reasoning]${colors.reset}` : ''

      console.log(
        `  ${isCurrent ? colors.bold + colors.brightGreen : colors.white}• ${m.apiModelId}${colors.reset} ${colors.dim}- ${m.label}${colors.reset}${reasoningTag}${customTag}${currentTag}`,
      )
    }
    console.log()
  }

  console.log(`${colors.dim}To switch model: ${colors.yellow}/model <modelId> [providerId]${colors.reset}\n`)
}
