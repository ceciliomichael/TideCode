import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  ApiKeyProviderId,
  ApiKeyProviderStatus,
  BuiltInApiKeyProviderId,
  ConfigurableProviderModel,
  SaveApiKeyProviderInput,
} from '../../src/types/chat'
import { writeJsonFileAtomic } from '../settings/fileStore'
import { formatExtraBody, parseExtraBody } from './extraBody'
import { parseConfigurableProviderModels, sanitizeConfigurableProviderModels } from './providerModels'
import {
  apiKeyProviderUsesCustomBaseUrl,
  BUILT_IN_API_KEY_PROVIDER_IDS,
  isApiKeyProviderId,
  isCustomApiKeyProviderId,
} from './providerIds'

export interface StoredApiKeyProviderConfig {
  api_key?: string
  base_url?: string
  extra_body?: Record<string, unknown>
  label?: string
  models?: ConfigurableProviderModel[]
  updated_at: string
}

export type StoredApiKeyProviders = Partial<Record<ApiKeyProviderId, StoredApiKeyProviderConfig>>

const PROVIDERS_SETTINGS_FILE_NAME = 'providers.json'
const CONFIG_ROOT_SEGMENTS = ['.tidecode', 'config'] as const

export const PROVIDER_LABELS: Record<BuiltInApiKeyProviderId, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  google: 'Google',
  mistral: 'Mistral AI',
  openai: 'OpenAI',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function getConfigDirectoryPath() {
  return path.join(app.getPath('home'), ...CONFIG_ROOT_SEGMENTS)
}

function getProvidersSettingsFilePath() {
  return path.join(getConfigDirectoryPath(), PROVIDERS_SETTINGS_FILE_NAME)
}

async function ensureConfigDirectory() {
  await fs.mkdir(getConfigDirectoryPath(), { recursive: true })
}

function normalizeBaseUrl(value: string) {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    throw new Error('Base URL must be a valid absolute URL.')
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('Base URL must use http or https.')
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Base URL cannot contain embedded credentials.')
  }

  parsedUrl.hash = ''
  return parsedUrl.toString().replace(/\/+$/u, '')
}

function sanitizeStoredProviders(input: unknown): StoredApiKeyProviders {
  if (!isRecord(input)) {
    return {}
  }

  const sanitized: StoredApiKeyProviders = {}
  for (const [key, value] of Object.entries(input)) {
    if (!isApiKeyProviderId(key) || !isRecord(value)) {
      continue
    }

    const apiKey = hasText(value.api_key) ? value.api_key.trim() : ''
    const baseUrl = hasText(value.base_url) ? value.base_url.trim() : ''
    const label = hasText(value.label) ? value.label.trim() : ''
    const requiresBaseUrl = apiKeyProviderUsesCustomBaseUrl(key)
    if ((!apiKey && !requiresBaseUrl) || (requiresBaseUrl && !baseUrl) || (isCustomApiKeyProviderId(key) && !label)) {
      continue
    }

    try {
      const extraBody = parseExtraBody(value.extra_body)
      sanitized[key] = {
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(requiresBaseUrl && baseUrl ? { base_url: normalizeBaseUrl(baseUrl) } : {}),
        ...(Object.keys(extraBody).length > 0 ? { extra_body: extraBody } : {}),
        ...(label ? { label } : {}),
        ...(requiresBaseUrl ? { models: sanitizeConfigurableProviderModels(value.models) } : {}),
        updated_at: hasText(value.updated_at) ? value.updated_at : new Date().toISOString(),
      }
    } catch {
      continue
    }
  }

  return sanitized
}

async function writeStoredApiKeyProviders(providers: StoredApiKeyProviders) {
  await ensureConfigDirectory()
  await writeJsonFileAtomic(getProvidersSettingsFilePath(), JSON.stringify(providers, null, 2))
}

