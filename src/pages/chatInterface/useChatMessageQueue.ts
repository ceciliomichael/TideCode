import { useCallback, useEffect, useRef, useState } from 'react'
import type { FollowUpBehavior } from '../../lib/appSettings'
import type { ChatAttachment, QueuedMessage } from '../../types/chat'
import {
  createQueuedComposerMessage,
  dequeueQueuedComposerMessage,
  removeQueuedComposerMessage,
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
  ) => Promise<boolean> | boolean
  successfulToolCompletionSignal: string | null
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
  const attemptedAutoSendKeyRef = useRef<string | null>(null)
  const observedSuccessfulToolSignalRef = useRef(successfulToolCompletionSignal)

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
    attemptedAutoSendKeyRef.current = null
    setQueuedMessages((currentValue) => removeQueuedComposerMessage(currentValue, id))
  }, [])

  const updateQueuedMessage = useCallback((id: string, content: string, attachments?: ChatAttachment[]) => {
    attemptedAutoSendKeyRef.current = null
    setQueuedMessages((currentValue) => updateQueuedComposerMessage(currentValue, id, content, attachments))
  }, [])

  const clearQueuedMessages = useCallback(() => {
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
      setQueuedMessages((currentValue) => removeQueuedComposerMessage(currentValue, targetMessage.id))

      try {
        const wasAccepted = await onSendMessage(targetMessage, reason)
        if (!wasAccepted) {
          setQueuedMessages((currentValue) => {
            const nextMessages = [...currentValue]
            nextMessages.splice(Math.max(restoreIndex, 0), 0, targetMessage)
            return nextMessages
          })
        } else {
          attemptedAutoSendKeyRef.current = null
          setSuccessfulToolReleaseSignal(null)
        }

        return wasAccepted
      } catch (caughtError) {
        console.error(caughtError)
        setQueuedMessages((currentValue) => {
          const nextMessages = [...currentValue]
          nextMessages.splice(Math.max(restoreIndex, 0), 0, targetMessage)
          return nextMessages
        })
        return false
      }
    },
    [onSendMessage],
  )

  const forceSendQueuedMessage = useCallback(
    async (id: string) => {
      const restoreIndex = queuedMessages.findIndex((message) => message.id === id)
      const targetMessage = queuedMessages[restoreIndex]
      if (!targetMessage) {
        return
      }

      attemptedAutoSendKeyRef.current = null
      await sendQueuedMessage(targetMessage, restoreIndex, 'turn_completed')
    },
    [queuedMessages, sendQueuedMessage],
  )

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
    forceSendQueuedMessage,
    queuedMessages,
    removeQueuedMessage,
    updateQueuedMessage,
  }
}
