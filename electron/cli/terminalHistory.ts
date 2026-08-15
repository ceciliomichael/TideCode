import type { Message } from '../../src/types/chat'
import { normalizeAssistantMessageContent } from '../../src/lib/chatMessageContent'
import { getChatAttachmentSummary } from '../../src/lib/chatAttachments'
import { collapseChatMentionMarkup } from '../../src/lib/chatMentions'
import { groupVisibleTranscriptMessages } from '../../src/components/chat/assistantTurnGrouping'
import { splitFinishedAssistantRun } from '../../src/components/chat/assistantWorkGrouping'
import { getTerminalToolPresentationItems } from './desktopToolPresentation'
import type { TranscriptEntry } from './terminalView'

export function createTerminalHistoryEntries(
  messages: readonly Message[],
  workspaceRootPath?: string | null,
): TranscriptEntry[] {
  return groupVisibleTranscriptMessages(messages).flatMap((group): TranscriptEntry[] => {
    if (group.kind === 'user') {
      const message = group.message
      const visibleContent = collapseChatMentionMarkup(message.content).trim()
      const attachmentSummary = getChatAttachmentSummary(message.attachments ?? [])
      const text = visibleContent || (attachmentSummary ? `Attached ${attachmentSummary}` : '')
      return text ? [{ id: message.id, kind: 'user', text }] : []
    }

    const entries: TranscriptEntry[] = []
    const presentation = splitFinishedAssistantRun(group.messages)
    const appendAssistantMessage = (message: Message, section: 'work' | 'answer') => {
      const normalized = normalizeAssistantMessageContent(message)
      // A provider can complete a reasoning block before its final text is
      // persisted, and some adapters expose the completion timestamp without
      // retaining visible reasoning text. Keep the durable Thought marker in
      // both cases so CLI history matches the desktop transcript.
      const hasReasoning = normalized.reasoningContent.trim().length > 0 || message.reasoningCompletedAt !== undefined
      if (hasReasoning) {
        const durationSeconds = message.reasoningCompletedAt === undefined
          ? undefined
          : Math.max(0.01, (message.reasoningCompletedAt - message.timestamp) / 1000)

        entries.push({ id: `${message.id}-thought`, kind: 'thought', durationSeconds })
      }

      // AssistantMessage renders reasoning, text, and tools in this order.
      // Keeping that order here is important for resumed conversations where
      // one persisted assistant message can contain both text and tools.
      if (normalized.content.trim()) {
        entries.push({ id: `${message.id}-content`, kind: 'assistant', section, text: normalized.content })
      }

      for (const invocation of message.toolInvocations ?? []) {
        for (const tool of getTerminalToolPresentationItems(invocation, workspaceRootPath)) {
          entries.push({
            detail: tool.status === 'failed' ? 'failed' : undefined,
            id: `${message.id}-tool-${tool.id}`,
            kind: 'tool',
            label: tool.label,
            status: tool.status,
          })
        }
      }
    }

    for (const message of presentation.workingMessages) appendAssistantMessage(message, 'work')
    if (presentation.trailingMessage) appendAssistantMessage(presentation.trailingMessage, 'answer')
    return entries
  })
}
