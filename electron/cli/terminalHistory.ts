import type { ChatCompactionMarker, Message } from '../../src/types/chat'
import { normalizeAssistantMessageContent } from '../../src/lib/chatMessageContent'
import { getChatAttachmentSummary } from '../../src/lib/chatAttachments'
import { collapseChatMentionMarkup } from '../../src/lib/chatMentions'
import { isVisibleTranscriptMessage } from '../../src/lib/chatMessageMetadata'
import { groupVisibleTranscriptMessages } from '../../src/components/chat/assistantTurnGrouping'
import { splitFinishedAssistantRun } from '../../src/components/chat/assistantWorkGrouping'
import { placeCompactionMarkersAfterTranscript } from '../../src/components/chat/compactionMarkerPlacement'
import { getTerminalToolPresentationItems } from './desktopToolPresentation'
import type { TranscriptEntry } from './terminalView'

export function createTerminalHistoryEntries(
  messages: readonly Message[],
  workspaceRootPath?: string | null,
  compactionMarkers: readonly ChatCompactionMarker[] = [],
): TranscriptEntry[] {
  const visibleMessages = messages.filter(isVisibleTranscriptMessage)
  const markerPlacement = placeCompactionMarkersAfterTranscript(visibleMessages, compactionMarkers)
  const insertedMarkerTargets = new Set<string>()
  const entries: TranscriptEntry[] = []

  const appendMarkersBeforeMessage = (messageId: string) => {
    if (insertedMarkerTargets.has(messageId)) return
    insertedMarkerTargets.add(messageId)
    for (const marker of markerPlacement.markersBeforeMessageId.get(messageId) ?? []) {
      entries.push({ id: `compaction-${marker.compactionId}`, kind: 'compaction' })
    }
  }

  const appendAssistantMessage = (
    message: Message,
    section: 'work' | 'answer',
    sourceMessageId: string,
  ) => {
    appendMarkersBeforeMessage(sourceMessageId)
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

  for (const group of groupVisibleTranscriptMessages(messages)) {
    if (group.kind === 'user') {
      const message = group.message
      appendMarkersBeforeMessage(message.id)
      const visibleContent = collapseChatMentionMarkup(message.content).trim()
      const attachmentSummary = getChatAttachmentSummary(message.attachments ?? [])
      const text = visibleContent || (attachmentSummary ? `Attached ${attachmentSummary}` : '')
      if (text) entries.push({ id: message.id, kind: 'user', text })
      continue
    }

    const presentation = splitFinishedAssistantRun(group.messages)
    const sourceMessageIds = new Set(group.messages.map((message) => message.id))
    const resolveSourceMessageId = (message: Message) => {
      if (sourceMessageIds.has(message.id)) return message.id
      return message.id.replace(/-(?:work|text)$/u, '')
    }

    for (const message of presentation.workingMessages) {
      appendAssistantMessage(message, 'work', resolveSourceMessageId(message))
    }
    if (presentation.trailingMessage) {
      appendAssistantMessage(presentation.trailingMessage, 'answer', resolveSourceMessageId(presentation.trailingMessage))
    }
  }

  for (const marker of markerPlacement.trailingMarkers) {
    entries.push({ id: `compaction-${marker.compactionId}`, kind: 'compaction' })
  }
  return entries
}
