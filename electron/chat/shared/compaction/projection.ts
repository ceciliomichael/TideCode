import type { ModelMessage } from 'ai'
import { estimateModelMessagesTokens } from './budget'
import type { LocalCompactionPacketV2 } from './contracts'
import { buildContinuationMessage, isCompactionContinuationMessage } from './markdown'
import { sanitizeModelMessages } from '../modelMessageIntegrity'
import { sanitizeCompactionContent } from './sanitize'

function sanitizeProjectedMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    content: sanitizeCompactionContent(message.content) as ModelMessage['content'],
  } as ModelMessage
}

function hasToolCall(message: ModelMessage) {
  return message.role === 'assistant' && Array.isArray(message.content) && message.content.some((part) => (
    typeof part === 'object' && part !== null && part.type === 'tool-call'
  ))
}

function buildTailGroups(messages: readonly ModelMessage[]) {
  const groups: ModelMessage[][] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const nextMessage = messages[index + 1]
    if (hasToolCall(message) && nextMessage?.role === 'tool') {
      groups.push([message, nextMessage])
      index += 1
      continue
    }
    groups.push([message])
  }
  return groups
}

export function selectSemanticTailMessages(
  messages: readonly ModelMessage[],
  targetHistoryTokens: number,
) {
  if (messages.length === 0) return []
  if (estimateModelMessagesTokens(messages) <= targetHistoryTokens) return [...messages]

  const selectedGroups: ModelMessage[][] = []
  let selectedTokens = 0
  const groups = buildTailGroups(messages)
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    const groupTokens = estimateModelMessagesTokens(group)
    if (selectedGroups.length > 0 && selectedTokens + groupTokens > targetHistoryTokens) continue
    if (selectedGroups.length === 0 && groupTokens > targetHistoryTokens) {
      selectedGroups.unshift(group)
      break
    }
    selectedGroups.unshift(group)
    selectedTokens += groupTokens
  }

  const selected = selectedGroups.flat()
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  if (latestUser && !selected.includes(latestUser)) {
    let withLatestUser = [latestUser, ...selected]
    // If including the user message pushes us over budget, evict older groups (which are at the start of `selectedGroups` because we unshifted them).
    // `selectedGroups` is ordered oldest to newest, but wait:
    // the loop does: for (let index = groups.length - 1; index >= 0; index -= 1) { selectedGroups.unshift(group) }
    // So `selectedGroups` is actually ordered oldest to newest.
    // To evict the oldest, we remove from the start of `selectedGroups`.
    while (estimateModelMessagesTokens(withLatestUser) > targetHistoryTokens && selectedGroups.length > 0) {
      selectedGroups.shift()
      withLatestUser = [latestUser, ...selectedGroups.flat()]
    }
    return withLatestUser
  }

  return selected
}

export interface CompactionProjectionInput {
  anchorMessages: readonly ModelMessage[]
  packet: LocalCompactionPacketV2
  tailMessages: readonly ModelMessage[]
  tailBudgetTokens?: number
}

export function buildCompactionProjection(input: CompactionProjectionInput) {
  const tail = selectSemanticTailMessages(
    input.tailMessages
      .map(sanitizeProjectedMessage)
      .filter((message) => !isCompactionContinuationMessage(message, input.packet.continuationMarkdown)),
    input.tailBudgetTokens ?? Number.MAX_SAFE_INTEGER,
  )
  return sanitizeModelMessages([
    // The AI-generated summary is the new beginning of provider history. The
    // original messages remain in durable display history and are not replayed
    // before this carried-forward summary.
    buildContinuationMessage(input.packet.continuationMarkdown),
    ...tail,
  ])
}

export const projectCompactionPacket = buildCompactionProjection
