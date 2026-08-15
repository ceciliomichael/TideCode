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
    let thoughtEntry: Extract<TranscriptEntry, { kind: 'thought' }> | undefined
    const appendAssistantMessage = (message: Message, section: 'work' | 'answer') => {
      const normalized = normalizeAssistantMessageContent(message)
      if (normalized.reasoningContent.trim()) {
        const durationSeconds = message.reasoningCompletedAt === undefined
          ? undefined
          : Math.max(0, (message.reasoningCompletedAt - message.timestamp) / 1000)

        if (!thoughtEntry) {
          thoughtEntry = { id: `${message.id}-thought`, kind: 'thought', durationSeconds }
          entries.push(thoughtEntry)
        } else if (durationSeconds !== undefined) {
          thoughtEntry.durationSeconds = (thoughtEntry.durationSeconds ?? 0) + durationSeconds
        }
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

      if (normalized.content.trim()) {
        entries.push({ id: `${message.id}-content`, kind: 'assistant', section, text: normalized.content })
      }
    }

    for (const message of presentation.workingMessages) appendAssistantMessage(message, 'work')
    if (presentation.trailingMessage) appendAssistantMessage(presentation.trailingMessage, 'answer')
    return entries
  })
}
