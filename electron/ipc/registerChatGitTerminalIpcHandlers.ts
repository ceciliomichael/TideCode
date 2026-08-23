
import { BrowserWindow, ipcMain } from 'electron'
import type {
  AppSettingsSurface,
  CheckoutGitBranchInput,
  ClaimSharedFollowUpsInput,
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
  UpdateSharedFollowUpsInput,
  UpdatePendingSteerMessagesInput,
  WriteTerminalSessionInput,
  ChatStreamCancellation,
} from '../../src/types/chat'
import { estimateCodexContextUsage } from '../chat/codex/runtime'
import { estimateApiKeyContextUsage } from '../chat/apiKey/runtime'
import { ensureRunServiceClient } from '../runService/ensureService'
import { refreshProjectPathWatcher } from '../history/projectPathWatch'
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
  openExternalTerminalLink,
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
  const emittedTerminalExitSessionIds = new Set<string>()
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

        if (runEvent.type === 'project_registered') {
          refreshProjectPathWatcher()
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
      runService.onTerminalEvent((terminalEvent) => {
        if (terminalEvent.type === 'terminal_output') {
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.webContents.isDestroyed()) {
              window.webContents.send('terminal:session:data', {
                brokerSessionId: terminalEvent.output.brokerSessionId,
                cursor: terminalEvent.output.endCursor,
                data: terminalEvent.output.data,
                sessionId: terminalEvent.legacySessionId,
              })
            }
          }
          return
        }

        if (
          terminalEvent.type === 'terminal_session_changed'
          && (terminalEvent.session.state === 'exited' || terminalEvent.session.state === 'terminated')
          && !emittedTerminalExitSessionIds.has(terminalEvent.session.brokerSessionId)
        ) {
          emittedTerminalExitSessionIds.add(terminalEvent.session.brokerSessionId)
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.webContents.isDestroyed()) {
              window.webContents.send('terminal:session:exit', {
                brokerSessionId: terminalEvent.session.brokerSessionId,
                exitCode: terminalEvent.session.exitCode ?? -1,
                sessionId: terminalEvent.session.legacySessionId,
                signal: terminalEvent.session.signal,
              })
            }
          }
        }

        if (terminalEvent.type === 'terminal_cleanup_failed') {
          console.error(
            `Terminal cleanup failed for ${terminalEvent.session.brokerSessionId}: ${terminalEvent.error}`,
          )
        }
      })
    })
    .catch((error) => console.error('Unable to connect Electron to the Tidecode run service.', error))

  ipcMain.handle('runs:getCompactionState', async (_event, conversationId: string) =>
    (await ensureRunServiceClient()).getCompactionState(conversationId),
  )
  ipcMain.handle('runs:getConversationRuntime', async (_event, conversationId: string, surface?: AppSettingsSurface) =>
    (await ensureRunServiceClient()).getConversationRuntime(conversationId, surface),
  )
  ipcMain.handle('runs:getPendingFollowUps', async (_event, streamId: string) =>
    (await ensureRunServiceClient()).getPendingFollowUps(streamId),
  )
  ipcMain.handle('runs:getProjection', async (_event, runId: string) =>
    (await ensureRunServiceClient()).getRunProjection(runId),
  )
  ipcMain.handle('runs:listActive', async () => (await ensureRunServiceClient()).listActiveRuns())
  ipcMain.handle('runs:claimPendingFollowUps', async (_event, input: ClaimSharedFollowUpsInput) =>
    (await ensureRunServiceClient()).claimPendingFollowUps(input),
  )
  ipcMain.handle('runs:updatePendingFollowUps', async (_event, input: UpdateSharedFollowUpsInput) =>
    (await ensureRunServiceClient()).updatePendingFollowUps(input),
  )
  ipcMain.handle('runs:updateConversationRuntime', async (_event, input: UpdateConversationRuntimeInput) =>
    (await ensureRunServiceClient()).updateConversationRuntime(input),
  )
  ipcMain.handle('chat:stream:start', async (_event, input: StartChatStreamInput) => {
    const result = await (await ensureRunServiceClient()).startStream(input)
    activeChatStreamProviders.set(result.streamId, input.providerId)
    return result
  })
  ipcMain.handle('chat:stream:cancel', async (
    _event,
    streamId: string,
    cancellation?: ChatStreamCancellation,
  ) => {
    await (await ensureRunServiceClient()).cancelStream(streamId, cancellation ?? {
      policy: 'terminate',
      reason: 'user_stop',
      requestedAt: Date.now(),
      surface: 'desktop',
    })
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
  ipcMain.handle('terminal:createSession', async (_event, input: CreateTerminalSessionInput) => {
    const created = await (await ensureRunServiceClient()).terminalCreateSession({
      cols: input.cols,
      cwd: input.cwd,
      label: input.label,
      ownerKind: input.isAiSession ? 'ai' : 'visible',
      rows: input.rows,
      runId: input.aiTurnId,
      sessionKey: input.sessionKey,
      workspaceRootPath: input.workspaceRootPath,
    })
    return {
      bufferedOutput: created.bufferedOutput,
      brokerSessionId: created.brokerSessionId,
      cwd: created.cwd,
      isReused: created.isReused,
      processId: created.snapshot.processId,
      sessionId: created.legacySessionId,
      shell: created.shell.label,
      shellMetadata: created.shell,
      venvName: created.venvName,
      workspaceRootPath: created.workspaceRootPath,
    }
  })
  ipcMain.handle('terminal:attachSession', async (_event, input) =>
    (await ensureRunServiceClient()).terminalAttachSession(input),
  )
  ipcMain.handle('terminal:detachSession', async (_event, input) =>
    (await ensureRunServiceClient()).terminalDetachSession(input),
  )
  ipcMain.handle('terminal:getSession', async (_event, input) =>
    (await ensureRunServiceClient()).terminalGetSession(input),
  )
  ipcMain.handle('terminal:listSessions', async () =>
    (await ensureRunServiceClient()).terminalListSessions(),
  )
  ipcMain.handle('terminal:writeToSession', async (_event, input: WriteTerminalSessionInput) =>
    (await ensureRunServiceClient()).terminalWrite({
      data: input.data,
      legacySessionId: input.sessionId,
      workspaceRootPath: input.workspaceRootPath,
    }),
  )
  ipcMain.handle('terminal:resizeSession', async (_event, input: ResizeTerminalSessionInput) =>
    (await ensureRunServiceClient()).terminalResize({
      cols: input.cols,
      legacySessionId: input.sessionId,
      rows: input.rows,
      workspaceRootPath: input.workspaceRootPath,
    }),
  )
  ipcMain.handle('terminal:closeSession', async (_event, input: CloseTerminalSessionInput) => {
    await (await ensureRunServiceClient()).terminalTerminate({
      legacySessionId: input.sessionId,
      provenance: {
        policy: 'terminate',
        reason: 'user_stop',
        requestedAt: Date.now(),
        surface: 'desktop',
      },
      workspaceRootPath: input.workspaceRootPath,
    })
  })
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
