import { randomUUID } from 'node:crypto'
import { isReasoningEffort } from '../../src/lib/reasoningEffort'
import {
  getDefaultCustomModelMaxOutputTokens,
  isValidMaxOutputTokens,
} from '../../src/lib/modelOutputTokens'
import type {
  CustomModelConfig,
  CustomModelProviderId,
  ReasoningEffort,
  ReasoningRequestBodies,
} from '../../src/types/chat'
import { isChatProviderId, isCustomApiKeyProviderId } from '../providers/providerIds'
import { parseExtraBody } from '../providers/extraBody'

export const USER_MODEL_CATALOG_VERSION = 2

export interface StoredUserModel {
  api_model_id: string
  created_at: string
  default_reasoning_effort?: ReasoningEffort
  extra_body?: Record<string, unknown>
  id: string
  label: string
  max_tokens?: number
  reasoning_bodies?: ReasoningRequestBodies
  reasoning_capable: boolean
  reasoning_efforts?: ReasoningEffort[]
  updated_at: string
}

export interface StoredUserModelCatalog {
  models: StoredUserModel[]
  provider_id: CustomModelProviderId
  version: typeof USER_MODEL_CATALOG_VERSION
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(value: unknown, maximumLength: number) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : undefined
}

function sanitizeReasoningBodies(value: unknown, efforts: readonly ReasoningEffort[]) {
  if (!isRecord(value)) return undefined
  const bodies: ReasoningRequestBodies = {}
  for (const effort of efforts) {
    if (!Object.prototype.hasOwnProperty.call(value, effort)) continue
    bodies[effort] = parseExtraBody(value[effort])
  }
  return Object.keys(bodies).length > 0 ? bodies : undefined
}

export function sanitizeStoredUserModel(
  value: unknown,
  providerId: CustomModelProviderId,
): StoredUserModel | null {
  if (!isRecord(value)) return null
  const apiModelId = optionalText(value.api_model_id, 256)
  if (!apiModelId) return null

  const now = new Date().toISOString()
  const id = optionalText(value.id, 512) ?? `${providerId}:custom:${randomUUID()}`
  const label = optionalText(value.label, 160) ?? apiModelId
  const storedMaxTokens = isValidMaxOutputTokens(value.max_tokens)
    ? value.max_tokens
    : isValidMaxOutputTokens(value.maxTokens)
      ? value.maxTokens
      : getDefaultCustomModelMaxOutputTokens(providerId)
  const createdAt = optionalText(value.created_at, 64) ?? now
  const updatedAt = optionalText(value.updated_at, 64) ?? createdAt
  const reasoningCapable = value.reasoning_capable === true
  const reasoningEfforts = reasoningCapable && Array.isArray(value.reasoning_efforts)
    ? Array.from(new Set(value.reasoning_efforts.filter(isReasoningEffort)))
    : []
  if (reasoningCapable && reasoningEfforts.length === 0) return null
  const defaultReasoningEffort = reasoningCapable &&
    isReasoningEffort(value.default_reasoning_effort) &&
    reasoningEfforts.includes(value.default_reasoning_effort)
    ? value.default_reasoning_effort
    : reasoningEfforts[0]
  const reasoningBodies = sanitizeReasoningBodies(value.reasoning_bodies, reasoningEfforts)
  let extraBody: Record<string, unknown> | undefined
  try {
    const parsedExtraBody = isCustomApiKeyProviderId(providerId) ? parseExtraBody(value.extra_body) : {}
    extraBody = Object.keys(parsedExtraBody).length > 0 ? parsedExtraBody : undefined
  } catch {
    return null
  }

  return {
    api_model_id: apiModelId,
    created_at: createdAt,
    ...(defaultReasoningEffort ? { default_reasoning_effort: defaultReasoningEffort } : {}),
    ...(extraBody ? { extra_body: extraBody } : {}),
    id,
    label,
    ...(storedMaxTokens !== undefined ? { max_tokens: storedMaxTokens } : {}),
    ...(reasoningBodies ? { reasoning_bodies: reasoningBodies } : {}),
    reasoning_capable: reasoningCapable,
    ...(reasoningEfforts.length > 0 ? { reasoning_efforts: reasoningEfforts } : {}),
    updated_at: updatedAt,
  }
}

export function sanitizeStoredUserModelCatalog(value: unknown): StoredUserModelCatalog | null {
  if (!isRecord(value) || !isChatProviderId(value.provider_id) || !Array.isArray(value.models)) {
    return null
  }
  const providerId = value.provider_id
  const models = value.models
    .map((model) => sanitizeStoredUserModel(model, providerId))
    .filter((model): model is StoredUserModel => model !== null)
  const uniqueModels = new Map<string, StoredUserModel>()
  for (const model of models) {
    const identity = model.api_model_id.toLowerCase()
    if (!uniqueModels.has(identity)) uniqueModels.set(identity, model)
  }
  return {
    models: Array.from(uniqueModels.values()).sort((left, right) => left.label.localeCompare(right.label)),
    provider_id: providerId,
    version: USER_MODEL_CATALOG_VERSION,
  }
}

export function toCustomModelConfig(
  providerId: CustomModelProviderId,
  model: StoredUserModel,
): CustomModelConfig {
  return {
    apiModelId: model.api_model_id,
    createdAt: model.created_at,
    ...(model.default_reasoning_effort ? { defaultReasoningEffort: model.default_reasoning_effort } : {}),
    ...(model.extra_body ? { extraBody: model.extra_body } : {}),
    id: model.id,
    label: model.label,
    ...(model.max_tokens !== undefined ? { maxTokens: model.max_tokens } : {}),
    providerId,
    reasoningCapable: model.reasoning_capable,
    ...(model.reasoning_bodies ? { reasoningBodies: model.reasoning_bodies } : {}),
    ...(model.reasoning_efforts ? { reasoningEfforts: model.reasoning_efforts } : {}),
    updatedAt: model.updated_at,
  }
}

export function createStoredUserModel(
  input: Omit<CustomModelConfig, 'createdAt' | 'id' | 'updatedAt'> & { id?: string },
  timestamps?: { createdAt?: string; updatedAt?: string },
): StoredUserModel {
  const now = new Date().toISOString()
  const candidate = sanitizeStoredUserModel({
    api_model_id: input.apiModelId,
    created_at: timestamps?.createdAt ?? now,
    default_reasoning_effort: input.defaultReasoningEffort,
    extra_body: input.extraBody,
    id: input.id ?? `${input.providerId}:custom:${randomUUID()}`,
    label: input.label,
    max_tokens: input.maxTokens,
    reasoning_bodies: input.reasoningBodies,
    reasoning_capable: input.reasoningCapable,
    reasoning_efforts: input.reasoningEfforts,
    updated_at: timestamps?.updatedAt ?? now,
  }, input.providerId)
  if (!candidate) throw new Error('The model reasoning configuration is incomplete.')
  return candidate
}
