import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatAttachment, QueuedMessage } from '../../types/chat'
import {
  createQueuedComposerMessage,
  dequeueQueuedComposerMessage,
  removeQueuedComposerMessage,
  updateQueuedComposerMessage,
} from './chatComposerQueue'

interface UseChatMessageQueueInput {
  isQueueBlocked: boolean
  onSendMessage: (message: QueuedMessage) => Promise<boolean> | boolean
}

export function useChatMessageQueue({ isQueueBlocked, onSendMessage }: UseChatMessageQueueInput) {
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const isProcessingQueueRef = useRef(false)
  const attemptedQueueMessageIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (isQueueBlocked) {
      attemptedQueueMessageIdRef.current = null
    }
  }, [isQueueBlocked])

  const enqueueMessage = useCallback((content: string, attachments?: ChatAttachment[]) => {
    const nextMessage = createQueuedComposerMessage({ attachments, content })
    attemptedQueueMessageIdRef.current = null
    setQueuedMessages((currentValue) => [...currentValue, nextMessage])
  }, [])

  const removeQueuedMessage = useCallback((id: string) => {
    attemptedQueueMessageIdRef.current = null
    setQueuedMessages((currentValue) => removeQueuedComposerMessage(currentValue, id))
  }, [])

  const updateQueuedMessage = useCallback((id: string, content: string, attachments?: ChatAttachment[]) => {
    attemptedQueueMessageIdRef.current = null
    setQueuedMessages((currentValue) => updateQueuedComposerMessage(currentValue, id, content, attachments))
  }, [])

  const clearQueuedMessages = useCallback(() => {
    attemptedQueueMessageIdRef.current = null
    setQueuedMessages([])
  }, [])

  const sendQueuedMessage = useCallback(
    async (targetMessage: QueuedMessage, restoreIndex: number) => {
      setQueuedMessages((currentValue) => removeQueuedComposerMessage(currentValue, targetMessage.id))

      try {
        const wasAccepted = await onSendMessage(targetMessage)
        if (!wasAccepted) {
          attemptedQueueMessageIdRef.current = null
          setQueuedMessages((currentValue) => {
            const nextMessages = [...currentValue]
            nextMessages.splice(Math.max(restoreIndex, 0), 0, targetMessage)
            return nextMessages
          })
        } else {
          attemptedQueueMessageIdRef.current = null
        }

        return wasAccepted
      } catch (caughtError) {
        console.error(caughtError)
        attemptedQueueMessageIdRef.current = null
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

      attemptedQueueMessageIdRef.current = null
      await sendQueuedMessage(targetMessage, restoreIndex)
    },
    [queuedMessages, sendQueuedMessage],
  )

  useEffect(() => {
    if (isQueueBlocked || queuedMessages.length === 0 || isProcessingQueueRef.current) {
      return undefined
    }

    const { nextMessage } = dequeueQueuedComposerMessage(queuedMessages)
    if (!nextMessage) {
      return undefined
    }

    if (attemptedQueueMessageIdRef.current === nextMessage.id) {
      return undefined
    }

    attemptedQueueMessageIdRef.current = nextMessage.id
    isProcessingQueueRef.current = true

    void (async () => {
      try {
        await sendQueuedMessage(nextMessage, 0)
      } finally {
        isProcessingQueueRef.current = false
      }
    })()

    return undefined
  }, [isQueueBlocked, queuedMessages, sendQueuedMessage])

  return {
    clearQueuedMessages,
    enqueueMessage,
    forceSendQueuedMessage,
    queuedMessages,
    removeQueuedMessage,
    updateQueuedMessage,
  }
}