export async function readStoredApiKeyProviders() {
  try {
    const raw = await fs.readFile(getProvidersSettingsFilePath(), 'utf8')
    return sanitizeStoredProviders(JSON.parse(raw) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    if (error instanceof SyntaxError) {
      console.warn('Ignoring corrupted providers settings file')
      return {}
    }
    throw error
  }
}

export async function saveApiKeyProviderConfig(input: SaveApiKeyProviderInput) {
  if (!isApiKeyProviderId(input.providerId)) {
    throw new Error('Unsupported provider identifier.')
  }

  const currentProviders = await readStoredApiKeyProviders()
  const currentProvider = currentProviders[input.providerId]
  const apiKey = input.apiKey.trim() || currentProvider?.api_key?.trim() || ''
  const isCustom = isCustomApiKeyProviderId(input.providerId)
  const requiresBaseUrl = apiKeyProviderUsesCustomBaseUrl(input.providerId)
  const rawBaseUrl = requiresBaseUrl
    ? input.baseUrl?.trim() || currentProvider?.base_url?.trim() || ''
    : ''
  const label = isCustom ? input.label?.trim() || currentProvider?.label?.trim() || '' : undefined

  if (!apiKey && !requiresBaseUrl) {
    throw new Error('API key is required.')
  }
  if (requiresBaseUrl && !rawBaseUrl) {
    throw new Error('Base URL is required for OpenAI-compatible providers.')
  }
  if (isCustom && !label) {
    throw new Error('Provider name is required.')
  }

  const baseUrl = rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : ''
  const extraBody = parseExtraBody(input.extraBody ?? formatExtraBody(currentProvider?.extra_body))
  const nextProvider: StoredApiKeyProviderConfig = {
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(baseUrl ? { base_url: baseUrl } : {}),
    ...(Object.keys(extraBody).length > 0 ? { extra_body: extraBody } : {}),
    ...(label ? { label } : {}),
    ...(requiresBaseUrl
      ? { models: parseConfigurableProviderModels(input.models ?? currentProvider?.models) }
      : {}),
    updated_at: new Date().toISOString(),
  }

  await writeStoredApiKeyProviders({
    ...currentProviders,
    [input.providerId]: nextProvider,
  })
}

export async function removeApiKeyProviderConfig(providerId: ApiKeyProviderId) {
  if (!isApiKeyProviderId(providerId)) {
    throw new Error('Unsupported provider identifier.')
  }

  const currentProviders = await readStoredApiKeyProviders()
  const nextProviders: StoredApiKeyProviders = { ...currentProviders }
  delete nextProviders[providerId]
  await writeStoredApiKeyProviders(nextProviders)
}

export function toApiKeyProviderStatuses(storedProviders: StoredApiKeyProviders): ApiKeyProviderStatus[] {
  const customProviderIds = Object.keys(storedProviders)
    .filter(isCustomApiKeyProviderId)
    .sort((left, right) => (storedProviders[left]?.label ?? '').localeCompare(storedProviders[right]?.label ?? ''))
  const providerIds: ApiKeyProviderId[] = [...BUILT_IN_API_KEY_PROVIDER_IDS, ...customProviderIds]

  return providerIds.map((providerId) => {
    const provider = storedProviders[providerId]
    const isCustom = isCustomApiKeyProviderId(providerId)
    const requiresBaseUrl = apiKeyProviderUsesCustomBaseUrl(providerId)
    const configured = requiresBaseUrl ? Boolean(provider?.base_url) : Boolean(provider?.api_key)

    return {
      apiKey: provider?.api_key ?? null,
      baseUrl: provider?.base_url ?? null,
      configured,
      extraBody: formatExtraBody(provider?.extra_body),
      hasApiKey: Boolean(provider?.api_key),
      id: providerId,
      isCustom,
      label: isCustom ? provider?.label ?? 'Custom provider' : PROVIDER_LABELS[providerId],
      models: requiresBaseUrl ? sanitizeConfigurableProviderModels(provider?.models) : [],
    }
  })
}
