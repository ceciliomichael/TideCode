import { randomUUID } from 'node:crypto'
import type { ModelMessage } from 'ai'
import { stableStringify, sha256 } from '../../cache/canonicalization'
import { estimateModelMessagesTokens } from './budget'
import type {
  CompactionPacket,
  CompactionWindow,
} from './contracts'
import { buildContinuationMessage, isCompactionContinuationMessage } from './markdown'

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
  if (boundaryIndex === messages.length && messages.at(-1)?.role !== 'tool') return false

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
  previousPacket?: CompactionPacket | null
}

export function selectCompactionWindow(
  messages: readonly ModelMessage[],
  targetHistoryTokens: number,
  options?: CompactionWindowSelectionOptions,
): CompactionWindow | null {
  if (messages.length < 3 || hasUnresolvedToolCall(messages)) return null

  const continuationIndex = options?.previousPacket
    ? findLatestContinuationIndex(messages, options.previousPacket)
    : -1
  const sourceStartIndex = continuationIndex >= 0 ? continuationIndex + 1 : 0
  let largestSafeWindow: CompactionWindow | null = null

  for (let boundaryIndex = Math.max(1, sourceStartIndex + 1); boundaryIndex <= messages.length; boundaryIndex += 1) {
    if (!isSafeCompactionBoundary(messages, boundaryIndex)) continue
    const evictedMessages = messages.slice(sourceStartIndex, boundaryIndex)
    if (evictedMessages.length === 0) continue
    const tailMessages = messages.slice(boundaryIndex)
    const window: CompactionWindow = {
      anchorMessages: getAnchorMessages(messages, boundaryIndex),
      boundaryIndex,
      evictedMessages,
      sourceStartIndex,
      sourceEndIndex: boundaryIndex,
      sourceMessageIds: buildSourceMessageIds(sourceStartIndex, boundaryIndex),
      tailMessages,
    }

    largestSafeWindow = window
    if (estimateModelMessagesTokens(tailMessages) <= targetHistoryTokens) {
      return window
    }
  }

  return largestSafeWindow
}

export function buildCompactionMessage(packet: CompactionPacket): ModelMessage {
  return buildContinuationMessage(packet.continuationMarkdown)
}

export function createPacketId() {
  return randomUUID()
}

export { buildContinuationMessage, isCompactionContinuationMessage }
