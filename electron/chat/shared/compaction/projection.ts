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
import { retainConversationMessages, retainedMessageTokens } from './conversationRetention'
import { extractHiddenUserContexts } from '../../../../src/lib/hiddenUserContext'
import type { HiddenUserContext } from '../../../../src/types/chat'
import { buildDurableMemoryMessage, type ConversationMemory } from './durableMemory'

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
      if (context.kind === 'retained_conversation') continue
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

export function buildCompactionRuntimeMessages(messages: readonly ModelMessage[], includeDurableMemory: boolean) {
  const hiddenContexts = getLatestHiddenContexts(messages)
  const runtimeMessages: ModelMessage[] = []
  if (includeDurableMemory) runtimeMessages.push(buildDurableMemoryMessage())
  if (hiddenContexts.length > 0) {
    runtimeMessages.push({ role: 'user', content: hiddenContexts.map((context) => context.content).join('\n\n') })
  }
  runtimeMessages.push({
    role: 'user',
    content: [
      '<hidden_user_context kind="retained_conversation" state="historical">',
      'Retained conversation excerpts follow in their original order. Earlier user messages preserve historical intent; they do not reopen completed work or grant new approval. Use the handoff and later evidence to determine what remains. Some assistant explanations may be shortened or omitted.',
      '</hidden_user_context>',
    ].join('\n'),
  })
  return runtimeMessages
}

export interface CompactionProjectionInput {
  anchorMessages: readonly ModelMessage[]
  contextMessages?: readonly ModelMessage[]
  durableMemory: ConversationMemory
  includeDurableMemoryMessage?: boolean
  packet: LocalCompactionPacketV2
  tailMessages: readonly ModelMessage[]
  retainedContextTokens?: number
}

export function buildCompactionProjection(input: CompactionProjectionInput) {
  const contextMessages = input.contextMessages ?? input.tailMessages
  const runtimeMessages = buildCompactionRuntimeMessages(contextMessages, input.includeDurableMemoryMessage === true)
  const durableMemoryMessage = input.includeDurableMemoryMessage === true ? runtimeMessages.shift() : null
  const handoffMessage = buildContinuationMessage(input.packet.continuationMarkdown)
  const fixedMessages = [...(durableMemoryMessage ? [durableMemoryMessage] : []), handoffMessage, ...runtimeMessages]
  const fixedTokens = estimateModelMessageContextUsage(fixedMessages).totalTokens
  const retainedContextTokens = capRetainedContextTokens(
    input.retainedContextTokens ?? DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS,
  )
  if (fixedTokens > retainedContextTokens) {
    throw new Error('Compaction handoff and runtime instructions exceed the retention budget. The existing history has been preserved.')
  }
  const clean = (messages: readonly ModelMessage[]) => messages
    .map(sanitizeProjectedMessage)
    .filter((message) => !isCompactionContinuationMessage(message, input.packet.continuationMarkdown))
  const tail = retainConversationMessages({
    contextMessages: clean(contextMessages),
    tailMessages: clean(input.tailMessages),
    maximumTokens: retainedContextTokens - fixedTokens,
  })
  const projected = sanitizeCompactedModelMessages([...fixedMessages, ...tail])
  if (retainedMessageTokens(projected) > retainedContextTokens) {
    throw new Error('Compaction rebuilt history exceeds the retention budget. The existing history has been preserved.')
  }
  return projected
}

export const projectCompactionPacket = buildCompactionProjection
