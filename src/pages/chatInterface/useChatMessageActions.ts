import { useCallback, useEffect } from 'react'
import type { ChatModeOption } from '../../components/chat/ChatModeSelectorField'
import { getNextChatMode, isChatModeToggleShortcut } from '../../components/chat/chatModeShortcut'
import type { ToolDecisionSubmission } from '../../components/chat/ToolDecisionRequestCard'
import type { ChatMessagesController, ChatRuntimeSelection } from '../../hooks/useChatMessages'
import type { ChatAttachment, ToolInvocationTrace } from '../../types/chat'
import { isPlanRelativePath, type PlanReviewComment } from '../../lib/planContracts'
import { createPlanImplementationMessage } from '../../lib/planImplementation'
import { formatPlanReviewRequest } from '../../lib/planReview'
import { getPlanPathsCreatedByRevertedUserMessage, hasPlanToolInvocation } from '../../lib/planPresentation'
import type { ChatWorkspaceUiState } from './useChatWorkspaceUiState'
import { shouldQueueMainMessage } from './chatQueueAutoSend'

interface UseChatMessageActionsInput {
  chatMessages: ChatMessagesController
  chatModeOptions: readonly ChatModeOption[]
  clearQueuedMessages: () => void
  enqueueMessage: (value: string, attachments: ChatAttachment[]) => void
  isCompressingChat: boolean
  onConversationHistoryChanged: () => void
  runtimeSelection: ChatRuntimeSelection
  workspaceState: ChatWorkspaceUiState
}

function closeRevertedPlanTabs(planPaths: readonly string[], workspaceState: ChatWorkspaceUiState) {
  if (planPaths.length === 0) {
    return
  }

  for (const relativePath of planPaths) {
    workspaceState.handleCloseWorkspaceTabsByPath(relativePath)
  }
}

async function removeRevertedPlanArtifacts(planPaths: readonly string[], workspaceState: ChatWorkspaceUiState) {
  closeRevertedPlanTabs(planPaths, workspaceState)
  const workspaceRootPath = workspaceState.activeWorkspacePath
  if (!workspaceRootPath) {
    return
  }

  for (const relativePath of planPaths) {
    try {
      await window.tidecodeWorkspace.deleteEntry({
        relativePath,
        workspaceRootPath,
      })
    } catch (error) {
      console.error(`Unable to remove reverted plan ${relativePath}.`, error)
    }
  }
}

export function useChatMessageActions({
  chatMessages,
  chatModeOptions,
  clearQueuedMessages,
  enqueueMessage,
  isCompressingChat,
  onConversationHistoryChanged,
  runtimeSelection,
  workspaceState,
}: UseChatMessageActionsInput) {
  const handleRevertUserMessage = useCallback(
    async (messageId: string) => {
      const revertedPlanPaths = getPlanPathsCreatedByRevertedUserMessage(chatMessages.messages, messageId)
      clearQueuedMessages()
      const didRevert = await chatMessages.revertUserMessage(messageId)
      if (!didRevert) {
        return
      }

      await removeRevertedPlanArtifacts(revertedPlanPaths, workspaceState)
      onConversationHistoryChanged()
      await workspaceState.handleRefreshWorkspaceFileTabs()
    },
    [chatMessages, clearQueuedMessages, onConversationHistoryChanged, workspaceState],
  )

  const handleEditUserMessage = useCallback(
    async (messageId: string) => {
      const revertedPlanPaths = chatMessages.revertedPlanPaths
      const didStartEditing = await chatMessages.startEditingMessage(messageId)
      if (didStartEditing) {
        await Promise.all(revertedPlanPaths.map((relativePath) => workspaceState.handleOpenWorkspacePlanPreview(relativePath)))
      }
      await workspaceState.handleRefreshWorkspaceFileTabs()
    },
    [chatMessages, workspaceState],
  )

  const handleCancelEditingMessage = useCallback(async () => {
    const revertedPlanPaths = chatMessages.revertedPlanPaths
    const didCancelEditing = await chatMessages.cancelEditingMessage()
    if (didCancelEditing) {
      await Promise.all(revertedPlanPaths.map((relativePath) => workspaceState.handleOpenWorkspacePlanPreview(relativePath)))
    }
    await workspaceState.handleRefreshWorkspaceFileTabs()
  }, [chatMessages, workspaceState])

  const handleSendMainMessage = useCallback(
    (value: string, attachments: ChatAttachment[]) => {
      if (shouldQueueMainMessage({
        isCompressingChat,
        isLoading: chatMessages.isLoading,
        isSending: chatMessages.isSending,
      })) {
        enqueueMessage(value, attachments)
        return
      }
       void chatMessages.sendNewMessage(runtimeSelection, value, attachments).then(
         onConversationHistoryChanged,
         onConversationHistoryChanged,
       )
    },
    [chatMessages, enqueueMessage, isCompressingChat, onConversationHistoryChanged, runtimeSelection],
  )

  const handleSendEditedMessage = useCallback(
    (value: string, attachments: ChatAttachment[]) => {
      void chatMessages.sendEditedMessage(runtimeSelection, value, attachments).then(
        onConversationHistoryChanged,
        onConversationHistoryChanged,
      )
    },
    [chatMessages, onConversationHistoryChanged, runtimeSelection],
  )

  const isAiBusy =
    chatMessages.isLoading || chatMessages.isSending || chatMessages.isStreamingResponse || isCompressingChat
  const hasUsedPlanTool = hasPlanToolInvocation(chatMessages.messages)
  const showImplementPlanButton =
    chatMessages.selectedChatMode === 'plan' && chatMessages.messages.length > 0 && !isAiBusy && !hasUsedPlanTool

  const handleImplementPlan = useCallback(async (planPath?: string) => {
    if (isAiBusy || (!planPath && chatMessages.selectedChatMode !== 'plan')) return

    if (planPath && !isPlanRelativePath(planPath)) return

    if (planPath) {
      const didPersistPlanStatus = await workspaceState.handleMarkWorkspacePlanImplementationStarted(planPath)
      if (!didPersistPlanStatus) {
        return
      }
    }

    chatMessages.setSelectedChatMode('agent')
    const implementationRequest = planPath
      ? createPlanImplementationMessage(planPath)
      : 'Implement the plan.'
    void chatMessages.sendProgrammaticMessage(runtimeSelection, implementationRequest, { chatMode: 'agent' })
  }, [chatMessages, isAiBusy, runtimeSelection, workspaceState])

  const handleRequestPlanChanges = useCallback(
    (relativePath: string, comments: PlanReviewComment[]) => {
      if (isAiBusy || comments.length === 0 || !isPlanRelativePath(relativePath)) {
        return
      }

      clearQueuedMessages()
      chatMessages.setSelectedChatMode('plan')
      void chatMessages
        .sendProgrammaticMessage(runtimeSelection, formatPlanReviewRequest(relativePath, comments), { chatMode: 'plan' })
        .then(onConversationHistoryChanged, onConversationHistoryChanged)
    },
    [chatMessages, clearQueuedMessages, isAiBusy, onConversationHistoryChanged, runtimeSelection],
  )

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

      void window.tidecodeChat
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
    handleRequestPlanChanges,
    handleRevertUserMessage,
    handleSendEditedMessage,
    handleSendMainMessage,
    handleToolDecisionSubmit,
    showImplementPlanButton,
  }
}
