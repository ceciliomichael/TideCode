import type { FollowUpBehavior } from '../../lib/appSettings'

export type QueuedMessageAutoSendReason = 'successful_tool' | 'turn_completed'

interface DetectSuccessfulToolReleaseSignalInput {
  currentSignal: string | null
  hasQueuedMessages: boolean
  observedSignal: string | null
}

interface ResolveQueuedMessageAutoSendReasonInput {
  followUpBehavior: FollowUpBehavior
  hasRunningToolInvocations: boolean
  hasSuccessfulToolRelease: boolean
  isTurnActive: boolean
}

export function shouldQueueMainMessage(input: {
  isCompressingChat: boolean
  isLoading: boolean
  isSending: boolean
}) {
  return input.isLoading || input.isSending || input.isCompressingChat
}

export function detectSuccessfulToolReleaseSignal({
  currentSignal,
  hasQueuedMessages,
  observedSignal,
}: DetectSuccessfulToolReleaseSignalInput) {
  if (
    !hasQueuedMessages ||
    currentSignal === null ||
    currentSignal === observedSignal
  ) {
    return null
  }

  return currentSignal
}

export function resolveQueuedMessageAutoSendReason({
  followUpBehavior,
  hasRunningToolInvocations,
  hasSuccessfulToolRelease,
  isTurnActive,
}: ResolveQueuedMessageAutoSendReasonInput): QueuedMessageAutoSendReason | null {
  if (!isTurnActive) {
    return 'turn_completed'
  }

  if (
    followUpBehavior === 'steer' &&
    hasSuccessfulToolRelease &&
    !hasRunningToolInvocations
  ) {
    return 'successful_tool'
  }

  return null
}
