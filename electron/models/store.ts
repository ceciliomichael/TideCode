import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  ConfigurableProviderModel,
  CustomModelProviderId,
  SaveCustomModelInput,
} from '../../src/types/chat'
import { findCatalogModel } from './catalog/catalog'
import { writeJsonFileAtomic } from '../settings/fileStore'
import { isChatProviderId, isCustomApiKeyProviderId } from '../providers/providerIds'
import { readStoredApiKeyProviders } from '../providers/store'
import {
  createStoredUserModel,
  sanitizeStoredUserModel,
  sanitizeStoredUserModelCatalog,
  toCustomModelConfig,
  USER_MODEL_CATALOG_VERSION,
  type StoredUserModel,
  type StoredUserModelCatalog,
} from './userCatalogSchema'

const CONFIG_ROOT_SEGMENTS = ['.echosphere'] as const
const MODELS_DIRECTORY_NAME = 'models'
const LEGACY_MODELS_FILE_SEGMENTS = ['config', 'custom-models.json'] as const
let mutationQueue: Promise<unknown> = Promise.resolve()

function getModelsDirectoryPath() {
  return path.join(app.getPath('home'), ...CONFIG_ROOT_SEGMENTS, MODELS_DIRECTORY_NAME)
}

function getLegacyModelsFilePath() {
  return path.join(app.getPath('home'), ...CONFIG_ROOT_SEGMENTS, ...LEGACY_MODELS_FILE_SEGMENTS)
}

function getProviderCatalogFilePath(providerId: CustomModelProviderId) {
  return path.join(getModelsDirectoryPath(), `${encodeURIComponent(providerId)}.json`)
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function writeProviderCatalog(catalog: StoredUserModelCatalog) {
  await fs.mkdir(getModelsDirectoryPath(), { recursive: true })
  await writeJsonFileAtomic(
    getProviderCatalogFilePath(catalog.provider_id),
    JSON.stringify(catalog, null, 2),
  )
}

async function readProviderCatalog(filePath: string): Promise<StoredUserModelCatalog | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
    return sanitizeStoredUserModelCatalog(parsed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof SyntaxError) {
      console.warn(`Ignoring invalid user model catalog: ${path.basename(filePath)}`)
      return null
    }
    throw error
  }
}

async function readAllProviderCatalogs() {
  try {
    const entries = await fs.readdir(getModelsDirectoryPath(), { withFileTypes: true })
    const catalogs = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => readProviderCatalog(path.join(getModelsDirectoryPath(), entry.name))))
    return catalogs.filter((catalog): catalog is StoredUserModelCatalog => catalog !== null)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function toLegacyStoredModel(
  providerId: CustomModelProviderId,
  value: unknown,
): StoredUserModel | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const rawEfforts = Array.isArray(record.reasoningEfforts) ? record.reasoningEfforts : []
  const hasReasoningBodies = typeof record.reasoningBodies === 'object' && record.reasoningBodies !== null
  return sanitizeStoredUserModel({
    api_model_id: record.api_model_id ?? record.apiModelId,
    created_at: record.created_at,
    default_reasoning_effort: record.defaultReasoningEffort,
    extra_body: record.extra_body ?? record.extraBody,
    id: record.id,
    label: record.label,
    reasoning_bodies: record.reasoningBodies,
    reasoning_capable: rawEfforts.length > 0 || hasReasoningBodies,
    reasoning_efforts: rawEfforts,
    updated_at: record.updated_at,
  }, providerId)
}

async function readLegacyStandaloneModels() {
  try {
    const parsed = JSON.parse(await fs.readFile(getLegacyModelsFilePath(), 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
    const models: Array<{ model: StoredUserModel; providerId: CustomModelProviderId }> = []
    for (const [providerId, entries] of Object.entries(parsed)) {
      if (!isChatProviderId(providerId) || !Array.isArray(entries)) continue
      for (const entry of entries) {
        const model = toLegacyStoredModel(providerId, entry)
        if (model) models.push({ model, providerId })
      }
    }
    return models
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return []
    throw error
  }
}

function fromLegacyProviderModel(providerId: CustomModelProviderId, model: ConfigurableProviderModel) {
  return toLegacyStoredModel(providerId, {
    apiModelId: model.apiModelId,
    defaultReasoningEffort: model.defaultReasoningEffort,
    extraBody: model.extraBody,
    id: model.id,
    label: model.label,
    reasoningBodies: model.reasoningBodies,
    reasoningCapable: model.reasoningCapable,
    reasoningEfforts: model.reasoningEfforts,
  })
}

async function migrateLegacyModelsIfNeeded() {
  if (await pathExists(getModelsDirectoryPath())) return
  const migratedModels = await readLegacyStandaloneModels()
  const providers = await readStoredApiKeyProviders()
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!isCustomApiKeyProviderId(providerId)) continue
    for (const legacyModel of provider?.models ?? []) {
      const model = fromLegacyProviderModel(providerId, legacyModel)
      if (model) migratedModels.push({ model, providerId })
    }
  }
  await fs.mkdir(getModelsDirectoryPath(), { recursive: true })
  const byProvider = new Map<CustomModelProviderId, StoredUserModel[]>()
  for (const entry of migratedModels) {
    const models = byProvider.get(entry.providerId) ?? []
    if (!models.some((model) => model.api_model_id.toLowerCase() === entry.model.api_model_id.toLowerCase())) {
      models.push(entry.model)
      byProvider.set(entry.providerId, models)
    }
  }
  await Promise.all(Array.from(byProvider.entries()).map(([providerId, models]) =>
    writeProviderCatalog({ models, provider_id: providerId, version: USER_MODEL_CATALOG_VERSION })))
}

