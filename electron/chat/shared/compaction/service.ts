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
import { buildCompactionProjection, buildCompactionRuntimeMessages } from './projection'
import { resolveLatestConversationUser, retainedMessageTokens } from './conversationRetention'
import { appendCodeModeReceiptsToSummary } from './codeModeReceipts'
import { resolveProviderReasoningCapability, resolveReasoningRetention } from './reasoning'
import { validateContinuationMarkdown } from './markdown'
import { COMPACTION_MAX_OUTPUT_TOKENS } from './contracts'
import { reconcileDurableMemory } from './durableMemory'
import { CompactionError } from './gate'
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
const cancellationScopes = new WeakMap<AbortSignal, string>()
const inFlightCompactions = new Map<string, Promise<CompactionResult | null>>()

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

export function minimumCompactionRetentionTokens(
  messages: readonly import('ai').ModelMessage[],
  previousPacket: CompactionPacket | null,
  turnState: CompactionTurnState,
) {
  const latestUser = resolveLatestConversationUser(messages)
  const userTokens = latestUser ? retainedMessageTokens([latestUser.message]) : 0
  const runtimeTokens = retainedMessageTokens(buildCompactionRuntimeMessages(messages, true))
  const receipts = appendActiveTurnGuard(appendCodeModeReceiptsToSummary(
    '', messages, previousPacket?.continuationMarkdown,
  ), turnState)
  const receiptTokens = retainedMessageTokens([{ role: 'assistant', content: receipts }])
  // Same 40% worker-output allocation and minimum useful output as the worker pipeline.
  return userTokens + runtimeTokens + Math.ceil((receiptTokens + 64 + 128) / 0.4)
}

async function collectCompactionText(input: CompactModelMessagesInput, prompt: string, maxOutputTokens: number) {
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
      maxOutputTokens,
      model: input.model,
      providerId: input.providerId,
      reasoningEffort: input.reasoningEffort,
      signal: abortController.signal,
      system: buildCompactionSystemPrompt(),
      operation: 'handoff',
      onStepEnd: (step) => input.onWorkerUsage?.('handoff', step.usage),
    })
    let text = ''
    for await (const part of stream.fullStream) {
      if (part.type === 'text-delta' && typeof part.text === 'string') text += part.text
    }
    if (abortController.signal.aborted && !input.signal?.aborted) {
      throw new CompactionError('worker_timeout')
    }
    return text.trim()
  } catch (error) {
    if (input.signal?.aborted) return null
    if (error instanceof CompactionError) {
      throw error
    }
    const reason = abortController.signal.aborted ? 'worker_timeout' : 'worker_error'
    throw new CompactionError(reason, { cause: error })
  } finally {
    clearTimeout(timeoutId)
    input.signal?.removeEventListener('abort', handleParentAbort)
  }
}

function cancellationScope(signal: AbortSignal | undefined) {
  if (!signal) {
    return null
  }
  let scope = cancellationScopes.get(signal)
  if (!scope) {
    scope = randomUUID()
    cancellationScopes.set(signal, scope)
  }
  return scope
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
    cancellationScope(input.signal),
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

async function compactModelMessagesInternal(
  input: CompactModelMessagesInput,
  window: import('./contracts').CompactionWindow,
  retainedContextTokens: number,
): Promise<CompactionResult | null> {
  const previousPacket = input.previousPacket ?? null
  const turnState = input.turnState ?? 'settled'
  const latestUser = resolveLatestConversationUser(input.messages)
  const latestUserSourceMessageId = latestUser ? `model:${latestUser.index}` : null
  const latestUserMessage = latestUser?.message
  if (input.signal?.aborted) return null

  // The rebuild may shorten the recent tail as well as replace older turns.
  // Both workers must see that evidence before any of it leaves raw context.
  const workerMessages = input.messages.slice(window.sourceStartIndex)

  const runtimeTokens = retainedMessageTokens(buildCompactionRuntimeMessages(input.messages, true))
  const latestUserTokens = latestUserMessage ? retainedMessageTokens([latestUserMessage]) : 0
  const receiptAndGuard = appendActiveTurnGuard(appendCodeModeReceiptsToSummary(
    '', workerMessages, previousPacket?.continuationMarkdown,
  ), turnState)
  const receiptAndGuardTokens = retainedMessageTokens([{ role: 'assistant', content: receiptAndGuard }])
  // Reserve the full newest request and runtime instructions before asking the
  // worker to write. Leave most remaining space for verbatim recent intent and
  // useful assistant output; final projection enforces the complete budget.
  const summaryOutputTokens = Math.min(COMPACTION_MAX_OUTPUT_TOKENS, Math.floor(
    (retainedContextTokens - runtimeTokens - latestUserTokens) * 0.4,
  ) - receiptAndGuardTokens - 64)
  if (summaryOutputTokens < 128) {
    throw new CompactionError('protected_context_too_large')
  }

  input.onStarted?.()
  const sourceDigest = buildCompactionSourceDigest(
    input.messages,
    window.sourceEndIndex,
    window.sourceStartIndex,
  )
  const durableMemory = await reconcileDurableMemory({
    createStream: input.createStream,
    messages: workerMessages,
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
    onWorkerUsage: input.onWorkerUsage,
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
    messages: workerMessages,
    previousPacket,
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
    sourceStartIndex: window.sourceStartIndex,
    turnState,
  })
  const budgetedPrompt = `${prompt}\n\nThe transcript includes recent evidence that may be shortened or omitted from the rebuilt history. Source message IDs identify the older eviction boundary; assess the full supplied transcript, including newer results.\nHandoff size limit: at most ${summaryOutputTokens * 3} characters. Consolidate relevant requirements, supported progress and remaining obligations within this limit; do not enumerate historical prompts.`
  const rawSummary = await collectCompactionText(input, budgetedPrompt, summaryOutputTokens)
  if (input.signal?.aborted || rawSummary === null) return null
  const summary = validateContinuationMarkdown(rawSummary)
  if (!summary.valid) {
    throw new CompactionError('invalid_handoff')
  }
  const summaryMarkdown = removeUserPromptLedgerFromSummary(summary.normalized)
  const summaryWithReceipts = appendCodeModeReceiptsToSummary(
    summaryMarkdown,
    workerMessages,
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
  const retainedContextTokens = input.selectedWindow
    ? Math.min(input.retainedContextTokens ?? budget.targetHistoryTokens, budget.availableHistoryTokens)
    : resolveRetainedContextTokens(input.retainedContextTokens, budget)
  if (!input.selectedWindow && !input.force && !shouldCompactContext(budget)) return null

  const previousPacket = input.previousPacket ?? null
  const window = input.selectedWindow ?? selectCompactionWindow(input.messages, budget.targetHistoryTokens, {
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

  const work = compactModelMessagesInternal(input, window, retainedContextTokens).finally(() => {
    if (inFlightCompactions.get(key) === work) inFlightCompactions.delete(key)
  })
  inFlightCompactions.set(key, work)
  return work
}
