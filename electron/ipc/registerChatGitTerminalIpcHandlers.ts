import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type {
  CheckoutGitBranchInput,
  CloseTerminalSessionInput,
  CompactConversationInput,
  CreateGitBranchInput,
  CreateTerminalSessionInput,
  EstimateContextUsageInput,
  GitCommitInput,
  GitDiffLoadOptions,
  GitFileStageBatchInput,
  GitFileStageInput,
  GitHistoryCommitDetailsInput,
  GitHistoryPageInput,
  GitSyncInput,
  OpenExternalTerminalLinkInput,
  ResizeTerminalSessionInput,
  StartChatStreamInput,
  SubmitToolDecisionInput,
  WriteTerminalSessionInput,
} from '../../src/types/chat'
import {
  cancelCodexChatStream,
  compactCodexConversation,
  estimateCodexContextUsage,
  startCodexChatStream,
  submitCodexToolDecision,
} from '../chat/codex/runtime'
import {
  cancelApiKeyChatStream,
  compactApiKeyConversation,
  estimateApiKeyContextUsage,
  startApiKeyChatStream,
  submitApiKeyToolDecision,
} from '../chat/apiKey/runtime'
import { emitChatStreamEvent } from '../chat/shared/runtimeStreamEvents'
import {
  checkoutGitBranch,
  createAndCheckoutGitBranch,
  discardGitFileChanges,
  getGitBranchState,
  getGitDiffSnapshot,
  getGitHubAuthStatus,
  connectGitHub,
  completeGitHubDeviceLogin,
  getGitHistoryCommitDetails,
  getGitHistoryPage,
  getGitStatus,
  gitCommit,
  gitSync,
  initGitRepository,
  publishToGitHub,
  stageGitFile,
  stageGitFiles,
  unstageGitFile,
  unstageGitFiles,
} from '../git/service'
import {
  closeTerminalSession,
  createTerminalSession,
  openExternalTerminalLink,
  resizeTerminalSession,
  writeToTerminalSession,
} from '../terminal/service'

