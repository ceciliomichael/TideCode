import type {
  ConfigurableProviderModel,
  ReasoningRequestBodies,
} from '../../../types/chat'
import { isReasoningEffort } from '../../../lib/reasoningEffort'

export const PROVIDER_MODELS_EXAMPLE = JSON.stringify([
  {
    apiModelId: 'my-model',
    defaultReasoningEffort: 'high',
    enabledByDefault: true,
    label: 'My model',
    reasoningCapable: true,
    reasoningBodies: {
      low: { reasoning_effort: 'low' },
      high: { reasoning_effort: 'high' },
    },
  },
], null, 2)

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(`${label} must contain valid JSON.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateExtraBodyText(value: string): string | null {
  if (!value.trim()) return null
  try {
    const parsed = parseJson(value, 'Extra settings')
    if (!isRecord(parsed)) return 'Extra settings must be a JSON object.'
    for (const key of ['messages', 'model', 'stream', 'tools']) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        return `Extra settings cannot replace the reserved field "${key}".`
      }
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Extra settings must contain valid JSON.'
  }
}

export function parseProviderModelsText(value: string): ConfigurableProviderModel[] {
  if (!value.trim()) return []
  const parsed = parseJson(value, 'Models')
  if (!Array.isArray(parsed)) throw new Error('Models must be a JSON array.')

  const models = new Map<string, ConfigurableProviderModel>()
  for (const entry of parsed) {
    if (!isRecord(entry) || typeof entry.apiModelId !== 'string' || !entry.apiModelId.trim()) {
      throw new Error('Every model needs an apiModelId.')
    }
    const apiModelId = entry.apiModelId.trim()
    const rawBodies = entry.reasoningBodies
    if (rawBodies !== undefined && !isRecord(rawBodies)) {
      throw new Error(`${apiModelId} reasoningBodies must be a JSON object.`)
    }
    const reasoningBodies: ReasoningRequestBodies = {}
    for (const [effort, body] of Object.entries(rawBodies ?? {})) {
      if (!isReasoningEffort(effort)) throw new Error(`Unknown reasoning level "${effort}".`)
      if (!isRecord(body)) throw new Error(`${apiModelId} ${effort} reasoning body must be a JSON object.`)
      reasoningBodies[effort] = body
    }
    const reasoningEfforts = Object.keys(reasoningBodies).filter(isReasoningEffort)
    const reasoningCapable = reasoningEfforts.length > 0 || entry.reasoningCapable === true
    if (reasoningCapable && reasoningEfforts.length === 0) {
      throw new Error(`${apiModelId} needs at least one reasoningBodies entry.`)
    }
    if (
      entry.defaultReasoningEffort !== undefined &&
      (!isReasoningEffort(entry.defaultReasoningEffort) || !reasoningEfforts.includes(entry.defaultReasoningEffort))
    ) {
      throw new Error(`${apiModelId} defaultReasoningEffort must match a reasoningBodies key.`)
    }

    const identity = apiModelId.toLowerCase()
    if (!models.has(identity)) {
      models.set(identity, {
        apiModelId,
        ...(isReasoningEffort(entry.defaultReasoningEffort)
          ? { defaultReasoningEffort: entry.defaultReasoningEffort }
          : {}),
        ...(typeof entry.enabledByDefault === 'boolean' ? { enabledByDefault: entry.enabledByDefault } : {}),
        ...(typeof entry.id === 'string' && entry.id.trim() ? { id: entry.id.trim() } : {}),
        ...(typeof entry.label === 'string' && entry.label.trim() ? { label: entry.label.trim() } : {}),
        reasoningCapable,
        ...(reasoningCapable ? { reasoningBodies, reasoningEfforts } : {}),
      })
    }
  }
  return Array.from(models.values())
}
