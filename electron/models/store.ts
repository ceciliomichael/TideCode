import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { CustomModelConfig, CustomModelProviderId, SaveCustomModelInput } from '../../src/types/chat'
import { isApiKeyProviderId } from '../providers/providerIds'

interface StoredCustomModelConfig {
  api_model_id: string
  created_at: string
  id: string
  label: string
  reasoning_capable: boolean
  updated_at: string
}

type StoredCustomModelsByProvider = Partial<Record<CustomModelProviderId, StoredCustomModelConfig[]>>

const CONFIG_ROOT_SEGMENTS = ['.echosphere', 'config'] as const
const CUSTOM_MODELS_FILE_NAME = 'custom-models.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isCustomModelProviderId(value: unknown): value is CustomModelProviderId {
  return isApiKeyProviderId(value)
}

function getConfigDirectoryPath() {
  return path.join(app.getPath('home'), ...CONFIG_ROOT_SEGMENTS)
}

function getCustomModelsFilePath() {
  return path.join(getConfigDirectoryPath(), CUSTOM_MODELS_FILE_NAME)
}

async function ensureConfigDirectory() {
  await fs.mkdir(getConfigDirectoryPath(), { recursive: true })
}

function sanitizeStoredCustomModelConfig(
  input: unknown,
  providerId: CustomModelProviderId,
): StoredCustomModelConfig | null {
  if (!isRecord(input)) {
    return null
  }

  const id = hasText(input.id) ? input.id.trim() : `${providerId}:custom:${randomUUID()}`
  const apiModelId = hasText(input.api_model_id) ? input.api_model_id.trim() : ''
  if (!apiModelId) {
    return null
  }

  const label = hasText(input.label) ? input.label.trim() : apiModelId
  const createdAt = hasText(input.created_at) ? input.created_at : new Date().toISOString()
  const updatedAt = hasText(input.updated_at) ? input.updated_at : createdAt
  const reasoningCapable = typeof input.reasoning_capable === 'boolean' ? input.reasoning_capable : true

  return {
    api_model_id: apiModelId,
    created_at: createdAt,
    id,
    label,
    reasoning_capable: reasoningCapable,
    updated_at: updatedAt,
  }
}

function sanitizeStoredCustomModelsByProvider(input: unknown): StoredCustomModelsByProvider {
  if (!isRecord(input)) {
    return {}
  }

  const sanitized: StoredCustomModelsByProvider = {}

  for (const [providerId, providerModels] of Object.entries(input)) {
    if (!isCustomModelProviderId(providerId) || !Array.isArray(providerModels)) {
      continue
    }

    const normalizedProviderModels = providerModels
      .map((model) => sanitizeStoredCustomModelConfig(model, providerId))
      .filter((model): model is StoredCustomModelConfig => model !== null)

    if (normalizedProviderModels.length > 0) {
      sanitized[providerId] = normalizedProviderModels
    }
  }

  return sanitized
}

async function writeStoredCustomModelsByProvider(modelsByProvider: StoredCustomModelsByProvider) {
  await ensureConfigDirectory()
  await fs.writeFile(getCustomModelsFilePath(), JSON.stringify(modelsByProvider, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

async function readStoredCustomModelsByProvider() {
  try {
    const raw = await fs.readFile(getCustomModelsFilePath(), 'utf8')
    return sanitizeStoredCustomModelsByProvider(JSON.parse(raw) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

function toCustomModelConfig(
  providerId: CustomModelProviderId,
  model: StoredCustomModelConfig,
): CustomModelConfig {
  return {
    apiModelId: model.api_model_id,
    createdAt: model.created_at,
    id: model.id,
    label: model.label,
    providerId,
    reasoningCapable: model.reasoning_capable,
    updatedAt: model.updated_at,
  }
}

function flattenCustomModels(modelsByProvider: StoredCustomModelsByProvider): CustomModelConfig[] {
  return Object.keys(modelsByProvider).filter(isCustomModelProviderId).flatMap((providerId) => {
    const providerModels = modelsByProvider[providerId] ?? []
    return providerModels.map((model) => toCustomModelConfig(providerId, model))
  }).sort((left, right) => left.label.localeCompare(right.label))
}

export async function listStoredCustomModels() {
  const modelsByProvider = await readStoredCustomModelsByProvider()
  return flattenCustomModels(modelsByProvider)
}

export async function saveCustomModelConfig(input: SaveCustomModelInput) {
  const apiModelId = input.apiModelId.trim()
  if (!apiModelId) {
    throw new Error('Model ID is required.')
  }

  const label = input.label?.trim() || apiModelId
  const providerId = input.providerId
  if (!isCustomModelProviderId(providerId)) {
    throw new Error(`Unsupported custom model provider: ${providerId}`)
  }

  const now = new Date().toISOString()
  const currentModelsByProvider = await readStoredCustomModelsByProvider()
  const providerModels = currentModelsByProvider[providerId] ?? []
  const existingModelIndex = providerModels.findIndex(
    (model) => model.api_model_id.toLowerCase() === apiModelId.toLowerCase(),
  )

  const nextProviderModels =
    existingModelIndex >= 0
      ? providerModels.map((model, index) =>
          index === existingModelIndex
            ? {
                ...model,
                api_model_id: apiModelId,
                label,
                reasoning_capable: input.reasoningCapable,
                updated_at: now,
              }
            : model,
        )
      : [
          ...providerModels,
          {
            api_model_id: apiModelId,
            created_at: now,
            id: `${providerId}:custom:${randomUUID()}`,
            label,
            reasoning_capable: input.reasoningCapable,
            updated_at: now,
          } satisfies StoredCustomModelConfig,
        ]

  const dedupedModelsById = Array.from(
    new Map(nextProviderModels.map((model) => [model.id, model] as const)).values(),
  ).sort((left, right) => left.label.localeCompare(right.label))

  const nextModelsByProvider: StoredCustomModelsByProvider = {
    ...currentModelsByProvider,
    [providerId]: dedupedModelsById,
  }

  await writeStoredCustomModelsByProvider(nextModelsByProvider)
  return flattenCustomModels(nextModelsByProvider)
}

export async function removeCustomModelConfig(modelId: string) {
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId) {
    return listStoredCustomModels()
  }

  const currentModelsByProvider = await readStoredCustomModelsByProvider()
  let didChange = false
  const nextModelsByProvider: StoredCustomModelsByProvider = {
    ...currentModelsByProvider,
  }

  for (const providerId of Object.keys(nextModelsByProvider).filter(isCustomModelProviderId)) {
    const providerModels = nextModelsByProvider[providerId] ?? []
    const filteredModels = providerModels.filter((model) => model.id !== normalizedModelId)
    if (filteredModels.length !== providerModels.length) {
      didChange = true
      if (filteredModels.length > 0) {
        nextModelsByProvider[providerId] = filteredModels
      } else {
        delete nextModelsByProvider[providerId]
      }
    }
  }

  if (didChange) {
    await writeStoredCustomModelsByProvider(nextModelsByProvider)
    return flattenCustomModels(nextModelsByProvider)
  }

  return flattenCustomModels(currentModelsByProvider)
}