export function registerChatGitTerminalIpcHandlers(
  activeChatStreamProviders: Map<string, StartChatStreamInput['providerId']>,
) {
  ipcMain.handle('chat:stream:start', async (event, input: StartChatStreamInput) => {
    if (input.providerId === 'codex') {
      const result = await startCodexChatStream(event.sender, input, () => {
        activeChatStreamProviders.delete(result.streamId)
      })
      activeChatStreamProviders.set(result.streamId, input.providerId)
      return result
    }

    const result = await startApiKeyChatStream(event.sender, input, () => {
      activeChatStreamProviders.delete(result.streamId)
    })
    activeChatStreamProviders.set(result.streamId, input.providerId)
    return result
  })
  ipcMain.handle('chat:stream:cancel', async (_event, streamId: string) => {
    const providerId = activeChatStreamProviders.get(streamId)
    const wasRegistered = activeChatStreamProviders.has(streamId)
    activeChatStreamProviders.delete(streamId)
    let wasCancelled = false

    if (providerId === 'codex') {
      wasCancelled = await cancelCodexChatStream(streamId)
      if (wasCancelled || wasRegistered) {
        emitChatStreamEvent(_event.sender, { streamId, type: 'aborted' })
      }
      return
    }

    if (providerId) {
      wasCancelled = await cancelApiKeyChatStream(streamId)
      if (wasCancelled || wasRegistered) {
        emitChatStreamEvent(_event.sender, { streamId, type: 'aborted' })
      }
      return
    }

    const cancellationResults = await Promise.all([
      cancelCodexChatStream(streamId),
      cancelApiKeyChatStream(streamId),
    ])
    wasCancelled = cancellationResults.some(Boolean)
    if (wasCancelled || wasRegistered) {
      emitChatStreamEvent(_event.sender, { streamId, type: 'aborted' })
    }
  })
  ipcMain.handle('chat:compactConversation', async (_event, input: CompactConversationInput) => {
    const attemptId = randomUUID()
    const streamId = randomUUID()
    emitChatStreamEvent(_event.sender, {
      attemptId,
      conversationId: input.conversationId,
      streamId,
      type: 'compaction_started',
    })

    try {
      const result = input.providerId === 'codex'
        ? await compactCodexConversation(input)
        : await compactApiKeyConversation(input)

      if (!result.compacted || !result.packetId) {
        emitChatStreamEvent(_event.sender, {
          attemptId,
          conversationId: input.conversationId,
          reason: 'unavailable',
          streamId,
          type: 'compaction_failed',
        })
        return result
      }

      emitChatStreamEvent(_event.sender, {
        compactionId: result.packetId,
        conversationId: input.conversationId,
        streamId,
        type: 'compaction_committed',
      })
      return result
    } catch (error) {
      emitChatStreamEvent(_event.sender, {
        attemptId,
        conversationId: input.conversationId,
        reason: 'error',
        streamId,
        type: 'compaction_failed',
      })
      throw error
    }
  })
  ipcMain.handle('chat:stream:submitToolDecision', async (_event, input: SubmitToolDecisionInput) => {
    const providerId = activeChatStreamProviders.get(input.streamId)

    if (providerId === 'codex') {
      return submitCodexToolDecision(input)
    }

    if (providerId) {
      return submitApiKeyToolDecision(input)
    }

    throw new Error('Unable to determine which provider owns this tool decision stream.')
  })
  ipcMain.handle('chat:context-usage:estimate', async (event, input: EstimateContextUsageInput) => {
    if (input.providerId === 'codex') {
      return estimateCodexContextUsage(event.sender, input)
    }

    return estimateApiKeyContextUsage(event.sender, input)
  })
  ipcMain.handle('terminal:createSession', async (event, input: CreateTerminalSessionInput) =>
    createTerminalSession(event, input),
  )
  ipcMain.handle('terminal:writeToSession', async (event, input: WriteTerminalSessionInput) =>
    writeToTerminalSession(event, input),
  )
  ipcMain.handle('terminal:resizeSession', async (event, input: ResizeTerminalSessionInput) =>
    resizeTerminalSession(event, input),
  )
  ipcMain.handle('terminal:closeSession', async (event, input: CloseTerminalSessionInput) =>
    closeTerminalSession(event, input),
  )
  ipcMain.handle('terminal:openExternalLink', async (_event, input: OpenExternalTerminalLinkInput) =>
    openExternalTerminalLink(input),
  )
  ipcMain.handle('git:getBranches', async (_event, workspacePath: string) => getGitBranchState(workspacePath))
  ipcMain.handle(
    'git:getDiffs',
    async (_event, input: { options?: GitDiffLoadOptions; workspacePath: string } | string) => {
      const workspacePath = typeof input === 'string' ? input : input.workspacePath
      const options = typeof input === 'string' ? undefined : input.options
      return getGitDiffSnapshot(workspacePath, options)
    },
  )
  ipcMain.handle('git:getHistoryCommitDetails', async (_event, input: GitHistoryCommitDetailsInput) =>
    getGitHistoryCommitDetails(input),
  )
  ipcMain.handle('git:getHistoryPage', async (_event, input: GitHistoryPageInput) => getGitHistoryPage(input))
  ipcMain.handle('git:getGitHubAuthStatus', async () => getGitHubAuthStatus())
  ipcMain.handle('git:connectGitHub', async () => connectGitHub())
  ipcMain.handle('git:completeGitHubDeviceLogin', async () => completeGitHubDeviceLogin())
  ipcMain.handle('git:discardFileChanges', async (_event, input: GitFileStageInput) => discardGitFileChanges(input))
  ipcMain.handle('git:checkoutBranch', async (_event, input: CheckoutGitBranchInput) => checkoutGitBranch(input))
  ipcMain.handle('git:createAndCheckoutBranch', async (_event, input: CreateGitBranchInput) =>
    createAndCheckoutGitBranch(input),
  )
  ipcMain.handle('git:commit', async (_event, input: GitCommitInput) => gitCommit(input))
  ipcMain.handle('git:sync', async (_event, input: GitSyncInput) => gitSync(input))
  ipcMain.handle('git:getStatus', async (_event, workspacePath: string) => getGitStatus(workspacePath))
  ipcMain.handle('git:stageFile', async (_event, input: GitFileStageInput) => stageGitFile(input))
  ipcMain.handle('git:stageFiles', async (_event, input: GitFileStageBatchInput) => stageGitFiles(input))
  ipcMain.handle('git:unstageFile', async (_event, input: GitFileStageInput) => unstageGitFile(input))
  ipcMain.handle('git:unstageFiles', async (_event, input: GitFileStageBatchInput) => unstageGitFiles(input))
  ipcMain.handle('git:init', async (_event, workspacePath: string) => initGitRepository(workspacePath))
  ipcMain.handle('git:publishToGitHub', async (_event, input) => publishToGitHub(input))

}
