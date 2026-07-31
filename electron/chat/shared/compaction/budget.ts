import type { ModelMessage } from 'ai'
import { approximateTokenCount } from '../../../../src/lib/contextUsage'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../../../src/lib/contextCompactionSettings'

export const DEFAULT_CONTEXT_WINDOW_TOKENS = DEFAULT_CONTEXT_COMPACTION_SETTINGS.contextWindowTokens
export const DEFAULT_COMPACTION_TRIGGER_RATIO = DEFAULT_CONTEXT_COMPACTION_SETTINGS.triggerPercent / 100
export const DEFAULT_COMPACTION_TARGET_RATIO = DEFAULT_CONTEXT_COMPACTION_SETTINGS.targetPercent / 100
export const DEFAULT_COMPACTION_RESERVE_TOKENS = DEFAULT_CONTEXT_COMPACTION_SETTINGS.reserveTokens

function stringifyForTokenEstimate(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export function estimateModelMessagesTokens(messages: readonly ModelMessage[]) {
  return approximateTokenCount(stringifyForTokenEstimate(messages))
}

export function estimateToolSchemaTokens(tools: unknown) {
  return approximateTokenCount(stringifyForTokenEstimate(tools))
}

export interface ContextBudgetInput {
  contextWindowTokens?: number
  systemPromptTokens: number
  toolSchemaTokens: number
  messageTokens: number
  reserveTokens?: number
  triggerRatio?: number
  targetRatio?: number
}

export interface ContextBudget {
  availableHistoryTokens: number
  contextWindowTokens: number
  messageTokens: number
  reserveTokens: number
  targetHistoryTokens: number
  totalTokens: number
  triggerTokens: number
}

export function calculateContextBudget(input: ContextBudgetInput): ContextBudget {
  const contextWindowTokens = Math.max(
    16_000,
    Math.floor(input.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS),
  )
  const reserveTokens = Math.max(
    4_000,
    Math.floor(input.reserveTokens ?? DEFAULT_COMPACTION_RESERVE_TOKENS),
  )
  const triggerRatio = Math.min(0.95, Math.max(0.5, input.triggerRatio ?? DEFAULT_COMPACTION_TRIGGER_RATIO))
  const targetRatio = Math.min(0.8, Math.max(0.05, input.targetRatio ?? DEFAULT_COMPACTION_TARGET_RATIO))
  const staticTokens = Math.max(0, Math.floor(input.systemPromptTokens + input.toolSchemaTokens))
  const totalTokens = staticTokens + Math.max(0, input.messageTokens)
  const availableHistoryTokens = Math.max(1_000, contextWindowTokens - staticTokens - reserveTokens)
  const targetHistoryTokens = Math.max(
    2_000,
    Math.min(availableHistoryTokens, Math.floor(contextWindowTokens * targetRatio - staticTokens - reserveTokens)),
  )

  return {
    availableHistoryTokens,
    contextWindowTokens,
    messageTokens: Math.max(0, input.messageTokens),
    reserveTokens,
    targetHistoryTokens,
    totalTokens,
    triggerTokens: Math.floor(contextWindowTokens * triggerRatio),
  }
}

export function shouldCompactContext(budget: ContextBudget) {
  return budget.totalTokens >= budget.triggerTokens && budget.messageTokens > budget.targetHistoryTokens
}
