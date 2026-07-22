import type { ProviderModelConfig } from '../../../src/types/chat'
import { isReasoningEffort } from '../../../src/lib/reasoningEffort'
import type { ReasoningRequestBodies } from '../../../src/types/chat'
import { parseExtraBody } from '../../providers/extraBody'
import type { ProviderModelDefinition } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeReasoningBodies(value: unknown): ReasoningRequestBodies {
  if (!isRecord(value)) return {}
  const bodies: ReasoningRequestBodies = {}
  for (const [effort, body] of Object.entries(value)) {
    if (isReasoningEffort(effort)) bodies[effort] = parseExtraBody(body)
  }
  return bodies
}

export function compareProviderModelLabels(left: ProviderModelConfig, right: ProviderModelConfig) {
  return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
}

export function normalizeProviderModelConfig(
  providerId: ProviderModelConfig['providerId'],
  input: unknown,
): ProviderModelConfig | null {
  if (!isRecord(input)) {
    return null
  }

  const id = hasText(input.id) ? input.id.trim() : ''
  if (!id) {
    return null
  }

  const apiModelId = hasText(input.apiModelId) ? input.apiModelId.trim() : id
  const label = hasText(input.label) ? input.label.trim() : id
  const enabledByDefault = typeof input.enabledByDefault === 'boolean' ? input.enabledByDefault : true
  let reasoningBodies: ReasoningRequestBodies
  let extraBody: Record<string, unknown>
  try {
    reasoningBodies = normalizeReasoningBodies(input.reasoningBodies)
    extraBody = parseExtraBody(input.extraBody)
  } catch {
    return null
  }
  const bodyEfforts = Object.keys(reasoningBodies).filter(isReasoningEffort)
  const reasoningCapable = bodyEfforts.length > 0 || input.reasoningCapable === true
  const reasoningEfforts = reasoningCapable
    ? bodyEfforts.length > 0
      ? bodyEfforts
      : Array.isArray(input.reasoningEfforts)
        ? Array.from(new Set(input.reasoningEfforts.filter(isReasoningEffort)))
        : []
    : []
  const defaultReasoningEffort = reasoningCapable && isReasoningEffort(input.defaultReasoningEffort) &&
    reasoningEfforts.includes(input.defaultReasoningEffort)
    ? input.defaultReasoningEffort
    : reasoningEfforts[0]

  return {
    apiModelId,
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    enabledByDefault,
    ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
    id,
    label,
    providerId,
    reasoningCapable,
    ...(bodyEfforts.length > 0 ? { reasoningBodies } : {}),
    ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
    ...(typeof input.maxTokens === 'number' ? { maxTokens: input.maxTokens } : {}),
  }
}

export function normalizeProviderModelConfigs(
  providerId: ProviderModelConfig['providerId'],
  input: readonly unknown[],
): ProviderModelConfig[] {
  const normalized = input
    .map((entry) => normalizeProviderModelConfig(providerId, entry))
    .filter((model): model is ProviderModelConfig => model !== null)
  const configs = new Map<string, ProviderModelConfig>()
  for (const model of normalized) {
    const identity = model.apiModelId.trim().toLowerCase()
    if (!configs.has(identity)) configs.set(identity, model)
  }
  return Array.from(configs.values()).sort(compareProviderModelLabels)
}

export function mapModelIdsToProviderConfigs(
  providerId: ProviderModelConfig['providerId'],
  modelIds: readonly string[],
): ProviderModelConfig[] {
  const configs = new Map<string, ProviderModelConfig>()

  for (const modelId of modelIds) {
    const trimmedModelId = modelId.trim()
    if (!trimmedModelId || configs.has(trimmedModelId)) {
      continue
    }

    configs.set(trimmedModelId, {
      apiModelId: trimmedModelId,
      enabledByDefault: true,
      id: `${providerId}:${trimmedModelId}`,
      label: trimmedModelId,
      providerId,
      reasoningCapable: false,
    })
  }

  return Array.from(configs.values()).sort(compareProviderModelLabels)
}

export function normalizeProviderModelDefinitions(
  providerId: ProviderModelConfig['providerId'],
  input: readonly ProviderModelDefinition[],
): ProviderModelConfig[] {
  return normalizeProviderModelConfigs(providerId, input)
}
