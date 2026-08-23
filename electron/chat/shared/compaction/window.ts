import { randomUUID } from 'node:crypto'
import type { ModelMessage } from 'ai'
import { stableStringify, sha256 } from '../../cache/canonicalization'
import type {
  CompactionPacket,
  CompactionWindow,
} from './contracts'
import { buildContinuationMessage, isCompactionContinuationMessage } from './markdown'
import {
  capRetainedContextTokens,
  DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS,
} from '../../../../src/lib/contextCompactionSettings'
import {
  estimateRetainedContextTokens,
  projectRetainedMessagesForContext,
  selectLatestContextByTokens,
} from './retention'

const MAX_SOURCE_MESSAGE_IDS = 64

function getParts(message: ModelMessage) {
  return Array.isArray(message.content) ? message.content : []
}

function getToolCallIds(message: ModelMessage) {
  if (message.role !== 'assistant') return []
  return getParts(message)
    .filter((part): part is typeof part & { type: 'tool-call'; toolCallId: string } => (
      typeof part === 'object' && part !== null && part.type === 'tool-call' && typeof part.toolCallId === 'string'
    ))
    .map((part) => part.toolCallId)
}

function getToolResultIds(message: ModelMessage) {
  if (message.role !== 'tool') return []
  return getParts(message)
    .filter((part): part is typeof part & { type: 'tool-result'; toolCallId: string } => (
      typeof part === 'object' && part !== null && part.type === 'tool-result' && typeof part.toolCallId === 'string'
    ))
    .map((part) => part.toolCallId)
}

export function isSafeCompactionBoundary(messages: readonly ModelMessage[], boundaryIndex: number) {
  if (boundaryIndex <= 0 || boundaryIndex > messages.length) return false

  const calls = new Set<string>()
  const results = new Set<string>()
  for (const message of messages.slice(0, boundaryIndex)) {
    getToolCallIds(message).forEach((id) => calls.add(id))
    getToolResultIds(message).forEach((id) => results.add(id))
  }

  return [...calls].every((id) => results.has(id)) && [...results].every((id) => calls.has(id))
}

export function hasUnresolvedToolCall(messages: readonly ModelMessage[]) {
  const calls = new Set<string>()
  const results = new Set<string>()
  messages.forEach((message) => {
    getToolCallIds(message).forEach((id) => calls.add(id))
    getToolResultIds(message).forEach((id) => results.add(id))
  })
  return [...calls].some((id) => !results.has(id)) || [...results].some((id) => !calls.has(id))
}

function getAnchorMessages(messages: readonly ModelMessage[], boundaryIndex: number) {
  const userIndexes = messages.reduce<number[]>((indexes, message, index) => {
    if (index < boundaryIndex && message.role === 'user') indexes.push(index)
    return indexes
  }, [])

  const anchorIndexes = new Set<number>()
  const firstUserIndex = userIndexes[0]
  if (firstUserIndex !== undefined) anchorIndexes.add(firstUserIndex)

  return [...anchorIndexes]
    .sort((left, right) => left - right)
    .map((index) => messages[index])
    .filter((message): message is ModelMessage => Boolean(message) && !isCompactionContinuationMessage(message))
}

export function buildCompactionSourceDigest(
  messages: readonly ModelMessage[],
  boundaryIndex: number,
  sourceStartIndex = 0,
) {
  return sha256(stableStringify(messages.slice(sourceStartIndex, boundaryIndex)))
}

function buildSourceMessageIds(sourceStartIndex: number, boundaryIndex: number) {
  const sourceCount = Math.max(0, boundaryIndex - sourceStartIndex)
  if (sourceCount <= MAX_SOURCE_MESSAGE_IDS) {
    return Array.from({ length: sourceCount }, (_value, index) => `model:${sourceStartIndex + index}`)
  }

  const sampled = new Set<number>([sourceStartIndex, boundaryIndex - 1])
  const interval = (boundaryIndex - sourceStartIndex - 1) / (MAX_SOURCE_MESSAGE_IDS - 1)
  for (let index = 1; index < MAX_SOURCE_MESSAGE_IDS - 1; index += 1) {
    sampled.add(Math.round(sourceStartIndex + index * interval))
  }
  return [...sampled].sort((left, right) => left - right).map((index) => `model:${index}`)
}

function findLatestContinuationIndex(messages: readonly ModelMessage[], previousPacket?: CompactionPacket | null) {
  const expectedMarkdown = previousPacket?.continuationMarkdown
  return messages.findLastIndex((message) => isCompactionContinuationMessage(message, expectedMarkdown))
}

export interface CompactionWindowSelectionOptions {
  force?: boolean
  previousPacket?: CompactionPacket | null
  retainedContextTokens?: number
}

function resolveCompactionSourceStartIndex(
  messages: readonly ModelMessage[],
  previousPacket?: CompactionPacket | null,
) {
  const continuationIndex = previousPacket
    ? findLatestContinuationIndex(messages, previousPacket)
    : -1
  return continuationIndex >= 0 ? continuationIndex + 1 : 0
}

