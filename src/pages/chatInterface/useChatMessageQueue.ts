import { useCallback, useEffect, useRef, useState } from 'react'
import type { FollowUpBehavior } from '../../lib/appSettings'
import type { ChatAttachment, QueuedMessage, SharedFollowUpItem, SharedFollowUpSnapshot, SharedFollowUpMutation } from '../../types/chat'
import {
  createQueuedComposerMessage,
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

function messagesFromItems(items: readonly SharedFollowUpItem[]) {
  return items.map((item) => item.message)
}

export function useChatMessageQueue({
  activeStreamId,
  followUpBehavior,
  isAutoSendBlocked,
  isTurnActive,
  onSendMessage,
}: UseChatMessageQueueInput) {
  const [followUpItems, setFollowUpItems] = useState<SharedFollowUpItem[]>([])
  const [isProcessingQueue, setIsProcessingQueue] = useState(false)
  const followUpItemsRef = useRef<SharedFollowUpItem[]>([])
  const sharedStreamIdRef = useRef<string | null>(null)
  const unsyncedMessageIdsRef = useRef(new Set<string>())
  const isProcessingQueueRef = useRef(false)
  const processingAttemptCounterRef = useRef(0)
  const activeProcessingAttemptRef = useRef<number | null>(null)
  const queueLifecycleVersionRef = useRef(0)
  const attemptedAutoSendKeyRef = useRef<string | null>(null)
  const observedAutoSendBlockedRef = useRef(isAutoSendBlocked)
  const claimInFlightStreamIdRef = useRef<string | null>(null)

  const updateItems = useCallback((updater: (current: SharedFollowUpItem[]) => SharedFollowUpItem[]) => {
    setFollowUpItems((current) => {
      const next = updater(current)
      followUpItemsRef.current = next
      return next
    })
  }, [])

   const mergeSharedSnapshot = useCallback((snapshot: SharedFollowUpSnapshot) => {
    if (snapshot.streamId !== sharedStreamIdRef.current) return
    attemptedAutoSendKeyRef.current = null
    updateItems((current) => {
      const sharedIds = new Set(snapshot.items.map((item) => item.message.id))
      const pendingLocalItems = current.filter((item) =>
        unsyncedMessageIdsRef.current.has(item.message.id) && !sharedIds.has(item.message.id),
      )
      return [...snapshot.items, ...pendingLocalItems]
    })
  }, [updateItems])

  const publishMutation = useCallback((streamId: string, mutation: SharedFollowUpMutation) => {
    void window.tidecodeRuns.updatePendingFollowUps({ mutation, streamId })
      .then(mergeSharedSnapshot)
      .catch((error) => console.error('Unable to update shared follow-up messages.', error))
  }, [mergeSharedSnapshot])

  const claimSharedFollowUps = useCallback((streamId: string) => {
    if (claimInFlightStreamIdRef.current === streamId || sharedStreamIdRef.current !== streamId) return
    claimInFlightStreamIdRef.current = streamId
    void window.tidecodeRuns.claimPendingFollowUps({ streamId })
      .then((result) => {
        if (sharedStreamIdRef.current !== streamId) return
        sharedStreamIdRef.current = null
        unsyncedMessageIdsRef.current.clear()
        attemptedAutoSendKeyRef.current = null
        updateItems(() => result.messages.map((message) => ({ behavior: 'queue' as const, message })))
      })
      .catch((error) => console.error('Unable to claim shared follow-up messages.', error))
      .finally(() => {
        if (claimInFlightStreamIdRef.current === streamId) claimInFlightStreamIdRef.current = null
      })
  }, [updateItems])

  useEffect(() => {
    if (observedAutoSendBlockedRef.current !== isAutoSendBlocked) attemptedAutoSendKeyRef.current = null
    observedAutoSendBlockedRef.current = isAutoSendBlocked
  }, [isAutoSendBlocked])

  useEffect(() => {
    if (followUpItems.length === 0) attemptedAutoSendKeyRef.current = null
  }, [followUpItems.length])

  useEffect(() => {
    if (!activeStreamId) return
    sharedStreamIdRef.current = activeStreamId
    claimInFlightStreamIdRef.current = null

    void window.tidecodeRuns.getPendingFollowUps(activeStreamId)
      .then((snapshot) => {
        if (!snapshot || sharedStreamIdRef.current !== activeStreamId) return
        mergeSharedSnapshot(snapshot)
        const pendingLocalItems = followUpItemsRef.current.filter((item) => unsyncedMessageIdsRef.current.has(item.message.id))
        for (const item of pendingLocalItems) {
          publishMutation(activeStreamId, { type: 'add', item })
          unsyncedMessageIdsRef.current.delete(item.message.id)
        }
      })
      .catch((error) => console.error('Unable to load shared follow-up messages.', error))
  }, [activeStreamId, mergeSharedSnapshot, publishMutation])

  useEffect(() => window.tidecodeRuns.onEvent((event) => {
    if (event.type === 'follow_ups_updated') {
      mergeSharedSnapshot(event.snapshot)
      return
    }
    if (event.type !== 'run_state') return
    const streamId = event.run.streamId
    if (!streamId || streamId !== sharedStreamIdRef.current) return
    if (event.run.status === 'completed' || event.run.status === 'failed' || event.run.status === 'cancelled' || event.run.status === 'interrupted') {
      claimSharedFollowUps(streamId)
    }
  }), [claimSharedFollowUps, mergeSharedSnapshot])

  const enqueueMessage = useCallback((content: string, attachments?: ChatAttachment[]) => {
    const message = createQueuedComposerMessage({ attachments, content })
    const item: SharedFollowUpItem = { behavior: followUpBehavior, message }
    attemptedAutoSendKeyRef.current = null
    updateItems((current) => [...current, item])
    const streamId = sharedStreamIdRef.current
    if (streamId) publishMutation(streamId, { type: 'add', item })
    else unsyncedMessageIdsRef.current.add(message.id)
  }, [followUpBehavior, publishMutation, updateItems])

  const removeQueuedMessage = useCallback((id: string) => {
    queueLifecycleVersionRef.current += 1
    attemptedAutoSendKeyRef.current = null
    unsyncedMessageIdsRef.current.delete(id)
    updateItems((current) => current.filter((item) => item.message.id !== id))
    const streamId = sharedStreamIdRef.current
    if (streamId) publishMutation(streamId, { type: 'remove', id })
  }, [publishMutation, updateItems])

  const updateQueuedMessage = useCallback((id: string, content: string, attachments?: ChatAttachment[]) => {
    queueLifecycleVersionRef.current += 1
    attemptedAutoSendKeyRef.current = null
    const currentMessage = followUpItemsRef.current.find((item) => item.message.id === id)?.message
    if (!currentMessage) return
    const message = updateQueuedComposerMessage([currentMessage], id, content, attachments)[0]
    if (!message) return
    updateItems((current) => current.map((item) => item.message.id === id ? { ...item, message } : item))
    const streamId = sharedStreamIdRef.current
    if (streamId) publishMutation(streamId, { type: 'update', message })
  }, [publishMutation, updateItems])

  const clearQueuedMessages = useCallback(() => {
    queueLifecycleVersionRef.current += 1
    attemptedAutoSendKeyRef.current = null
    sharedStreamIdRef.current = null
    claimInFlightStreamIdRef.current = null
    unsyncedMessageIdsRef.current.clear()
    updateItems(() => [])
  }, [updateItems])

  const reorderQueuedMessages = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    queueLifecycleVersionRef.current += 1
    attemptedAutoSendKeyRef.current = null
    updateItems((current) => {
      const reordered = reorderQueuedComposerMessages(messagesFromItems(current), sourceId, targetId)
      const byId = new Map(current.map((item) => [item.message.id, item]))
      return reordered.map((message) => byId.get(message.id) ?? { behavior: 'queue' as const, message })
    })
    const streamId = sharedStreamIdRef.current
    if (streamId) publishMutation(streamId, { type: 'reorder', sourceId, targetId })
  }, [publishMutation, updateItems])

  const queuedMessages = messagesFromItems(followUpItems)

  const sendQueuedMessages = useCallback(async (
    targetMessages: readonly QueuedMessage[],
    restoreIndex: number,
    reason: QueuedMessageAutoSendReason,
  ) => {
    const queueLifecycleVersion = queueLifecycleVersionRef.current
    const targetMessageIds = new Set(targetMessages.map((message) => message.id))
    updateItems((current) => current.filter((item) => !targetMessageIds.has(item.message.id)))
    try {
      const sendResult = await onSendMessage(targetMessages, reason)
      if (!sendResult.accepted) {
        if (sendResult.retryable) attemptedAutoSendKeyRef.current = null
        if (queueLifecycleVersionRef.current === queueLifecycleVersion) {
          updateItems((current) => {
            const restored = requeueQueuedComposerMessages(messagesFromItems(current), targetMessages, restoreIndex)
            const existingById = new Map(current.map((item) => [item.message.id, item]))
            return restored.map((message) => existingById.get(message.id) ?? { behavior: 'queue' as const, message })
          })
        }
      } else {
        attemptedAutoSendKeyRef.current = null
      }
      return sendResult.accepted
    } catch (caughtError) {
      console.error(caughtError)
      if (queueLifecycleVersionRef.current === queueLifecycleVersion) {
        updateItems((current) => {
          const restored = requeueQueuedComposerMessages(messagesFromItems(current), targetMessages, restoreIndex)
          const existingById = new Map(current.map((item) => [item.message.id, item]))
          return restored.map((message) => existingById.get(message.id) ?? { behavior: 'queue' as const, message })
        })
      }
      return false
    }
  }, [onSendMessage, updateItems])

  useEffect(() => {
    if (sharedStreamIdRef.current !== null) return undefined
    if (!shouldProcessQueuedMessages({
      hasQueuedMessages: queuedMessages.length > 0,
      isAutoSendBlocked,
      isProcessingQueue,
    }) || isProcessingQueueRef.current) return undefined

    const targetMessages = [...queuedMessages]
    if (!targetMessages[0]) return undefined
    const autoSendReason = resolveQueuedMessageAutoSendReason({ isTurnActive })
    if (!autoSendReason) return undefined
    const autoSendKey = targetMessages.map((message) => message.id).join(',') + ':' + autoSendReason
    if (attemptedAutoSendKeyRef.current === autoSendKey) return undefined

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
  }, [isAutoSendBlocked, isProcessingQueue, isTurnActive, queuedMessages, sendQueuedMessages])

  return {
    clearQueuedMessages,
    enqueueMessage,
    queuedMessages,
    removeQueuedMessage,
    reorderQueuedMessages,
    updateQueuedMessage,
  }
}
