
import { BrowserWindow, ipcMain } from 'electron'
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
  GitSourceControlWatchChangesInput,
  GitSyncInput,
  OpenExternalTerminalLinkInput,
  ResizeTerminalSessionInput,
  StartChatStreamInput,
  SubmitToolDecisionInput,
  UpdateConversationRuntimeInput,
  UpdatePendingSteerMessagesInput,
  WriteTerminalSessionInput,
} from '../../src/types/chat'
import { estimateCodexContextUsage } from '../chat/codex/runtime'
import { estimateApiKeyContextUsage } from '../chat/apiKey/runtime'
import { ensureRunServiceClient } from '../runService/ensureService'
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
  publishToRemote,
  stageGitFile,
  stageGitFiles,
  unstageGitFile,
  unstageGitFiles,
} from '../git/service'
import {
  subscribeSourceControlChanges,
  unsubscribeSourceControlChanges,
} from '../git/sourceControlWatch'
import {
  closeTerminalSession,
  createTerminalSession,
  openExternalTerminalLink,
  resizeTerminalSession,
  writeToTerminalSession,
} from '../terminal/service'

function getSourceControlWorkspacePath(input: GitSourceControlWatchChangesInput) {
  if (!input || typeof input.workspacePath !== 'string') {
    throw new Error('Workspace path is required.')
  }

  return input.workspacePath
}

export function registerChatGitTerminalIpcHandlers(
  activeChatStreamProviders: Map<string, StartChatStreamInput['providerId']>,
) {
  void ensureRunServiceClient()
    .then((runService) => {
      runService.onEvent((runEvent) => {
        if (runEvent.type === 'chat_event') {
          if (
            runEvent.event.type === 'completed'
            || runEvent.event.type === 'aborted'
            || runEvent.event.type === 'error'
          ) {
            activeChatStreamProviders.delete(runEvent.event.streamId)
          }
        }

        if (runEvent.type === 'chat_event' || runEvent.type === 'compaction_event') {
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.webContents.isDestroyed()) {
              window.webContents.send('chat:stream:event', runEvent.event)
            }
          }
        }

        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.webContents.isDestroyed()) {
            window.webContents.send('run-service:event', runEvent)
          }
        }
      })
    })
    .catch((error) => console.error('Unable to connect Electron to the Tidecode run service.', error))

  ipcMain.handle('runs:getCompactionState', async (_event, conversationId: string) =>
    (await ensureRunServiceClient()).getCompactionState(conversationId),
  )
  ipcMain.handle('runs:getConversationRuntime', async (_event, conversationId: string) =>
    (await ensureRunServiceClient()).getConversationRuntime(conversationId),
  )
  ipcMain.handle('runs:getProjection', async (_event, runId: string) =>
    (await ensureRunServiceClient()).getRunProjection(runId),
  )
  ipcMain.handle('runs:listActive', async () => (await ensureRunServiceClient()).listActiveRuns())
  ipcMain.handle('runs:updateConversationRuntime', async (_event, input: UpdateConversationRuntimeInput) =>
    (await ensureRunServiceClient()).updateConversationRuntime(input),
  )
  ipcMain.handle('chat:stream:start', async (_event, input: StartChatStreamInput) => {
    const result = await (await ensureRunServiceClient()).startStream(input)
    activeChatStreamProviders.set(result.streamId, input.providerId)
    return result
  })
  ipcMain.handle('chat:stream:cancel', async (_event, streamId: string) => {
    await (await ensureRunServiceClient()).cancelStream(streamId)
  })
  ipcMain.handle(
    'chat:stream:updatePendingSteerMessages',
    async (_event, input: UpdatePendingSteerMessagesInput) => {
      if (!input || typeof input.streamId !== 'string' || !input.streamId.trim()) {
        return { accepted: false }
      }
      return (await ensureRunServiceClient()).updatePendingSteerMessages(input)
    },
  )
  ipcMain.handle('chat:compactConversation', async (_event, input: CompactConversationInput) =>
    (await ensureRunServiceClient()).compactConversation(input),
  )
  ipcMain.handle('chat:stream:submitToolDecision', async (_event, input: SubmitToolDecisionInput) =>
    (await ensureRunServiceClient()).submitToolDecision(input),
  )
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
  ipcMain.handle('git:sourceControl:watch', async (event, input: GitSourceControlWatchChangesInput) =>
    subscribeSourceControlChanges(event.sender, getSourceControlWorkspacePath(input)),
  )
  ipcMain.handle('git:sourceControl:unwatch', async (event, input: GitSourceControlWatchChangesInput) =>
    unsubscribeSourceControlChanges(event.sender.id, getSourceControlWorkspacePath(input)),
  )
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
  ipcMain.handle('git:publishToRemote', async (_event, input) => publishToRemote(input))
}
