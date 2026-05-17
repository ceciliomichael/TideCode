import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { ApiKeyProviderId, ApiKeyProviderStatus, SaveApiKeyProviderInput } from '../../src/types/chat'
import { writeJsonFileAtomic } from '../settings/fileStore'

interface StoredApiKeyProviderConfig {
  api_key?: string
  base_url?: string
  updated_at: string
}

type StoredApiKeyProviders = Partial<Record<ApiKeyProviderId, StoredApiKeyProviderConfig>>

const PROVIDERS_SETTINGS_FILE_NAME = 'providers.json'
const CONFIG_ROOT_SEGMENTS = ['.echosphere', 'config'] as const

const PROVIDER_LABELS: Record<ApiKeyProviderId, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  mistral: 'Mistral AI',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI Compatible',
}

const API_KEY_PROVIDER_ORDER: readonly ApiKeyProviderId[] = ['openai', 'anthropic', 'google', 'mistral', 'openai-compatible']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isApiKeyProviderId(value: unknown): value is ApiKeyProviderId {
  return API_KEY_PROVIDER_ORDER.some((providerId) => providerId === value)
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

    if (key !== 'openai-compatible' && !apiKey) {
      continue
    }

    if (key === 'openai-compatible' && !apiKey && !baseUrl) {
      continue
    }

    const nextValue: StoredApiKeyProviderConfig = {
      updated_at: hasText(value.updated_at) ? value.updated_at : new Date().toISOString(),
    }

    if (apiKey) {
      nextValue.api_key = apiKey
    }

    if (baseUrl) {
      nextValue.base_url = baseUrl
    }

    sanitized[key] = nextValue
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
      console.warn('Ignoring corrupted providers settings file', error)
      return {}
    }

    throw error
  }
}

export async function saveApiKeyProviderConfig(input: SaveApiKeyProviderInput) {
  const currentProviders = await readStoredApiKeyProviders()
  const currentProviderConfig = currentProviders[input.providerId]
  const nextApiKey = input.apiKey.trim() || currentProviderConfig?.api_key?.trim() || ''
  const nextBaseUrl = input.baseUrl?.trim() || currentProviderConfig?.base_url?.trim() || ''

  if (!nextApiKey && input.providerId !== 'openai-compatible') {
    throw new Error('API key is required.')
  }

  const nextProviderConfig: StoredApiKeyProviderConfig = {
    updated_at: new Date().toISOString(),
  }

  if (nextApiKey) {
    nextProviderConfig.api_key = nextApiKey
  }

  if (input.providerId === 'openai-compatible') {
    if (!nextBaseUrl) {
      throw new Error('Base URL is required for OpenAI-compatible providers.')
    }
  }

  if (nextBaseUrl) {
    nextProviderConfig.base_url = nextBaseUrl
  }

  const nextProviders: StoredApiKeyProviders = {
    ...currentProviders,
    [input.providerId]: nextProviderConfig,
  }

  await writeStoredApiKeyProviders(nextProviders)
}

export async function removeApiKeyProviderConfig(providerId: ApiKeyProviderId) {
  const currentProviders = await readStoredApiKeyProviders()
  const nextProviders: StoredApiKeyProviders = { ...currentProviders }
  delete nextProviders[providerId]
  await writeStoredApiKeyProviders(nextProviders)
}

export function toApiKeyProviderStatuses(storedProviders: StoredApiKeyProviders): ApiKeyProviderStatus[] {
  return API_KEY_PROVIDER_ORDER.map((providerId) => {
    const storedProvider = storedProviders[providerId]
    const configured =
      providerId === 'openai-compatible'
        ? Boolean(storedProvider?.api_key || storedProvider?.base_url)
        : Boolean(storedProvider?.api_key)

    return {
      apiKey: storedProvider?.api_key ?? null,
      baseUrl: storedProvider?.base_url ?? null,
      configured,
      hasApiKey: Boolean(storedProvider?.api_key),
      id: providerId,
      label: PROVIDER_LABELS[providerId],
    }
  })
}
