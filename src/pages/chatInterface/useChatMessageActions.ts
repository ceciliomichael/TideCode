import { useCallback, useEffect, useRef } from 'react'
import type { ChatModeOption } from '../../components/chat/ChatModeSelectorField'
import { getNextChatMode, isChatModeToggleShortcut } from '../../components/chat/chatModeShortcut'
import type { ToolDecisionSubmission } from '../../components/chat/ToolDecisionRequestCard'
import type { ChatMessagesController, ChatRuntimeSelection } from '../../hooks/useChatMessages'
import type { ChatRuntimeConfigState } from '../../hooks/useChatRuntimeConfig'
import type { ChatAttachment, ToolInvocationTrace } from '../../types/chat'
import { isPlanRelativePath, type PlanReviewComment } from '../../lib/planContracts'
import { persistPlanImplementationHandoff } from '../../lib/planHandoff'
import { createPlanImplementationMessage } from '../../lib/planImplementation'
import { createPlanRevisionRequestMessage } from '../../lib/planRevision'
import {
  getLatestCompletedPlanPresentation,
  getPlanPathsCreatedByRevertedUserMessage,
} from '../../lib/planPresentation'
import type { ChatWorkspaceUiState } from './useChatWorkspaceUiState'
import { shouldQueueMainMessage } from './chatQueueAutoSend'
import { buildModeRuntimeSelection } from './chatInterfaceRuntime'

interface UseChatMessageActionsInput {
  chatMessages: ChatMessagesController
  chatModeOptions: readonly ChatModeOption[]
  clearQueuedMessages: () => void
  enqueueMessage: (
    value: string,
    attachments: ChatAttachment[],
    mentionPathMap?: ReadonlyMap<string, string>,
  ) => void
  isCompressingChat: boolean
  onMainTurnAccepted: () => void
  onConversationHistoryChanged: () => void
  resolveDefaultRuntimeModel: ChatRuntimeConfigState['resolveDefaultRuntimeModel']
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
  onMainTurnAccepted,
  onConversationHistoryChanged,
  resolveDefaultRuntimeModel,
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
    (value: string, attachments: ChatAttachment[], mentionPathMap: ReadonlyMap<string, string>) => {
      if (shouldQueueMainMessage({
        isCompressingChat,
        isAbortInProgress: chatMessages.isAbortInProgress,
        isLoading: chatMessages.isLoading,
        isSending: chatMessages.isSending,
      })) {
        enqueueMessage(value, attachments, mentionPathMap)
        return
      }
      void chatMessages.sendNewMessage(runtimeSelection, value, attachments, { mentionPathMap }).then(
        (result) => {
          onConversationHistoryChanged()
          if (result.accepted) {
            onMainTurnAccepted()
          }
        },
        onConversationHistoryChanged,
      )
    },
    [
      chatMessages,
      enqueueMessage,
      isCompressingChat,
      onConversationHistoryChanged,
      onMainTurnAccepted,
      runtimeSelection,
    ],
  )

  const handleSendEditedMessage = useCallback(
    (value: string, attachments: ChatAttachment[], mentionPathMap: ReadonlyMap<string, string>) => {
      void chatMessages.sendEditedMessage(runtimeSelection, value, attachments, mentionPathMap).then(
        onConversationHistoryChanged,
        onConversationHistoryChanged,
      )
    },
    [chatMessages, onConversationHistoryChanged, runtimeSelection],
  )

  const isAiBusy =
    chatMessages.isLoading || chatMessages.isSending || chatMessages.isStreamingResponse || isCompressingChat
  const latestPlanPath = getLatestCompletedPlanPresentation(chatMessages.messages)?.relativePath ?? null
  const showImplementPlanButton =
    chatMessages.selectedChatMode === 'plan' && latestPlanPath !== null
  const queuedImplementationPlanPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (queuedImplementationPlanPathRef.current !== null && queuedImplementationPlanPathRef.current !== latestPlanPath) {
      queuedImplementationPlanPathRef.current = null
    }
  }, [latestPlanPath])

  const handleImplementPlan = useCallback(async (planPath?: string) => {
    const implementationPlanPath = planPath ?? latestPlanPath
    if (!implementationPlanPath || !isPlanRelativePath(implementationPlanPath)) return
    if (isAiBusy && queuedImplementationPlanPathRef.current === implementationPlanPath) return
    if (isAiBusy) queuedImplementationPlanPathRef.current = implementationPlanPath

    const didHandoffPlan = await persistPlanImplementationHandoff(implementationPlanPath, workspaceState)
    if (!didHandoffPlan) {
      if (isAiBusy && queuedImplementationPlanPathRef.current === implementationPlanPath) {
        queuedImplementationPlanPathRef.current = null
      }
      return
    }

    chatMessages.setSelectedChatMode('agent')
    const implementationRequest = createPlanImplementationMessage(implementationPlanPath)
    if (isAiBusy) {
      enqueueMessage(implementationRequest, [])
      return
    }

    void chatMessages.sendProgrammaticMessage(
      buildModeRuntimeSelection(runtimeSelection, resolveDefaultRuntimeModel('agent')),
      implementationRequest,
      { chatMode: 'agent' },
    )
  }, [chatMessages, enqueueMessage, isAiBusy, latestPlanPath, resolveDefaultRuntimeModel, runtimeSelection, workspaceState])

  const handleRequestPlanChanges = useCallback(
    (relativePath: string, comments: PlanReviewComment[]) => {
      if (isAiBusy || comments.length === 0 || !isPlanRelativePath(relativePath)) {
        return
      }

      clearQueuedMessages()
      chatMessages.setSelectedChatMode('plan')
      void chatMessages
        .sendProgrammaticMessage(
          buildModeRuntimeSelection(runtimeSelection, resolveDefaultRuntimeModel('plan')),
          createPlanRevisionRequestMessage(relativePath, comments),
          { chatMode: 'plan' },
        )
        .then(onConversationHistoryChanged, onConversationHistoryChanged)
    },
    [
      chatMessages,
      clearQueuedMessages,
      isAiBusy,
      onConversationHistoryChanged,
      resolveDefaultRuntimeModel,
      runtimeSelection,
    ],
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
