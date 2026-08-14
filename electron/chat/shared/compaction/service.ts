import { randomUUID } from 'node:crypto'
import {
  calculateModelMessagesBudget,
  resolveRetainedContextTokens,
  shouldCompactContext,
} from './budget'
import {
  buildCompactionRequestPrompt,
  buildCompactionSystemPrompt,
} from './prompt'
import {
  buildCompactionSourceDigest,
  selectCompactionWindow,
} from './window'
import { buildCompactionProjection } from './projection'
import { appendCodeModeReceiptsToSummary } from './codeModeReceipts'
import { resolveProviderReasoningCapability, resolveReasoningRetention } from './reasoning'
import { validateContinuationMarkdown } from './markdown'
import { COMPACTION_MAX_OUTPUT_TOKENS } from './contracts'
import { estimateModelMessageContextUsage } from '../../../../src/lib/contextUsage'
import {
  appendUserPromptLedgerToSummary,
  extractUserPromptLedgerEntries,
  extractHistoricalUserPromptLedgerEntries,
  mergeUserPromptLedger,
  selectNewestUserPromptLedger,
} from './userPromptLedger'
import type {
  CompactionPacket,
  CompactModelMessagesInput,
  CompactionResult,
  LocalCompactionPacketV2,
} from './contracts'

const COMPACTION_TIMEOUT_MS = 90_000
const inFlightCompactions = new Map<string, Promise<CompactionResult | null>>()

