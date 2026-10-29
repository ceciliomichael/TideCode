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
import { CompactionError } from './gate'

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
  correctionTokens?: number
}

export interface ContextBudget {
  availableHistoryTokens: number
  admissionTokens: number
  uncertaintyTokens: number
  correctionTokens: number
  minimumSavingTokens: number
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
  correctionTokens?: number
}

export interface ModelMessagesContextState {
  budget: ContextBudget
  usage: ContextUsageEstimate
}

export function calculateContextBudget(input: ContextBudgetInput): ContextBudget {
  const contextWindowTokens = Math.floor(input.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS)
  const values = [contextWindowTokens, input.systemPromptTokens, input.toolSchemaTokens, input.messageTokens,
    input.outputReserveTokens ?? 0, input.correctionTokens ?? 0]
  if (values.some((value) => !Number.isFinite(value) || value < 0) || contextWindowTokens < 1) {
    throw new CompactionError('invalid_context_budget')
  }
  const outputReserveTokens = Math.min(
    Math.max(0, Math.floor(input.outputReserveTokens ?? DEFAULT_CONTEXT_OUTPUT_RESERVE_TOKENS)),
    Math.floor(contextWindowTokens * 0.25),
  )
  const uncertaintyTokens = Math.max(1_024, Math.ceil(contextWindowTokens * 0.05))
  const admissionTokens = contextWindowTokens - outputReserveTokens - uncertaintyTokens
  if (admissionTokens <= 0) {
    throw new CompactionError('invalid_context_budget')
  }
  const correctionTokens = Math.max(0, Math.floor(input.correctionTokens ?? 0))
  const usableContextWindowTokens = admissionTokens
  const triggerRatio = Math.min(0.95, Math.max(0.5, input.triggerRatio ?? DEFAULT_COMPACTION_TRIGGER_RATIO))
  const staticTokens = Math.max(0, Math.floor(input.systemPromptTokens + input.toolSchemaTokens))
  const totalTokens = staticTokens + Math.max(0, input.messageTokens)
  const availableHistoryTokens = Math.max(0, admissionTokens - staticTokens - correctionTokens)
  const targetHistoryTokens = Math.min(
    availableHistoryTokens,
    Math.max(0, Math.floor(usableContextWindowTokens * COMPACTION_RETENTION_RATIO - staticTokens)),
  )

  return {
    availableHistoryTokens,
    admissionTokens,
    uncertaintyTokens,
    correctionTokens,
    minimumSavingTokens: Math.max(1_024, Math.ceil(contextWindowTokens * 0.02)),
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
    correctionTokens: input.correctionTokens,
  })
  return {
    budget,
    usage: {
      imageTokens: messageUsage.imageTokens,
      outputReserveTokens: budget.outputReserveTokens,
      uncertaintyTokens: budget.uncertaintyTokens + budget.correctionTokens,
      admissionTokens: budget.admissionTokens,
      triggerTokens: budget.triggerTokens,
      historyTokens: messageUsage.historyTokens,
      injectionTokens: messageUsage.injectionTokens,
      maxTokens: budget.contextWindowTokens,
      systemPromptTokens: input.systemPromptTokens,
      toolSchemaTokens: input.toolSchemaTokens,
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
  return budget.totalTokens + budget.correctionTokens >= Math.min(budget.triggerTokens, budget.admissionTokens + 1) && budget.messageTokens > 0
}

export function requiresContextCompaction(budget: ContextBudget) {
  return budget.totalTokens + budget.correctionTokens > budget.admissionTokens
}
