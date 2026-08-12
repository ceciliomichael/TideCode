import type { ModelMessage } from 'ai'
import {
  approximateTokenCount,
  estimateModelMessageContextUsage,
} from '../../../../src/lib/contextUsage'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../../../src/lib/contextCompactionSettings'

export const DEFAULT_CONTEXT_WINDOW_TOKENS = DEFAULT_CONTEXT_COMPACTION_SETTINGS.contextWindowTokens
export const DEFAULT_COMPACTION_TRIGGER_RATIO = DEFAULT_CONTEXT_COMPACTION_SETTINGS.triggerPercent / 100
export const DEFAULT_CONTEXT_OUTPUT_RESERVE_TOKENS = 20_000
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
  outputReserveTokens?: number
  triggerRatio?: number
}

export interface ContextBudget {
  availableHistoryTokens: number
  contextWindowTokens: number
  messageTokens: number
  outputReserveTokens: number
  targetHistoryTokens: number
  totalTokens: number
  triggerTokens: number
  usableContextWindowTokens: number
}

export interface ModelMessagesBudgetInput {
  contextWindowTokens?: number
  messages: readonly ModelMessage[]
  outputReserveTokens?: number
  systemPromptTokens: number
  toolSchemaTokens: number
  triggerRatio?: number
}

export function calculateContextBudget(input: ContextBudgetInput): ContextBudget {
  const contextWindowTokens = Math.max(
    16_000,
    Math.floor(input.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS),
  )
  const outputReserveTokens = Math.min(
    Math.max(0, Math.floor(input.outputReserveTokens ?? DEFAULT_CONTEXT_OUTPUT_RESERVE_TOKENS)),
    Math.floor(contextWindowTokens * 0.25),
  )
  const usableContextWindowTokens = Math.max(8_000, contextWindowTokens - outputReserveTokens)
  const triggerRatio = Math.min(0.95, Math.max(0.5, input.triggerRatio ?? DEFAULT_COMPACTION_TRIGGER_RATIO))
  const staticTokens = Math.max(0, Math.floor(input.systemPromptTokens + input.toolSchemaTokens))
  const totalTokens = staticTokens + Math.max(0, input.messageTokens)
  const availableHistoryTokens = Math.max(1_000, usableContextWindowTokens - staticTokens)
  const targetHistoryTokens = Math.max(
    2_000,
    Math.min(availableHistoryTokens, Math.floor(usableContextWindowTokens * COMPACTION_RETENTION_RATIO - staticTokens)),
  )

  return {
    availableHistoryTokens,
    contextWindowTokens,
    messageTokens: Math.max(0, input.messageTokens),
    outputReserveTokens,
    targetHistoryTokens,
    totalTokens,
    triggerTokens: Math.floor(usableContextWindowTokens * triggerRatio),
    usableContextWindowTokens,
  }
}

export function calculateModelMessagesBudget(input: ModelMessagesBudgetInput) {
  return calculateContextBudget({
    contextWindowTokens: input.contextWindowTokens,
    messageTokens: estimateModelMessagesTokens(input.messages),
    outputReserveTokens: input.outputReserveTokens,
    systemPromptTokens: input.systemPromptTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    triggerRatio: input.triggerRatio,
  })
}

export function shouldCompactContext(budget: ContextBudget) {
  return budget.totalTokens >= budget.triggerTokens && budget.messageTokens > budget.targetHistoryTokens
}
