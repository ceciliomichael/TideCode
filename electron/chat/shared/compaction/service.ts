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
import { reconcileDurableMemory } from './durableMemory'
import {
  extractUserPromptLedgerEntries,
  mergeUserPromptLedger,
  selectNewestUserPromptLedger,
  removeUserPromptLedgerFromSummary,
} from './userPromptLedger'
import type {
  CompactionPacket,
  CompactModelMessagesInput,
  CompactionResult,
  CompactionTurnState,
  LocalCompactionPacketV2,
} from './contracts'

const COMPACTION_TIMEOUT_MS = 90_000
const inFlightCompactions = new Map<string, Promise<CompactionResult | null>>()

function resolveLatestUserSourceMessageId(messages: readonly { role: string }[]) {
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user')
  return latestUserIndex >= 0 ? `model:${latestUserIndex}` : null
}

function appendActiveTurnGuard(summary: string, turnState: CompactionTurnState) {
  if (turnState !== 'active') return summary
  return [
    summary.trim(),
    '',
    '## Runtime continuation',
    '- Host runtime status: the assistant turn is still active. Compaction is an intermediate boundary, not a final response or proof that the overall request is complete.',
    '- Resume from the supported state. Retain completed substeps, address remaining obligations, and provide the response still owed to the user. Do not repeat work merely because this turn is active.',
  ].join('\n').trim()
}

async function collectCompactionText(input: CompactModelMessagesInput, prompt: string) {
  if (!input.createStream) {
    throw new Error('AI compaction is unavailable because no compaction model stream was provided.')
  }
  const abortController = new AbortController()
  const handleParentAbort = () => abortController.abort()
  const timeoutId = setTimeout(() => abortController.abort(), COMPACTION_TIMEOUT_MS)
  if (input.signal) {
    if (input.signal.aborted) {
      abortController.abort()
    } else {
      input.signal.addEventListener('abort', handleParentAbort, { once: true })
    }
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
    input.signal?.removeEventListener('abort', handleParentAbort)
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
    input.conversationId ?? null,
    input.model,
    input.providerId ?? 'unknown',
    input.reasoningEffort,
    boundaryIndex,
    sourceDigest,
    previousPacket?.packetId ?? null,
    input.previousMemory?.sourceDigest ?? null,
    retainedContextTokens,
    input.turnState ?? 'settled',
    buildCompactionSourceDigest(input.messages, input.messages.length),
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
  const turnState = input.turnState ?? 'settled'
  const latestUserSourceMessageId = resolveLatestUserSourceMessageId(input.messages)
  const latestUserMessage = input.messages.findLast((message) => message.role === 'user')
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
  const durableMemory = await reconcileDurableMemory({
    createStream: input.createStream,
    messages: window.evictedMessages,
    latestUserMessage,
    latestUserSourceMessageId,
    model: input.model,
    providerId: input.providerId,
    previousMemory: input.previousMemory,
    previousContinuation: previousPacket?.continuationMarkdown,
    reasoningEffort: input.reasoningEffort,
    signal: input.signal,
    sourceDigest,
    sourceStartIndex: window.sourceStartIndex,
    turnState,
  })
  if (!durableMemory) {
    throw new Error('Durable-memory reconciliation did not produce a workspace memory snapshot.')
  }
  if (input.signal?.aborted) return null
  const capability = resolveProviderReasoningCapability({
    modelId: input.sourceModel ?? input.model,
    providerId: input.sourceProviderId ?? input.providerId,
  })
  const actualRetention = resolveReasoningRetention({
    capability,
    messages: window.evictedMessages,
  })
  const prompt = buildCompactionRequestPrompt({
    durableMemory,
    latestUserSourceMessageId,
    latestUserMessage,
    messages: window.evictedMessages,
    previousPacket,
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
    sourceStartIndex: window.sourceStartIndex,
    turnState,
  })
  const rawSummary = await collectCompactionText(input, prompt)
  if (input.signal?.aborted || rawSummary === null) return null
  const summary = validateContinuationMarkdown(rawSummary)
  if (!summary.valid) {
    throw new Error(`AI compaction returned invalid continuation Markdown (${summary.reason}).`)
  }
  const summaryMarkdown = removeUserPromptLedgerFromSummary(summary.normalized)
  const summaryWithReceipts = appendCodeModeReceiptsToSummary(
    summaryMarkdown,
    window.evictedMessages,
    previousPacket?.continuationMarkdown,
  )
  const guardedSummary = appendActiveTurnGuard(summaryWithReceipts, turnState)
  const allUserPromptLedger = mergeUserPromptLedger(
    previousPacket?.userPromptLedger ?? [],
    extractUserPromptLedgerEntries(window.evictedMessages, window.sourceStartIndex, {
      latestUserSourceMessageId,
      turnState,
    }),
  )
  // Intent metadata is bounded independently; it consumes no continuation space.
  const ledgerBudget = Math.min(1_000, Math.floor(retainedContextTokens * 0.15))
  const userPromptLedger = selectNewestUserPromptLedger(allUserPromptLedger, ledgerBudget)
  const continuation = validateContinuationMarkdown(guardedSummary)
  if (!continuation.valid) {
    throw new Error(`Compaction handoff became invalid after reconciliation (${continuation.reason}).`)
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
      providerId: input.sourceProviderId?.trim() || input.providerId?.trim() || actualRetention.providerId,
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
    contextMessages: input.messages,
    durableMemory,
    includeDurableMemoryMessage: true,
    packet,
    tailMessages: window.tailMessages,
    retainedContextTokens,
  })

  return {
    boundaryIndex: window.boundaryIndex,
    durableMemory,
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
