import type { ModelMessage } from 'ai'
import { estimateModelMessageContextUsage } from '../../../../src/lib/contextUsage'
import type { LocalCompactionPacketV2 } from './contracts'
import { buildContinuationMessage, isCompactionContinuationMessage } from './markdown'
import {
  sanitizeCompactedModelContent,
  sanitizeCompactedModelMessages,
} from '../modelMessageIntegrity'
import {
  capRetainedContextTokens,
  DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS,
} from '../../../../src/lib/contextCompactionSettings'
import { selectLatestContextByTokens } from './retention'
import { removeRawToolHistory } from './toolFreeContext'
import { extractHiddenUserContexts } from '../../../../src/lib/hiddenUserContext'
import type { HiddenUserContext } from '../../../../src/types/chat'

function getMessageText(message: ModelMessage) {
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((part): part is typeof part & { text: string; type: 'text' } => (
      typeof part === 'object' && part !== null && part.type === 'text' && typeof part.text === 'string'
    ))
    .map((part) => part.text)
    .join('\n')
}

function getLatestHiddenContexts(messages: readonly ModelMessage[]) {
  const latestByKind = new Map<string, { context: HiddenUserContext; order: number }>()
  let order = 0
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const context of extractHiddenUserContexts(getMessageText(message))) {
      latestByKind.set(context.kind, { context, order })
      order += 1
    }
  }
  return [...latestByKind.values()]
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.context)
}

function sanitizeProjectedMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    content: sanitizeCompactedModelContent(message.content),
  } as ModelMessage
}

export interface CompactionProjectionInput {
  anchorMessages: readonly ModelMessage[]
  contextMessages?: readonly ModelMessage[]
  packet: LocalCompactionPacketV2
  tailMessages: readonly ModelMessage[]
  retainedContextTokens?: number
}

export function buildCompactionProjection(input: CompactionProjectionInput) {
  const handoffMessage = buildContinuationMessage(input.packet.continuationMarkdown)
  const handoffTokens = estimateModelMessageContextUsage([handoffMessage]).totalTokens
  const retainedContextTokens = capRetainedContextTokens(
    input.retainedContextTokens ?? DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS,
  )
  const tailBudget = Math.max(1, retainedContextTokens - handoffTokens)
  const toolFreeTailMessages = removeRawToolHistory(input.tailMessages)
  const selectedTail = selectLatestContextByTokens(
    toolFreeTailMessages,
    tailBudget,
  ).messages
  const tail = selectedTail
    .map(sanitizeProjectedMessage)
    .filter((message) => !isCompactionContinuationMessage(message, input.packet.continuationMarkdown))
  const tailText = tail.map(getMessageText).join('\n')
  const carriedHiddenContexts = getLatestHiddenContexts(input.contextMessages ?? [])
    .filter((context) => !tailText.includes(context.content))
  const hiddenContextMessage: ModelMessage | null = carriedHiddenContexts.length > 0
    ? {
        content: carriedHiddenContexts.map((context) => context.content).join('\n\n'),
        role: 'user',
      }
    : null
  return sanitizeCompactedModelMessages([
    // The AI-generated summary is the new beginning of provider history. The
    // original messages remain in durable display history and are not replayed
    // before this carried-forward summary.
    handoffMessage,
    ...(hiddenContextMessage ? [hiddenContextMessage] : []),
    ...tail,
  ])
}

export const projectCompactionPacket = buildCompactionProjection
