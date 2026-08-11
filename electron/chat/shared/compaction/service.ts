import { randomUUID } from 'node:crypto'
import {
  calculateModelMessagesBudget,
  shouldCompactContext,
} from './budget'
import {
  buildCompactionRequestPrompt,
  buildCompactionSystemPrompt,
} from './prompt'
import {
  buildFallbackCompactionPacket,
} from './fallback'
import {
  buildCompactionSourceDigest,
  selectCompactionWindow,
} from './window'
import { buildCompactionProjection } from './projection'
import {
  mergeCompactionPacketState,
  resolveProviderReasoningCapability,
  resolveReasoningRetention,
} from './reasoning'
import {
  parseCompactionModelOutput,
  normalizeCompactionPacket,
} from './validate'
import { buildContinuationMarkdownFromPacket, validateContinuationMarkdown } from './markdown'
import type {
  CompactionPacket,
  CompactModelMessagesInput,
  CompactionResult,
  LocalCompactionPacketV2,
} from './contracts'

const COMPACTION_TIMEOUT_MS = 90_000
const inFlightCompactions = new Map<string, Promise<CompactionResult | null>>()

async function collectCompactionText(input: CompactModelMessagesInput, prompt: string) {
  if (!input.createStream) return null
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), COMPACTION_TIMEOUT_MS)
  if (input.signal) {
    if (input.signal.aborted) abortController.abort()
    else input.signal.addEventListener('abort', () => abortController.abort(), { once: true })
  }

  try {
    const stream = await input.createStream({
      messages: [{ role: 'user', content: prompt }],
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
    console.warn('Local compaction summarizer failed; using deterministic recovery.', error)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildCompactionKey(
  input: CompactModelMessagesInput,
  boundaryIndex: number,
  sourceDigest: string,
  previousPacket: CompactionPacket | null,
) {
  return JSON.stringify([
    input.model,
    input.providerId ?? 'unknown',
    input.reasoningEffort,
    boundaryIndex,
    sourceDigest,
    previousPacket?.packetId ?? null,
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
  if (!input.force && !shouldCompactContext(budget)) return null

  const previousPacket = input.previousPacket ?? null
  const window = selectCompactionWindow(input.messages, budget.targetHistoryTokens, { previousPacket })
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
  if (input.signal?.aborted) return null
  const parsedModelPacket = rawSummary
    ? parseCompactionModelOutput(rawSummary, {
        modelId: input.model,
        parentPacketId: previousPacket?.packetId ?? null,
        providerId: input.providerId,
        reasoningMode: actualRetention.mode,
        sourceDigest,
        sourceMessageIds: window.sourceMessageIds,
        sourceRange: {
          endIndex: window.sourceEndIndex,
          startIndex: window.sourceStartIndex,
        },
      })
    : null
  const fallbackPacket = buildFallbackCompactionPacket({
    messages: window.evictedMessages,
    modelId: input.model,
    parentPacketId: previousPacket?.packetId ?? null,
    providerId: input.providerId,
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
    sourceStartIndex: window.sourceStartIndex,
    sourceRange: {
      endIndex: window.sourceEndIndex,
      startIndex: window.sourceStartIndex,
    },
    previousPacket,
  })
  const plainMarkdown = rawSummary ? validateContinuationMarkdown(rawSummary) : null
  const modelPacket = parsedModelPacket ?? (plainMarkdown?.valid
    ? { ...fallbackPacket, continuationMarkdown: plainMarkdown.normalized }
    : null)
  const normalizedPacket = normalizeCompactionPacket(modelPacket ?? fallbackPacket, {
    modelId: input.model,
    parentPacketId: previousPacket?.packetId ?? null,
    providerId: input.providerId,
    reasoningMode: actualRetention.mode,
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
    sourceRange: {
      endIndex: window.sourceEndIndex,
      startIndex: window.sourceStartIndex,
    },
  })
  if (!normalizedPacket) return null

  const mergedPacket = mergeCompactionPacketState({
    current: normalizedPacket,
    parentPacketId: previousPacket?.packetId ?? null,
    previous: previousPacket,
  })
  const packet = parsedModelPacket
    ? {
        ...mergedPacket,
        continuationMarkdown: buildContinuationMarkdownFromPacket(mergedPacket),
      }
    : mergedPacket
  const projectedMessages = buildCompactionProjection({
    anchorMessages: window.anchorMessages,
    packet,
    tailBudgetTokens: budget.targetHistoryTokens,
    tailMessages: window.tailMessages,
  })

  return {
    boundaryIndex: window.boundaryIndex,
    packet,
    projectedMessages,
    projectionVersion: 'tidecode.compaction_projection/v2',
    reasoningRetention: packet.reasoningRetention,
    sourceDigest,
    usedFallback: parsedModelPacket === null && !plainMarkdown?.valid,
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
  if (!input.force && !shouldCompactContext(budget)) return null

  const previousPacket = input.previousPacket ?? null
  const window = selectCompactionWindow(input.messages, budget.targetHistoryTokens, { previousPacket })
  if (!window) return null
  const sourceDigest = buildCompactionSourceDigest(
    input.messages,
    window.sourceEndIndex,
    window.sourceStartIndex,
  )
  const key = buildCompactionKey(input, window.boundaryIndex, sourceDigest, previousPacket)
  const existing = inFlightCompactions.get(key)
  if (existing) return existing

  const work = compactModelMessagesInternal(input).finally(() => {
    if (inFlightCompactions.get(key) === work) inFlightCompactions.delete(key)
  })
  inFlightCompactions.set(key, work)
  return work
}

export function createEmptyCompactionPacket(sourceDigest: string, sourceMessageIds: string[]): LocalCompactionPacketV2 {
  const packet: LocalCompactionPacketV2 = {
    schema: 'tidecode.compaction_packet/v2',
    packetId: randomUUID(),
    parentPacketId: null,
    sourceDigest,
    sourceMessageIds,
    continuationMarkdown: '',
    reasoningRetention: {
      mode: 'unavailable',
      modelId: 'unknown-model',
      note: 'No reasoning representation was supplied.',
      providerId: 'unknown',
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
    nextActions: [],
    omitted: [],
  }
  return {
    ...packet,
    continuationMarkdown: buildContinuationMarkdownFromPacket(packet),
  }
}
