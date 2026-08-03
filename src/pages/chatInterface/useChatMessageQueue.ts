import { useCallback, useEffect, useRef, useState } from 'react'
import type { FollowUpBehavior } from '../../lib/appSettings'
import type { ChatAttachment, QueuedMessage } from '../../types/chat'
import {
  createQueuedComposerMessage,
  dequeueQueuedComposerMessage,
  removeQueuedComposerMessage,
  requeueQueuedComposerMessage,
  reorderQueuedComposerMessages,
  updateQueuedComposerMessage,
} from './chatComposerQueue'
import {
  detectSuccessfulToolReleaseSignal,
  resolveQueuedMessageAutoSendReason,
  type QueuedMessageAutoSendReason,
} from './chatQueueAutoSend'

interface UseChatMessageQueueInput {
  followUpBehavior: FollowUpBehavior
  hasRunningToolInvocations: boolean
  isAutoSendBlocked: boolean
  isTurnActive: boolean
  onSendMessage: (
    message: QueuedMessage,
    reason: QueuedMessageAutoSendReason,
  ) => Promise<QueuedMessageSendResult> | QueuedMessageSendResult
  successfulToolCompletionSignal: string | null
}

export interface QueuedMessageSendResult {
  accepted: boolean
  retryable: boolean
}