async function collectCompactionText(input: CompactModelMessagesInput, prompt: string) {
  if (!input.createStream) {
    throw new Error('AI compaction is unavailable because no compaction model stream was provided.')
  }
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), COMPACTION_TIMEOUT_MS)
  if (input.signal) {
    if (input.signal.aborted) abortController.abort()
    else input.signal.addEventListener('abort', () => abortController.abort(), { once: true })
  }

  try {
    const stream = await input.createStream({
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
      model: input.model,
      providerId: input.providerId,
      reasoningEffort: input.reasoningEffort,
      signal: abortController.signal,
      system: buildCompactionSystemPrompt(),
    })
    let text = ''
    for await (const part of stream.fullStream) {
      if (part.type === 'text-delta' && typeof part.text === 'string') text += part.text
    }
    return text.trim()
  } catch (error) {
    if (input.signal?.aborted) return null
    throw new Error(
      `AI compaction failed: ${error instanceof Error ? error.message : 'the model stream failed'}`,
      { cause: error },
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildCompactionKey(
  input: CompactModelMessagesInput,
  boundaryIndex: number,
  sourceDigest: string,
  previousPacket: CompactionPacket | null,
  retainedContextTokens: number,
) {
  return JSON.stringify([
    input.model,
    input.providerId ?? 'unknown',
    input.reasoningEffort,
    boundaryIndex,
    sourceDigest,
    previousPacket?.packetId ?? null,
    retainedContextTokens,
  ])
}

async function compactModelMessagesInternal(input: CompactModelMessagesInput): Promise<CompactionResult | null> {
  const budget = calculateModelMessagesBudget({
    contextWindowTokens: input.contextWindowTokens,
    messages: input.messages,
    systemPromptTokens: input.systemPromptTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    triggerRatio: input.triggerRatio,
  })
  const retainedContextTokens = resolveRetainedContextTokens(input.retainedContextTokens, budget)
  if (!input.force && !shouldCompactContext(budget)) return null

  const previousPacket = input.previousPacket ?? null
  const window = selectCompactionWindow(input.messages, budget.targetHistoryTokens, {
    force: input.force,
    previousPacket,
    retainedContextTokens,
  })
  if (!window) return null
  if (input.signal?.aborted) return null

  input.onStarted?.()
  const sourceDigest = buildCompactionSourceDigest(
    input.messages,
    window.sourceEndIndex,
    window.sourceStartIndex,
  )
  const capability = resolveProviderReasoningCapability({
    modelId: input.model,
    providerId: input.providerId,
  })
  const actualRetention = resolveReasoningRetention({
    capability,
    messages: window.evictedMessages,
  })
  const prompt = buildCompactionRequestPrompt({
    messages: window.evictedMessages,
    previousPacket,
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
    sourceStartIndex: window.sourceStartIndex,
  })
  const rawSummary = await collectCompactionText(input, prompt)
  if (input.signal?.aborted || rawSummary === null) return null
  const summary = validateContinuationMarkdown(rawSummary)
  if (!summary.valid) {
    throw new Error(`AI compaction returned invalid Markdown (${summary.reason}); no fallback summary was generated.`)
  }
  const summaryWithReceipts = appendCodeModeReceiptsToSummary(
    summary.normalized,
    window.evictedMessages,
    previousPacket?.continuationMarkdown,
  )
  const allUserPromptLedger = mergeUserPromptLedger(
    previousPacket?.userPromptLedger ?? [],
    mergeUserPromptLedger(
      extractUserPromptLedgerEntries(window.evictedMessages, window.sourceStartIndex),
      extractHistoricalUserPromptLedgerEntries(window.tailMessages, window.sourceEndIndex),
    ),
  )
  const summaryTokens = estimateModelMessageContextUsage([{
    content: summaryWithReceipts,
    role: 'assistant',
  }]).totalTokens
  const tailReserveTokens = Math.max(1, Math.floor(retainedContextTokens * 0.3))
  const ledgerBudget = Math.max(0, retainedContextTokens - summaryTokens - tailReserveTokens)
  const userPromptLedger = selectNewestUserPromptLedger(allUserPromptLedger, ledgerBudget)
  const continuationCandidate = appendUserPromptLedgerToSummary(summaryWithReceipts, userPromptLedger)
  const continuation = validateContinuationMarkdown(continuationCandidate)
  if (!continuation.valid) {
    throw new Error(`Compaction handoff became invalid after adding the user prompt ledger (${continuation.reason}).`)
  }
  const packet: LocalCompactionPacketV2 = {
    schema: 'tidecode.compaction_packet/v2',
    packetId: randomUUID(),
    parentPacketId: previousPacket?.packetId ?? null,
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
    continuationMarkdown: continuation.normalized,
    reasoningRetention: {
      ...actualRetention,
      providerId: input.providerId?.trim() || actualRetention.providerId,
    },
    reasoningContinuity: [],
    goal: [],
    constraints: [],
    currentState: [],
    completedWork: [],
    decisions: [],
    openItems: [],
    failuresAndWorkarounds: [],
    filesAndSymbols: [],
    validation: [],
    planState: [],
    toolObservations: [],
    userPromptLedger,
    nextActions: [],
    omitted: [],
    sourceRange: {
      endIndex: window.sourceEndIndex,
      startIndex: window.sourceStartIndex,
    },
  }
  const projectedMessages = buildCompactionProjection({
    anchorMessages: window.anchorMessages,
    packet,
    tailMessages: window.tailMessages,
    retainedContextTokens,
  })

  return {
    boundaryIndex: window.boundaryIndex,
    packet,
    projectedMessages,
    projectionVersion: 'tidecode.compaction_projection/v2',
    reasoningRetention: packet.reasoningRetention,
    sourceDigest,
  }
}

export async function compactModelMessages(input: CompactModelMessagesInput) {
  const budget = calculateModelMessagesBudget({
    contextWindowTokens: input.contextWindowTokens,
    messages: input.messages,
    systemPromptTokens: input.systemPromptTokens,
    toolSchemaTokens: input.toolSchemaTokens,
    triggerRatio: input.triggerRatio,
  })
  const retainedContextTokens = resolveRetainedContextTokens(input.retainedContextTokens, budget)
  if (!input.force && !shouldCompactContext(budget)) return null

  const previousPacket = input.previousPacket ?? null
  const window = selectCompactionWindow(input.messages, budget.targetHistoryTokens, {
    force: input.force,
    previousPacket,
    retainedContextTokens,
  })
  if (!window) return null
  const sourceDigest = buildCompactionSourceDigest(
    input.messages,
    window.sourceEndIndex,
    window.sourceStartIndex,
  )
  const key = buildCompactionKey(input, window.boundaryIndex, sourceDigest, previousPacket, retainedContextTokens)
  const existing = inFlightCompactions.get(key)
  if (existing) return existing

  const work = compactModelMessagesInternal(input).finally(() => {
    if (inFlightCompactions.get(key) === work) inFlightCompactions.delete(key)
  })
  inFlightCompactions.set(key, work)
  return work
}
