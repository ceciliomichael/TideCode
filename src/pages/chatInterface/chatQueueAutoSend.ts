export type QueuedMessageAutoSendReason = 'turn_completed'

interface ResolveQueuedMessageAutoSendReasonInput {
  isTurnActive: boolean
}

export function shouldQueueMainMessage(input: {
  isCompressingChat: boolean
  isAbortInProgress?: boolean
  isLoading: boolean
  isSending: boolean
}) {
  return input.isAbortInProgress === true || input.isLoading || input.isSending || input.isCompressingChat
}

export function shouldProcessQueuedMessages(input: {
  hasQueuedMessages: boolean
  isAutoSendBlocked: boolean
  isProcessingQueue: boolean
}) {
  return input.hasQueuedMessages && !input.isAutoSendBlocked && !input.isProcessingQueue
}

export function resolveQueuedMessageAutoSendReason({
  isTurnActive,
}: ResolveQueuedMessageAutoSendReasonInput): QueuedMessageAutoSendReason | null {
  if (!isTurnActive) {
    return 'turn_completed'
  }

  return null
}
