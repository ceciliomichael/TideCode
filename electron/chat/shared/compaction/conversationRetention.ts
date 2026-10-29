import type { ModelMessage } from 'ai'
import { estimateModelMessageContextUsage } from '../../../../src/lib/contextUsage'
import { extractHiddenUserContexts, stripHiddenUserContext } from '../../../../src/lib/hiddenUserContext'
import { truncatePreservingEdges } from './codeModeProjection'
import { CompactionError } from './gate'
import { removeRawToolHistory } from './toolFreeContext'

const MAX_EARLIER_USER_TOKENS = 2_500

export function retainedMessageTokens(messages: readonly ModelMessage[]) {
  return estimateModelMessageContextUsage(messages).totalTokens
}

/** Separate visible intent from replaceable runtime injections without changing attachments. */
function visibleUserMessage(message: ModelMessage): ModelMessage | null {
  if (message.role !== 'user') return null
  function visibleText(text: string) {
    const visible = extractHiddenUserContexts(text).length === 0 ? text : stripHiddenUserContext(text)
    // Provider migration stores tool-only exchanges in user-role envelopes.
    if (visible.trimStart().startsWith('Previous tool exchange from another provider:') ||
      visible.trimStart().startsWith('Previous tool result:')) {
      return ''
    }
    return visible
  }
  if (typeof message.content === 'string') {
    const content = visibleText(message.content)
    if (!content.trim()) return null
    return { ...message, content }
  }
  const content = message.content.flatMap<(typeof message.content)[number]>((part) => {
    if (part.type !== 'text') return [part]
    const text = visibleText(part.text)
    if (text === part.text) return [part]
    return text.trim() ? [{ ...part, text }] : []
  })
  if (!content.some((part) => part.type !== 'text' || part.text.trim())) return null
  return { ...message, content }
}

export function resolveLatestConversationUser(messages: readonly ModelMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = visibleUserMessage(messages[index])
    if (message) return { index, message }
  }
  return null
}

function fitAssistantMessage(message: ModelMessage, maximumTokens: number) {
  if (retainedMessageTokens([message]) <= maximumTokens) return message
  let low = 0
  let high = maximumTokens * 4
  let best: ModelMessage | null = null
  while (low <= high) {
    const characters = Math.floor((low + high) / 2)
    const content = typeof message.content === 'string'
      ? truncatePreservingEdges(message.content, characters)
      : message.content.map((part) => {
          if (part.type === 'text') {
            return { ...part, text: truncatePreservingEdges(part.text, characters) }
          }
          return part
        })
    const candidate = { ...message, content } as ModelMessage
    if (retainedMessageTokens([candidate]) <= maximumTokens) {
      best = candidate
      low = characters + 1
    } else {
      high = characters - 1
    }
  }
  return best
}

/** User messages are atomic; assistant prose uses only the remaining space. */
export function retainConversationMessages(input: {
  contextMessages: readonly ModelMessage[]
  tailMessages: readonly ModelMessage[]
  maximumTokens: number
}) {
  const source = input.contextMessages.length > 0 ? input.contextMessages : input.tailMessages
  const latestUser = resolveLatestConversationUser(source)
  const selected = new Map<number, ModelMessage>()
  let remaining = Math.max(0, input.maximumTokens)
  if (latestUser) {
    const tokens = retainedMessageTokens([latestUser.message])
    if (tokens > remaining) {
      throw new CompactionError('protected_context_too_large')
    }
    selected.set(latestUser.index, latestUser.message)
    remaining -= tokens
  }

  // A bounded suffix of earlier requests protects corrections without building
  // an ever-growing prompt ledger or crowding out the handoff and recent result.
  let earlierBudget = Math.min(MAX_EARLIER_USER_TOKENS, Math.floor(remaining * 0.35))
  for (let index = (latestUser?.index ?? 0) - 1; index >= 0; index -= 1) {
    const message = visibleUserMessage(source[index])
    if (!message) continue
    const tokens = retainedMessageTokens([message])
    if (tokens > earlierBudget) break
    selected.set(index, message)
    earlierBudget -= tokens
    remaining -= tokens
  }

  // Only replay assistant output from the retained tail, never an old handoff.
  // Use the original source so user/assistant ordering survives selection.
  const firstTailUser = input.tailMessages.find((message) => visibleUserMessage(message))
  let tailStart = latestUser?.index ?? 0
  if (firstTailUser) {
    const index = source.findLastIndex((message) => message === firstTailUser || (
      message.role === 'user' && JSON.stringify(message.content) === JSON.stringify(firstTailUser.content)
    ))
    if (index >= 0) tailStart = index
  }
  const assistantSource = input.contextMessages.length > 0 && latestUser && source.some((message, index) => (
    index >= tailStart && message.role === 'assistant'
  )) ? source : input.tailMessages
  for (let index = assistantSource.length - 1; index >= 0 && remaining > 0; index -= 1) {
    if (assistantSource === source && index < tailStart) break
    const original = assistantSource[index]
    if (original.role !== 'assistant') continue
    const message = removeRawToolHistory([original])[0]
    if (!message) continue
    const fitted = fitAssistantMessage(message, remaining)
    if (!fitted) break
    const order = assistantSource === source ? index : source.length + index
    selected.set(order, fitted)
    remaining -= retainedMessageTokens([fitted])
    if (fitted !== message) break
  }
  return [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, message]) => message)
}
