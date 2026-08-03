import type { ModelMessage } from 'ai'
import {
  approximateTokenCount,
  estimateModelMessageContextUsage,
} from '../../../../src/lib/contextUsage'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../../../src/lib/contextCompactionSettings'

export const DEFAULT_CONTEXT_WINDOW_TOKENS = DEFAULT_CONTEXT_COMPACTION_SETTINGS.contextWindowTokens
export const DEFAULT_COMPACTION_TRIGGER_RATIO = DEFAULT_CONTEXT_COMPACTION_SETTINGS.triggerPercent / 100
export const DEFAULT_COMPACTION_RESERVE_TOKENS = DEFAULT_CONTEXT_COMPACTION_SETTINGS.reserveTokens
const COMPACTION_RETENTION_RATIO = 0.25

function stringifyForTokenEstimate(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export function estimateModelMessagesTokens(messages: readonly ModelMessage[]) {
  return estimateModelMessageContextUsage(messages).totalTokens
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

export interface ModelMessagesBudgetInput {
  contextWindowTokens?: number
  messages: readonly ModelMessage[]
  reserveTokens?: number
  systemPromptTokens: number
  toolSchemaTokens: number
  triggerRatio?: number
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
  const staticTokens = Math.max(0, Math.floor(input.systemPromptTokens + input.toolSchemaTokens))
  const totalTokens = staticTokens + Math.max(0, input.messageTokens)
  const availableHistoryTokens = Math.max(1_000, contextWindowTokens - staticTokens - reserveTokens)
  const targetHistoryTokens = Math.max(
    2_000,
    Math.min(availableHistoryTokens, Math.floor(contextWindowTokens * COMPACTION_RETENTION_RATIO - staticTokens - reserveTokens)),
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

export function calculateModelMessagesBudget(input: ModelMessagesBudgetInput) {
  return calculateContextBudget({
    contextWindowTokens: input.contextWindowTokens,
    messageTokens: estimateModelMessagesTokens(input.messages),
    reserveTokens: input.reserveTokens,
    systemPromptTokens: input.systemPromptTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    triggerRatio: input.triggerRatio,
  })
}

export function shouldCompactContext(budget: ContextBudget) {
  return budget.totalTokens >= budget.triggerTokens && budget.messageTokens > budget.targetHistoryTokens
}
