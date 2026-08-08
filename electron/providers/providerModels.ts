import type { ConfigurableProviderModel, ReasoningEffort, ReasoningRequestBodies } from '../../src/types/chat'
import { isReasoningEffort } from '../../src/lib/reasoningEffort'
import { isValidMaxOutputTokens } from '../../src/lib/modelOutputTokens'
import { parseExtraBody } from './extraBody'

const MAX_PROVIDER_MODELS = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function parseReasoningEfforts(value: unknown): ReasoningEffort[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => !isReasoningEffort(entry))) {
    throw new Error('Each model reasoningEfforts value must be an array of supported effort names.')
  }
  return Array.from(new Set(value)) as ReasoningEffort[]
}

function parseReasoningBodies(value: unknown): ReasoningRequestBodies {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('Each model reasoningBodies value must be a JSON object.')

  const bodies: ReasoningRequestBodies = {}
  for (const [effort, body] of Object.entries(value)) {
    if (!isReasoningEffort(effort)) throw new Error(`Unknown reasoning level "${effort}".`)
    bodies[effort] = parseExtraBody(body)
  }
  return bodies
}

export function parseConfigurableProviderModels(value: unknown): ConfigurableProviderModel[] {
  if (value === undefined || value === null || value === '') return []
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value
  if (!Array.isArray(parsed)) {
    throw new Error('Provider models must be a JSON array.')
  }
  if (parsed.length > MAX_PROVIDER_MODELS) {
    throw new Error(`Provider models cannot contain more than ${MAX_PROVIDER_MODELS} entries.`)
  }

  const models = new Map<string, ConfigurableProviderModel>()
  for (const entry of parsed) {
    if (!isRecord(entry)) throw new Error('Each provider model must be a JSON object.')
    const apiModelId = optionalText(entry.apiModelId)
    if (!apiModelId) throw new Error('Each provider model needs an apiModelId.')

    const reasoningBodies = parseReasoningBodies(entry.reasoningBodies)
    const extraBody = parseExtraBody(entry.extraBody)
    const bodyEfforts = Object.keys(reasoningBodies).filter(isReasoningEffort)
    const reasoningCapable = entry.reasoningCapable === true || bodyEfforts.length > 0
    const reasoningEfforts = reasoningCapable ? bodyEfforts : parseReasoningEfforts(entry.reasoningEfforts)
    if (reasoningCapable && bodyEfforts.length === 0) {
      throw new Error(`${apiModelId} needs at least one reasoningBodies entry.`)
    }
    const defaultReasoningEffort = entry.defaultReasoningEffort
    if (defaultReasoningEffort !== undefined && !isReasoningEffort(defaultReasoningEffort)) {
      throw new Error(`${apiModelId} has an unknown defaultReasoningEffort.`)
    }
    if (defaultReasoningEffort && !reasoningEfforts.includes(defaultReasoningEffort)) {
      throw new Error(`${apiModelId} defaultReasoningEffort must also appear in reasoningEfforts.`)
    }
    const maxTokens = entry.maxTokens === undefined ? undefined : entry.maxTokens
    if (maxTokens !== undefined && !isValidMaxOutputTokens(maxTokens)) {
      throw new Error(`${apiModelId} maxTokens must be a positive whole number.`)
    }

    const identity = apiModelId.toLowerCase()
    if (models.has(identity)) continue
    models.set(identity, {
      apiModelId,
      ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
      ...(typeof entry.enabledByDefault === 'boolean' ? { enabledByDefault: entry.enabledByDefault } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
      ...(optionalText(entry.id) ? { id: optionalText(entry.id) } : {}),
      ...(optionalText(entry.label) ? { label: optionalText(entry.label) } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      reasoningCapable,
      ...(bodyEfforts.length > 0 ? { reasoningBodies } : {}),
      ...(reasoningCapable ? { reasoningEfforts } : {}),
    })
  }
  return Array.from(models.values())
}

export function sanitizeConfigurableProviderModels(value: unknown): ConfigurableProviderModel[] {
  try {
    return parseConfigurableProviderModels(value)
  } catch {
    return []
  }
}

export function formatConfigurableProviderModels(models: readonly ConfigurableProviderModel[]) {
  return models.length > 0 ? JSON.stringify(models, null, 2) : ''
}