export function useChatMessageQueue({
  followUpBehavior,
  hasRunningToolInvocations,
  isAutoSendBlocked,
  isTurnActive,
  onSendMessage,
  successfulToolCompletionSignal,
}: UseChatMessageQueueInput) {
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const [successfulToolReleaseSignal, setSuccessfulToolReleaseSignal] = useState<string | null>(null)
  const isProcessingQueueRef = useRef(false)
  const queuedMessageSendInFlightIdsRef = useRef<Set<string>>(new Set())
  const queueLifecycleVersionRef = useRef(0)
  const attemptedAutoSendKeyRef = useRef<string | null>(null)
  const observedAutoSendBlockedRef = useRef(isAutoSendBlocked)
  const observedSuccessfulToolSignalRef = useRef(successfulToolCompletionSignal)

  useEffect(() => {
    if (observedAutoSendBlockedRef.current !== isAutoSendBlocked) {
      attemptedAutoSendKeyRef.current = null
    }
    observedAutoSendBlockedRef.current = isAutoSendBlocked
  }, [isAutoSendBlocked])

  useEffect(() => {
    const previousSignal = observedSuccessfulToolSignalRef.current
    observedSuccessfulToolSignalRef.current = successfulToolCompletionSignal
    const nextReleaseSignal = detectSuccessfulToolReleaseSignal({
      currentSignal: successfulToolCompletionSignal,
      hasQueuedMessages: queuedMessages.length > 0,
      observedSignal: previousSignal,
    })
    if (nextReleaseSignal === null) {
      return
    }

    attemptedAutoSendKeyRef.current = null
    setSuccessfulToolReleaseSignal(nextReleaseSignal)
  }, [queuedMessages.length, successfulToolCompletionSignal])

  useEffect(() => {
    if (queuedMessages.length > 0) {
      return
    }

    attemptedAutoSendKeyRef.current = null
    observedSuccessfulToolSignalRef.current = successfulToolCompletionSignal
    setSuccessfulToolReleaseSignal(null)
  }, [queuedMessages.length, successfulToolCompletionSignal])

  const enqueueMessage = useCallback((content: string, attachments?: ChatAttachment[]) => {
    const nextMessage = createQueuedComposerMessage({ attachments, content })
    attemptedAutoSendKeyRef.current = null
    setQueuedMessages((currentValue) => [...currentValue, nextMessage])
  }, [])

  const removeQueuedMessage = useCallback((id: string) => {
    queueLifecycleVersionRef.current += 1
    attemptedAutoSendKeyRef.current = null
    setQueuedMessages((currentValue) => removeQueuedComposerMessage(currentValue, id))
  }, [])

  const updateQueuedMessage = useCallback((id: string, content: string, attachments?: ChatAttachment[]) => {
    queueLifecycleVersionRef.current += 1
    attemptedAutoSendKeyRef.current = null
    setQueuedMessages((currentValue) => updateQueuedComposerMessage(currentValue, id, content, attachments))
  }, [])

  const clearQueuedMessages = useCallback(() => {
    queueLifecycleVersionRef.current += 1
    attemptedAutoSendKeyRef.current = null
    setSuccessfulToolReleaseSignal(null)
    setQueuedMessages([])
  }, [])

  const sendQueuedMessage = useCallback(
    async (
      targetMessage: QueuedMessage,
      restoreIndex: number,
      reason: QueuedMessageAutoSendReason,
    ) => {
      if (queuedMessageSendInFlightIdsRef.current.has(targetMessage.id)) {
        return true
      }

      queuedMessageSendInFlightIdsRef.current.add(targetMessage.id)
      const queueLifecycleVersion = queueLifecycleVersionRef.current
      setQueuedMessages((currentValue) => removeQueuedComposerMessage(currentValue, targetMessage.id))

      try {
        const sendResult = await onSendMessage(targetMessage, reason)
        if (!sendResult.accepted) {
          if (sendResult.retryable) {
            attemptedAutoSendKeyRef.current = null
          }

          if (queueLifecycleVersionRef.current === queueLifecycleVersion) {
            setQueuedMessages((currentValue) =>
              requeueQueuedComposerMessage(currentValue, targetMessage, restoreIndex),
            )
          }
        } else {
          attemptedAutoSendKeyRef.current = null
          setSuccessfulToolReleaseSignal(null)
        }

        return sendResult.accepted
      } catch (caughtError) {
        console.error(caughtError)
        if (queueLifecycleVersionRef.current === queueLifecycleVersion) {
          setQueuedMessages((currentValue) =>
            requeueQueuedComposerMessage(currentValue, targetMessage, restoreIndex),
          )
        }
        return false
      } finally {
        queuedMessageSendInFlightIdsRef.current.delete(targetMessage.id)
      }
    },
    [onSendMessage],
  )

  const reorderQueuedMessages = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) {
      return
    }

    queueLifecycleVersionRef.current += 1
    attemptedAutoSendKeyRef.current = null
    setQueuedMessages((currentValue) => reorderQueuedComposerMessages(currentValue, sourceId, targetId))
  }, [])

  useEffect(() => {
    if (isAutoSendBlocked || queuedMessages.length === 0 || isProcessingQueueRef.current) {
      return undefined
    }

    const { nextMessage } = dequeueQueuedComposerMessage(queuedMessages)
    if (!nextMessage) {
      return undefined
    }

    const autoSendReason = resolveQueuedMessageAutoSendReason({
      followUpBehavior,
      hasRunningToolInvocations,
      hasSuccessfulToolRelease: successfulToolReleaseSignal !== null,
      isTurnActive,
    })
    if (!autoSendReason) {
      return undefined
    }

    const releaseSignal =
      autoSendReason === 'successful_tool'
        ? successfulToolReleaseSignal
        : 'turn_completed'
    const autoSendKey = `${nextMessage.id}:${autoSendReason}:${releaseSignal}`
    if (attemptedAutoSendKeyRef.current === autoSendKey) {
      return undefined
    }

    attemptedAutoSendKeyRef.current = autoSendKey
    isProcessingQueueRef.current = true

    void (async () => {
      try {
        await sendQueuedMessage(nextMessage, 0, autoSendReason)
      } finally {
        isProcessingQueueRef.current = false
      }
    })()

    return undefined
  }, [
    followUpBehavior,
    hasRunningToolInvocations,
    isAutoSendBlocked,
    isTurnActive,
    queuedMessages,
    sendQueuedMessage,
    successfulToolReleaseSignal,
  ])

  return {
    clearQueuedMessages,
    enqueueMessage,
    queuedMessages,
    removeQueuedMessage,
    reorderQueuedMessages,
    updateQueuedMessage,
  }
}
