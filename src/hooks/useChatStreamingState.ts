import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { ConversationRuntimeStatePatch, ConversationRuntimeSnapshot } from './chatMessageSendTypes'
import { syncChatSelectionRefs } from '../lib/chatSelection'

const TEXT_STREAM_IDLE_GRACE_MS = 1500

interface UseChatStreamingStateInput {
  activeConversationId: string | null
  conversationRuntimeStates: Record<string, ConversationRuntimeSnapshot>
  selectedFolderId: string | null
  updateConversationRuntimeState: (conversationId: string, input: ConversationRuntimeStatePatch) => void
}

export function useChatStreamingState(input: UseChatStreamingStateInput) {
  const { activeConversationId, conversationRuntimeStates, selectedFolderId, updateConversationRuntimeState } = input
  const activeConversationIdRef = useRef<string | null>(input.activeConversationId)
  const selectedFolderIdRef = useRef<string | null>(input.selectedFolderId)
  const conversationRuntimeStatesRef = useRef(input.conversationRuntimeStates)
  const textStreamingIdleTimeoutRef = useRef<Record<string, number>>({})

  // A new-thread selection is rendered before the next click can be handled.
  // Keep the callback-facing refs in sync before paint so a fast send cannot
  // observe the previous running conversation.
  useLayoutEffect(() => {
    syncChatSelectionRefs(
      {
        activeConversationIdRef,
        selectedFolderIdRef,
      },
      {
        activeConversationId,
        selectedFolderId,
      },
    )
    conversationRuntimeStatesRef.current = conversationRuntimeStates
  }, [activeConversationId, conversationRuntimeStates, selectedFolderId])

  const clearTextStreamingIdleTimeout = useCallback((conversationId: string) => {
    const timeoutId = textStreamingIdleTimeoutRef.current[conversationId]
    if (timeoutId === undefined) {
      return
    }

    window.clearTimeout(timeoutId)
    delete textStreamingIdleTimeoutRef.current[conversationId]
  }, [])

  const stopTextStreaming = useCallback(
    (conversationId: string) => {
      clearTextStreamingIdleTimeout(conversationId)
      updateConversationRuntimeState(conversationId, {
        isStreamingTextActive: false,
      })
    },
    [clearTextStreamingIdleTimeout, updateConversationRuntimeState],
  )

  const markTextStreamingPulse = useCallback(
    (conversationId: string) => {
      updateConversationRuntimeState(conversationId, {
        isStreamingTextActive: true,
      })
      clearTextStreamingIdleTimeout(conversationId)
      textStreamingIdleTimeoutRef.current[conversationId] = window.setTimeout(() => {
        delete textStreamingIdleTimeoutRef.current[conversationId]
        updateConversationRuntimeState(conversationId, {
          isStreamingTextActive: false,
        })
      }, TEXT_STREAM_IDLE_GRACE_MS)
    },
    [clearTextStreamingIdleTimeout, updateConversationRuntimeState],
  )

  useEffect(
    () => () => {
      for (const timeoutId of Object.values(textStreamingIdleTimeoutRef.current)) {
        window.clearTimeout(timeoutId)
      }

      textStreamingIdleTimeoutRef.current = {}
    },
    [],
  )

  return {
    activeConversationIdRef,
    clearTextStreamingIdleTimeout,
    conversationRuntimeStatesRef,
    markTextStreamingPulse,
    selectedFolderIdRef,
    stopTextStreaming,
  }
}