/**
 * Reports whether a threshold crossing has older complete turns that can be
 * replaced by the AI summary while retaining the configured recent token tail.
 * This keeps the threshold decision separate from the token target used to
 * size a normal context estimate.
 */
export function hasCompactionEligibleHistory(
  messages: readonly ModelMessage[],
  options?: CompactionWindowSelectionOptions,
) {
  const sourceStartIndex = resolveCompactionSourceStartIndex(messages, options?.previousPacket)
  const retainedContextTokens = capRetainedContextTokens(
    options?.retainedContextTokens ?? DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS,
  )
  const sourceMessages = messages.slice(sourceStartIndex)
  const selection = selectLatestContextByTokens(
    sourceMessages,
    retainedContextTokens,
    { allowPartialNewestTurn: true },
  )
  const boundaryIndex = sourceStartIndex + selection.startIndex
  const sourceTokens = estimateRetainedContextTokens(sourceMessages)

  // A partial newest-turn projection drops intermediate evidence from the raw
  // turn. Summarize the complete current source so that evidence is captured in
  // the handoff instead of silently disappearing from provider context.
  if (selection.partialNewestTurn) {
    return selection.tokenCount < sourceTokens && isSafeCompactionBoundary(messages, messages.length)
  }

  if (boundaryIndex > sourceStartIndex && isSafeCompactionBoundary(messages, boundaryIndex)) {
    return true
  }

  // Projection alone can also make a one-turn source smaller, for example when
  // a huge tool argument or Code Mode receipt is bounded. Treat that as a valid
  // whole-source compaction opportunity when there is no older turn boundary.
  if (selection.startIndex !== 0 || sourceMessages.length === 0 || hasUnresolvedToolCall(sourceMessages)) {
    return false
  }
  return selection.tokenCount < sourceTokens && isSafeCompactionBoundary(messages, messages.length)
}

export function selectCompactionWindow(
  messages: readonly ModelMessage[],
  targetHistoryTokens: number,
  options?: CompactionWindowSelectionOptions,
): CompactionWindow | null {
  if (messages.length === 0 || hasUnresolvedToolCall(messages)) return null

  const sourceStartIndex = resolveCompactionSourceStartIndex(messages, options?.previousPacket)
  const sourceMessages = messages.slice(sourceStartIndex)
  if (sourceMessages.length === 0) return null

  const retainedContextTokens = capRetainedContextTokens(options?.retainedContextTokens ?? targetHistoryTokens)
  const selection = selectLatestContextByTokens(
    sourceMessages,
    retainedContextTokens,
    { allowPartialNewestTurn: true, force: options?.force },
  )

  // The retained history is selected by token budget, but the normal boundary
  // remains a complete user turn. If the newest turn itself was projected, the
  // complete current source must be summarized so projected-away evidence is
  // represented in the handoff.
  const selectedBoundaryIndex = sourceStartIndex + selection.startIndex
  const sourceTokens = estimateRetainedContextTokens(sourceMessages)
  let boundaryIndex = selection.partialNewestTurn ? messages.length : selectedBoundaryIndex
  let retainSelectedProjection = selection.partialNewestTurn === true

  if (!selection.partialNewestTurn) {
    while (boundaryIndex > sourceStartIndex && !isSafeCompactionBoundary(messages, boundaryIndex)) {
      boundaryIndex -= 1
    }
    retainSelectedProjection = boundaryIndex === selectedBoundaryIndex
  }

  if (boundaryIndex === sourceStartIndex) {
    const canCompactProjectedCurrentSource =
      selection.startIndex === 0 &&
      selection.tokenCount < sourceTokens &&
      isSafeCompactionBoundary(messages, messages.length)

    if (!canCompactProjectedCurrentSource) return null

    // There is no older turn to cut away, so summarize the complete current
    // source and retain the bounded projection produced by the selector. The
    // boundary is the current model-step boundary after completed tool results.
    boundaryIndex = messages.length
    retainSelectedProjection = true
  }

  if (!isSafeCompactionBoundary(messages, boundaryIndex)) return null

  const evictedMessages = messages.slice(sourceStartIndex, boundaryIndex)
  if (evictedMessages.length === 0) return null

  return {
    anchorMessages: getAnchorMessages(messages, boundaryIndex),
    boundaryIndex,
    evictedMessages,
    sourceStartIndex,
    sourceEndIndex: boundaryIndex,
    sourceMessageIds: buildSourceMessageIds(sourceStartIndex, boundaryIndex),
    // A partial retained turn is already projected and truncated by the token
    // selector. Keep that projection instead of rebuilding the raw suffix,
    // otherwise a large assistant/tool payload would immediately restore the
    // history that the selector intentionally removed.
    tailMessages: retainSelectedProjection
      ? selection.messages
      : projectRetainedMessagesForContext(messages.slice(boundaryIndex)),
  }
}

export function buildCompactionMessage(packet: CompactionPacket): ModelMessage {
  return buildContinuationMessage(packet.continuationMarkdown)
}

export function createPacketId() {
  return randomUUID()
}

export { buildContinuationMessage, isCompactionContinuationMessage }
