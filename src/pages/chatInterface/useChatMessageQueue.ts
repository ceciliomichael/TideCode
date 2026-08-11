import { useCallback, useEffect, useRef, useState } from 'react'
import type { FollowUpBehavior } from '../../lib/appSettings'
import type { ChatAttachment, QueuedMessage } from '../../types/chat'
import {
  createQueuedComposerMessage,
  removeQueuedComposerMessage,
  removeQueuedComposerMessages,
  requeueQueuedComposerMessages,
  reorderQueuedComposerMessages,
  updateQueuedComposerMessage,
} from './chatComposerQueue'
import {
  resolveQueuedMessageAutoSendReason,
  shouldProcessQueuedMessages,
  type QueuedMessageAutoSendReason,
} from './chatQueueAutoSend'

interface UseChatMessageQueueInput {
  activeStreamId: string | null
  followUpBehavior: FollowUpBehavior
  isAutoSendBlocked: boolean
  isTurnActive: boolean
  onSendMessage: (
    messages: readonly QueuedMessage[],
    reason: QueuedMessageAutoSendReason,
  ) => Promise<QueuedMessageSendResult> | QueuedMessageSendResult
}

export interface QueuedMessageSendResult {
  accepted: boolean
  retryable: boolean
}

export function useChatMessageQueue({
  activeStreamId,
  followUpBehavior,
  isAutoSendBlocked,
  isTurnActive,
  onSendMessage,
}: UseChatMessageQueueInput) {
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const [isProcessingQueue, setIsProcessingQueue] = useState(false)
  const isProcessingQueueRef = useRef(false)
  const processingAttemptCounterRef = useRef(0)
  const activeProcessingAttemptRef = useRef<number | null>(null)
  const queueLifecycleVersionRef = useRef(0)
  const attemptedAutoSendKeyRef = useRef<string | null>(null)
  const observedAutoSendBlockedRef = useRef(isAutoSendBlocked)
  const steerSnapshotRevisionRef = useRef(0)
  const stagedSteerStreamIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (observedAutoSendBlockedRef.current !== isAutoSendBlocked) {
      attemptedAutoSendKeyRef.current = null
    }
    observedAutoSendBlockedRef.current = isAutoSendBlocked
  }, [isAutoSendBlocked])

  useEffect(() => {
    if (queuedMessages.length > 0) {
      return
    }

    attemptedAutoSendKeyRef.current = null
  }, [queuedMessages.length])

  useEffect(() => {
    const previousStreamId = stagedSteerStreamIdRef.current
    const shouldStage = followUpBehavior === 'steer' && isTurnActive && activeStreamId !== null
    const targetStreamId = shouldStage ? activeStreamId : previousStreamId
    if (!targetStreamId) {
      return
    }

    steerSnapshotRevisionRef.current += 1
    const revision = steerSnapshotRevisionRef.current
    const messages = shouldStage ? queuedMessages : []
    stagedSteerStreamIdRef.current = shouldStage ? activeStreamId : null
    void window.tidecodeChat.updatePendingSteerMessages({
      messages: [...messages],
      revision,
      streamId: targetStreamId,
    }).catch((error) => {
      console.error('Unable to update pending steer messages.', error)
    })
  }, [activeStreamId, followUpBehavior, isTurnActive, queuedMessages])

  useEffect(() => window.tidecodeChat.onStreamEvent((event) => {
    if (event.type !== 'steer_messages_consumed') {
      return
    }

    attemptedAutoSendKeyRef.current = null
    const consumedMessageIds = event.messages.map((message) => message.id)
    setQueuedMessages((currentValue) => removeQueuedComposerMessages(currentValue, consumedMessageIds))
  }), [])

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
    setQueuedMessages([])
  }, [])

  const sendQueuedMessages = useCallback(
    async (
      targetMessages: readonly QueuedMessage[],
      restoreIndex: number,
      reason: QueuedMessageAutoSendReason,
    ) => {
      const queueLifecycleVersion = queueLifecycleVersionRef.current
      const targetMessageIds = targetMessages.map((message) => message.id)
      setQueuedMessages((currentValue) => removeQueuedComposerMessages(currentValue, targetMessageIds))
      try {
        const sendResult = await onSendMessage(targetMessages, reason)
        if (!sendResult.accepted) {
          if (sendResult.retryable) {
            attemptedAutoSendKeyRef.current = null
          }

          if (queueLifecycleVersionRef.current === queueLifecycleVersion) {
            setQueuedMessages((currentValue) =>
              requeueQueuedComposerMessages(currentValue, targetMessages, restoreIndex),
            )
          }
        } else {
          attemptedAutoSendKeyRef.current = null
        }

        return sendResult.accepted
      } catch (caughtError) {
        console.error(caughtError)
        if (queueLifecycleVersionRef.current === queueLifecycleVersion) {
          setQueuedMessages((currentValue) =>
            requeueQueuedComposerMessages(currentValue, targetMessages, restoreIndex),
          )
        }
        return false
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
    if (
      !shouldProcessQueuedMessages({
        hasQueuedMessages: queuedMessages.length > 0,
        isAutoSendBlocked,
        isProcessingQueue,
      }) ||
      isProcessingQueueRef.current
    ) {
      return undefined
    }

    const targetMessages = [...queuedMessages]
    const nextMessage = targetMessages[0]
    if (!nextMessage) {
      return undefined
    }

    const autoSendReason = resolveQueuedMessageAutoSendReason({
      isTurnActive,
    })
    if (!autoSendReason) {
      return undefined
    }

    const autoSendKey = `${targetMessages.map((message) => message.id).join(',')}:${autoSendReason}`
    if (attemptedAutoSendKeyRef.current === autoSendKey) {
      return undefined
    }

    attemptedAutoSendKeyRef.current = autoSendKey
    isProcessingQueueRef.current = true
    const processingAttemptId = processingAttemptCounterRef.current + 1
    processingAttemptCounterRef.current = processingAttemptId
    activeProcessingAttemptRef.current = processingAttemptId
    setIsProcessingQueue(true)

    void (async () => {
      try {
        await sendQueuedMessages(targetMessages, 0, autoSendReason)
      } finally {
        if (activeProcessingAttemptRef.current === processingAttemptId) {
          activeProcessingAttemptRef.current = null
          isProcessingQueueRef.current = false
          setIsProcessingQueue(false)
        }
      }
    })()

    return undefined
  }, [
    isAutoSendBlocked,
    isProcessingQueue,
    isTurnActive,
    queuedMessages,
    sendQueuedMessages,
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
