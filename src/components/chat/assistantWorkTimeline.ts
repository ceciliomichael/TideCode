import type { ChatCompactionLifecycleState, ChatCompactionMarker, Message } from '../../types/chat'

export type AssistantWorkCompactionBoundary =
  | {
      afterMessageCount: number
      marker: ChatCompactionMarker
      type: 'compaction_marker'
    }
  | {
      afterMessageCount: number
      status: ChatCompactionLifecycleState
      type: 'live_compaction'
    }

export type AssistantWorkTimelineEntry =
  | {
      index: number
      message: Message
      type: 'message'
    }
  | {
      marker: ChatCompactionMarker
      type: 'compaction_marker'
    }
  | {
      status: ChatCompactionLifecycleState
      type: 'live_compaction'
    }

export interface AssistantWorkTimeline {
  entries: AssistantWorkTimelineEntry[]
  overflowBoundaries: AssistantWorkCompactionBoundary[]
}

export function buildAssistantWorkTimeline(
  messages: readonly Message[],
  startIndex: number,
  boundaries: readonly AssistantWorkCompactionBoundary[],
): AssistantWorkTimeline {
  const boundariesByMessageCount = new Map<number, AssistantWorkCompactionBoundary[]>()
  const overflowBoundaries: AssistantWorkCompactionBoundary[] = []

  for (const boundary of boundaries) {
    if (boundary.afterMessageCount < 0 || boundary.afterMessageCount > messages.length) {
      overflowBoundaries.push(boundary)
      continue
    }

    const bucket = boundariesByMessageCount.get(boundary.afterMessageCount) ?? []
    bucket.push(boundary)
    boundariesByMessageCount.set(boundary.afterMessageCount, bucket)
  }

  const entries: AssistantWorkTimelineEntry[] = []
  for (let messageCount = 0; messageCount <= messages.length; messageCount += 1) {
    for (const boundary of boundariesByMessageCount.get(messageCount) ?? []) {
      if (boundary.type === 'compaction_marker') {
        entries.push({ marker: boundary.marker, type: 'compaction_marker' })
      } else {
        entries.push({ status: boundary.status, type: 'live_compaction' })
      }
    }

    if (messageCount < messages.length) {
      entries.push({
        index: startIndex + messageCount,
        message: messages[messageCount],
        type: 'message',
      })
    }
  }

  return { entries, overflowBoundaries }
}
