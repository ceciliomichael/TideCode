import { randomUUID } from 'node:crypto'
import {
  calculateContextBudget,
  estimateModelMessagesTokens,
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
  buildCompactionMessage,
  buildCompactionSourceDigest,
  findLatestCompactionPacket,
  selectCompactionWindow,
} from './window'
import {
  parseCompactionModelOutput,
  normalizeCompactionPacket,
} from './validate'
import type {
  CompactModelMessagesInput,
  CompactionResult,
  LocalCompactionPacket,
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

function buildCompactionKey(input: CompactModelMessagesInput, boundaryIndex: number, sourceDigest: string) {
  return JSON.stringify([input.model, input.reasoningEffort, boundaryIndex, sourceDigest])
}

async function compactModelMessagesInternal(input: CompactModelMessagesInput): Promise<CompactionResult | null> {
  const messageTokens = estimateModelMessagesTokens(input.messages)
  const budget = calculateContextBudget({
    contextWindowTokens: input.contextWindowTokens,
    messageTokens,
    reserveTokens: input.reserveTokens,
    systemPromptTokens: input.systemPromptTokens,
    targetRatio: input.targetRatio,
    toolSchemaTokens: input.toolSchemaTokens,
    triggerRatio: input.triggerRatio,
  })
  if (!input.force && !shouldCompactContext(budget)) return null

  const window = selectCompactionWindow(input.messages, budget.targetHistoryTokens)
  if (!window) return null
  const sourceDigest = buildCompactionSourceDigest(input.messages, window.boundaryIndex)
  const previousPacket = input.previousPacket ?? findLatestCompactionPacket(input.messages)
  const prompt = buildCompactionRequestPrompt({
    messages: window.evictedMessages,
    previousPacket,
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
  })
  const rawSummary = await collectCompactionText(input, prompt)
  if (input.signal?.aborted) return null
  const modelPacket = rawSummary
    ? parseCompactionModelOutput(rawSummary, {
        sourceDigest,
        sourceMessageIds: window.sourceMessageIds,
      })
    : null
  const packet = normalizeCompactionPacket(modelPacket ?? buildFallbackCompactionPacket({
    messages: window.evictedMessages,
    previousPacket,
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
  }), {
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
  })
  if (!packet) return null

  return {
    boundaryIndex: window.boundaryIndex,
    packet,
    projectedMessages: [
      ...window.anchorMessages,
      buildCompactionMessage(packet),
      ...window.tailMessages,
    ],
    sourceDigest,
    usedFallback: modelPacket === null,
  }
}

export async function compactModelMessages(input: CompactModelMessagesInput) {
  const messageTokens = estimateModelMessagesTokens(input.messages)
  const budget = calculateContextBudget({
    contextWindowTokens: input.contextWindowTokens,
    messageTokens,
    reserveTokens: input.reserveTokens,
    systemPromptTokens: input.systemPromptTokens,
    targetRatio: input.targetRatio,
    toolSchemaTokens: input.toolSchemaTokens,
    triggerRatio: input.triggerRatio,
  })
  if (!input.force && !shouldCompactContext(budget)) return null

  const window = selectCompactionWindow(input.messages, budget.targetHistoryTokens)
  if (!window) return null
  const sourceDigest = buildCompactionSourceDigest(input.messages, window.boundaryIndex)
  const key = buildCompactionKey(input, window.boundaryIndex, sourceDigest)
  const existing = inFlightCompactions.get(key)
  if (existing) return existing

  const work = compactModelMessagesInternal(input).finally(() => {
    if (inFlightCompactions.get(key) === work) inFlightCompactions.delete(key)
  })
  inFlightCompactions.set(key, work)
  return work
}

export function createEmptyCompactionPacket(sourceDigest: string, sourceMessageIds: string[]): LocalCompactionPacket {
  return {
    schema: 'tidecode.compaction_packet/v1',
    packetId: randomUUID(),
    sourceDigest,
    sourceMessageIds,
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
}
