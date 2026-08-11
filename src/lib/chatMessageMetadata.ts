import { getChatAttachmentSummary } from './chatAttachments'
import { normalizeAssistantMessageContent } from './chatMessageContent'
import { collapseChatMentionMarkup } from './chatMentions'
import { isPlanRevisionRequestMessage } from './planRevision'
import { isPlanImplementationStatusMessage } from './planImplementation'
import { isPlanStatusMessage } from './planStatusMessages'
import type { Message, UserMessageKind } from '../types/chat'

function getResolvedUserMessageKind(message: Message): UserMessageKind {
  return message.userMessageKind ?? 'human'
}

export function isSyntheticToolResultMessage(message: Message) {
  return message.role === 'tool' || (message.role === 'user' && getResolvedUserMessageKind(message) === 'tool_result')
}

export function isHumanUserMessage(message: Message) {
  const messageKind = getResolvedUserMessageKind(message)
  return (
    message.role === 'user' &&
    (messageKind === 'human' || messageKind === 'steer') &&
    !isPlanStatusMessage(message.content)
  )
}

export function isSameTurnSteerMessage(message: Message) {
  return message.role === 'user' && getResolvedUserMessageKind(message) === 'steer'
}

export function isPlanImplementationMessage(message: Message) {
  return message.role === 'user' && isPlanImplementationStatusMessage(message.content)
}

export function isPlanRevisionMessage(message: Message) {
  return message.role === 'user' && isPlanRevisionRequestMessage(message.content)
}

export function isVisibleTranscriptMessage(message: Message) {
  return message.role === 'assistant' || isHumanUserMessage(message)
}

export function getConversationPreviewContent(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isVisibleTranscriptMessage(message)) {
      continue
    }

    const rawContent =
      message.role === 'assistant' ? normalizeAssistantMessageContent(message).content : message.content
    const previewContent = collapseChatMentionMarkup(rawContent)
    const trimmedContent = previewContent.trim()
    if (trimmedContent.length > 0) {
      return previewContent
    }

    const attachmentSummary = getChatAttachmentSummary(message.attachments ?? [])
    if (attachmentSummary) {
      return `Attached ${attachmentSummary}`
    }

    if (message.role === 'assistant' && (message.toolInvocations?.length ?? 0) > 0) {
      return 'Tool activity'
    }
  }

  return 'No messages yet'
}
