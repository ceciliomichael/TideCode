import type { ModelMessage } from 'ai'
import type { ContextUsageEstimate } from '../../../../src/types/chat'
import {
  approximateTokenCount,
  estimateModelMessageContextUsage,
} from '../../../../src/lib/contextUsage'
import {
  capRetainedContextTokens,
  DEFAULT_CONTEXT_COMPACTION_SETTINGS,
} from '../../../../src/lib/contextCompactionSettings'

export const DEFAULT_CONTEXT_WINDOW_TOKENS = DEFAULT_CONTEXT_COMPACTION_SETTINGS.contextWindowTokens
export const DEFAULT_COMPACTION_TRIGGER_RATIO = DEFAULT_CONTEXT_COMPACTION_SETTINGS.triggerPercent / 100
export const DEFAULT_CONTEXT_OUTPUT_RESERVE_TOKENS = 20_000
const COMPACTION_RETENTION_RATIO = 0.1

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

export interface ModelMessagesContextState {
  budget: ContextBudget
  usage: ContextUsageEstimate
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
    // Match the percentage displayed by ContextIndicator. The output reserve
    // still protects generation capacity and shapes the retained history, but
    // it must not silently lower an 80% user setting to 72% of the full window.
    triggerTokens: Math.floor(contextWindowTokens * triggerRatio),
    usableContextWindowTokens,
  }
}

export function calculateModelMessagesContextState(input: ModelMessagesBudgetInput): ModelMessagesContextState {
  const messageUsage = estimateModelMessageContextUsage(input.messages)
  const budget = calculateContextBudget({
    contextWindowTokens: input.contextWindowTokens,
    messageTokens: messageUsage.totalTokens,
    outputReserveTokens: input.outputReserveTokens,
    systemPromptTokens: input.systemPromptTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    triggerRatio: input.triggerRatio,
  })
  const systemPromptTokens = Math.max(0, Math.floor(input.systemPromptTokens + input.toolSchemaTokens))

  return {
    budget,
    usage: {
      historyTokens: messageUsage.historyTokens,
      maxTokens: budget.contextWindowTokens,
      systemPromptTokens,
      toolResultsTokens: messageUsage.toolResultsTokens,
      totalTokens: budget.totalTokens,
    },
  }
}

export function calculateModelMessagesBudget(input: ModelMessagesBudgetInput) {
  return calculateModelMessagesContextState(input).budget
}

export function resolveRetainedContextTokens(
  requestedTokens: number | undefined,
  budget: ContextBudget,
) {
  const requested = capRetainedContextTokens(requestedTokens ?? budget.targetHistoryTokens)
  // The target-history budget already reserves generation capacity and static
  // prompt overhead. Cap the retention target here so a small context window
  // cannot produce a compacted projection that immediately remains over its
  // own automatic-compaction trigger.
  return Math.min(requested, budget.targetHistoryTokens)
}

export function shouldCompactContext(budget: ContextBudget) {
  // This is intentionally the same full-window comparison shown by the
  // context indicator. Whether there is enough complete history to reduce is
  // decided by the turn-aware compaction window, not by a second token target.
  return budget.totalTokens >= budget.triggerTokens && budget.messageTokens > 0
}