function flattenCatalogs(catalogs: readonly StoredUserModelCatalog[]) {
  return catalogs.flatMap((catalog) =>
    catalog.models.map((model) => toCustomModelConfig(catalog.provider_id, model)))
    .sort((left, right) => left.label.localeCompare(right.label))
}

async function readCatalogsInitialized() {
  await migrateLegacyModelsIfNeeded()
  return readAllProviderCatalogs()
}

function queueMutation<T>(operation: () => Promise<T>) {
  const result = mutationQueue.then(operation, operation)
  mutationQueue = result.then(() => undefined, () => undefined)
  return result
}

export async function listStoredCustomModels() {
  return flattenCatalogs(await readCatalogsInitialized())
}

export async function saveCustomModelConfig(input: SaveCustomModelInput) {
  return queueMutation(async () => {
    if (!isChatProviderId(input.providerId)) throw new Error('Select a supported provider.')
    const apiModelId = input.apiModelId.trim()
    if (!apiModelId || apiModelId.length > 256) throw new Error('Enter a valid model ID.')
    if (findCatalogModel(input.providerId, apiModelId)) {
      throw new Error('That model already exists in the built-in catalog.')
    }

    const catalogs = await readCatalogsInitialized()
    const existingEntry = input.modelId
      ? catalogs.flatMap((catalog) => catalog.models.map((model) => ({ catalog, model })))
        .find((entry) => entry.model.id === input.modelId)
      : undefined
    const duplicate = catalogs.some((catalog) =>
      catalog.provider_id === input.providerId && catalog.models.some((model) =>
        model.id !== input.modelId && model.api_model_id.toLowerCase() === apiModelId.toLowerCase()))
    if (duplicate) throw new Error('A custom model with that ID already exists for this provider.')

    const nextModel = createStoredUserModel({
      apiModelId,
      ...(input.defaultReasoningEffort ? { defaultReasoningEffort: input.defaultReasoningEffort } : {}),
      ...(isCustomApiKeyProviderId(input.providerId) && input.extraBody ? { extraBody: input.extraBody } : {}),
      id: existingEntry?.model.id,
      label: input.label?.trim() || apiModelId,
      providerId: input.providerId,
      reasoningCapable: input.reasoningCapable,
      ...(input.reasoningBodies ? { reasoningBodies: input.reasoningBodies } : {}),
      ...(input.reasoningEfforts ? { reasoningEfforts: input.reasoningEfforts } : {}),
    }, {
      createdAt: existingEntry?.model.created_at,
    })

    const affectedProviderIds = new Set<CustomModelProviderId>([input.providerId])
    if (existingEntry) affectedProviderIds.add(existingEntry.catalog.provider_id)
    for (const providerId of affectedProviderIds) {
      const catalog = catalogs.find((entry) => entry.provider_id === providerId) ?? {
        models: [], provider_id: providerId, version: USER_MODEL_CATALOG_VERSION,
      }
      const models = catalog.models.filter((model) => model.id !== input.modelId)
      if (providerId === input.providerId) models.push(nextModel)
      await writeProviderCatalog({
        models: models.sort((left, right) => left.label.localeCompare(right.label)),
        provider_id: providerId,
        version: USER_MODEL_CATALOG_VERSION,
      })
    }
    return flattenCatalogs(await readAllProviderCatalogs())
  })
}

export async function removeCustomModelConfig(modelId: string) {
  return queueMutation(async () => {
    const normalizedModelId = modelId.trim()
    if (!normalizedModelId) return listStoredCustomModels()
    const catalogs = await readCatalogsInitialized()
    for (const catalog of catalogs) {
      const models = catalog.models.filter((model) => model.id !== normalizedModelId)
      if (models.length !== catalog.models.length) {
        await writeProviderCatalog({ ...catalog, models })
      }
    }
    return flattenCatalogs(await readAllProviderCatalogs())
  })
}
