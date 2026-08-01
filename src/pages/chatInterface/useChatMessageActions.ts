import { useCallback, useEffect } from 'react'
import type { ChatModeOption } from '../../components/chat/ChatModeSelectorField'
import { getNextChatMode, isChatModeToggleShortcut } from '../../components/chat/chatModeShortcut'
import type { ToolDecisionSubmission } from '../../components/chat/ToolDecisionRequestCard'
import type { ChatMessagesController, ChatRuntimeSelection } from '../../hooks/useChatMessages'
import type { ChatAttachment, ToolInvocationTrace } from '../../types/chat'
import type { ChatWorkspaceUiState } from './useChatWorkspaceUiState'

interface UseChatMessageActionsInput {
  chatMessages: ChatMessagesController
  chatModeOptions: readonly ChatModeOption[]
  clearQueuedMessages: () => void
  enqueueMessage: (value: string, attachments: ChatAttachment[]) => void
  isCompressingChat: boolean
  runtimeSelection: ChatRuntimeSelection
  workspaceState: ChatWorkspaceUiState
}

export function useChatMessageActions({
  chatMessages,
  chatModeOptions,
  clearQueuedMessages,
  enqueueMessage,
  isCompressingChat,
  runtimeSelection,
  workspaceState,
}: UseChatMessageActionsInput) {
  const handleRevertUserMessage = useCallback(
    async (messageId: string) => {
      clearQueuedMessages()
      await chatMessages.revertUserMessage(messageId)
      await workspaceState.handleRefreshWorkspaceFileTabs()
    },
    [chatMessages, clearQueuedMessages, workspaceState],
  )

  const handleEditUserMessage = useCallback(
    async (messageId: string) => {
      await chatMessages.startEditingMessage(messageId)
      await workspaceState.handleRefreshWorkspaceFileTabs()
    },
    [chatMessages, workspaceState],
  )

  const handleCancelEditingMessage = useCallback(async () => {
    await chatMessages.cancelEditingMessage()
    await workspaceState.handleRefreshWorkspaceFileTabs()
  }, [chatMessages, workspaceState])

  const handleSendMainMessage = useCallback(
    (value: string, attachments: ChatAttachment[]) => {
      if (chatMessages.isLoading || chatMessages.isSending || isCompressingChat) {
        enqueueMessage(value, attachments)
        return
      }
      void chatMessages.sendNewMessage(runtimeSelection, value, attachments)
    },
    [chatMessages, enqueueMessage, isCompressingChat, runtimeSelection],
  )

  const handleSendEditedMessage = useCallback(
    (value: string, attachments: ChatAttachment[]) => {
      void chatMessages.sendEditedMessage(runtimeSelection, value, attachments)
    },
    [chatMessages, runtimeSelection],
  )

  const isAiBusy =
    chatMessages.isLoading || chatMessages.isSending || chatMessages.isStreamingResponse || isCompressingChat
  const showImplementPlanButton =
    chatMessages.selectedChatMode === 'plan' && chatMessages.messages.length > 0 && !isAiBusy

  const handleImplementPlan = useCallback(() => {
    if (isAiBusy || chatMessages.selectedChatMode !== 'plan') return

    chatMessages.setSelectedChatMode('agent')
    void chatMessages.sendProgrammaticMessage(runtimeSelection, 'Implement the plan', { chatMode: 'agent' })
  }, [chatMessages, isAiBusy, runtimeSelection])

  const handleToolDecisionSubmit = useCallback(
    (invocation: ToolInvocationTrace, submission: ToolDecisionSubmission) => {
      const decisionRequest = invocation.decisionRequest
      if (!decisionRequest) return

      if (invocation.toolName === 'ready_implement') {
        const nextMode =
          submission.selectedOptionId === 'yes_implement'
            ? 'agent'
            : submission.selectedOptionId === 'no_modify'
              ? 'plan'
              : chatMessages.selectedChatMode
        chatMessages.setSelectedChatMode(nextMode)
      }

      void window.echosphereChat
        .submitToolDecision({
          customAnswer: submission.customAnswer,
          invocationId: invocation.id,
          selectedOptionId: submission.selectedOptionId,
          streamId: decisionRequest.streamId,
        })
        .catch((error) => console.error(error))
    },
    [chatMessages],
  )

  const handleCycleChatMode = useCallback(() => {
    const nextChatMode = getNextChatMode(chatMessages.selectedChatMode, chatModeOptions)
    if (nextChatMode) chatMessages.setSelectedChatMode(nextChatMode)
  }, [chatMessages, chatModeOptions])

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return

      const isImplementPlanShortcut =
        event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === 'KeyI'
      if (isImplementPlanShortcut) {
        event.preventDefault()
        handleImplementPlan()
        return
      }
      if (!isChatModeToggleShortcut(event)) return

      event.preventDefault()
      handleCycleChatMode()
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [handleCycleChatMode, handleImplementPlan])

  return {
    handleCancelEditingMessage,
    handleEditUserMessage,
    handleImplementPlan,
    handleRevertUserMessage,
    handleSendEditedMessage,
    handleSendMainMessage,
    handleToolDecisionSubmit,
    showImplementPlanButton,
  }
}
