import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChatMode } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import { ensureRunServiceClient } from '../runService/ensureService'
import { startRemoteRelayDaemon } from './remoteDaemon'
import { getLatestUndoEditSelection } from './undoEditNavigation'
import type { CliSessionState, SlashCommandHelpers } from './types'
import type { TerminalScreen } from './terminalScreen'
import { resumeCliConversation } from './cliHistory'
import { persistCliReasoningEffort } from './cliReasoningEffortSettings'
import { shouldRefreshCodexUsage } from './cliComposerStatus'
import { attachCliToActiveSharedRun } from './sharedRunAttachment'
import { updateStoredConversationArchived } from '../history/store'
import { applyCliConversationRuntime } from './cliConversationRuntime'
import { listCompactionMarkers } from '../chat/history/eventStore'
import { hasMinimumCompactionMessages, MIN_COMPACTION_MESSAGE_COUNT } from '../../src/lib/chatCompactionGate'
import { getTideCodeSystemModels } from './models'

const execFileAsync = promisify(execFile)

export function createReplCommandHelpers(
  state: CliSessionState,
  screen: TerminalScreen,
  onRuntimeChanged?: (options?: { refreshCodexUsage?: boolean }) => void,
  getSystemModels: typeof getTideCodeSystemModels = getTideCodeSystemModels,
): SlashCommandHelpers {
  const resetFreshSessionModel = async () => {
    const previousProviderId = state.providerId
    const snapshot = await getSystemModels(state.chatMode)
    state.modelId = snapshot.defaultModelId
    state.providerId = snapshot.defaultProviderId
    state.reasoningEffort = snapshot.selectedReasoningEffort
    screen.updateSession({ mode: state.chatMode, model: state.modelId, provider: state.providerId })
    screen.updateComposerStatus({ reasoningEffort: state.reasoningEffort })
    onRuntimeChanged?.({
      refreshCodexUsage: shouldRefreshCodexUsage(previousProviderId, state.providerId),
    })
  }

  const helpers: SlashCommandHelpers = {
    renderInfo: (message) => screen.addNotice('info', message),
    renderSuccess: (message) => screen.addNotice('success', message),
    renderWarning: (message) => screen.addNotice('warning', message),
    renderError: (message) => screen.addNotice('error', message),
    renderDiff: async () => {
      try {
        const { stdout } = await execFileAsync('git', ['diff'], { cwd: state.workspaceRootPath })
        screen.addDiff(stdout)
      } catch {
        screen.addNotice('warning', 'Could not read the workspace Git diff.')
      }
    },
    switchModel: async (modelId, providerId, metadata) => {
      const previousProviderId = state.providerId
      state.modelId = modelId
      if (providerId) state.providerId = providerId
      screen.updateSession({ model: state.modelId, provider: state.providerId })
      onRuntimeChanged?.({
        refreshCodexUsage: shouldRefreshCodexUsage(previousProviderId, state.providerId),
      })

      try {
        await (await ensureRunServiceClient()).updateConversationRuntime({
          chatMode: state.chatMode,
          conversationId: state.conversationId,
          model: {
            label: metadata?.label ?? modelId,
            modelId: metadata?.preferenceModelId ?? modelId,
            providerId: state.providerId,
            reasoningEffort: state.reasoningEffort,
            runtimeModelId: modelId,
          },
        })
      } catch (error) {
        screen.addNotice('error', `Could not sync the selected model with Desktop: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    switchReasoningEffort: async (effort, modelLabel) => {
      await persistCliReasoningEffort(state, effort, modelLabel)
      screen.updateComposerStatus({ reasoningEffort: effort })
      onRuntimeChanged?.()
      screen.addNotice('success', `${modelLabel} reasoning effort is now ${effort}.`)
    },
    switchMode: (mode: ChatMode) => {
      state.chatMode = mode
      screen.updateSession({ mode })
      onRuntimeChanged?.()
      void ensureRunServiceClient()
        .then((runService) => runService.updateConversationRuntime({
          chatMode: mode,
          conversationId: state.conversationId,
        }))
        .catch((error) => {
          screen.addNotice('error', `Could not sync the chat mode with Desktop: ${error instanceof Error ? error.message : String(error)}`)
        })
    },
    canCompactHistory: async () => {
      try {
        const markers = await listCompactionMarkers(state.conversationId)
        state.compactionLocked = !hasMinimumCompactionMessages(state.messages, markers)
        screen.refreshPromptCompletions()
        if (state.compactionLocked) {
          screen.addNotice('warning', `At least ${MIN_COMPACTION_MESSAGE_COUNT} conversation messages are required since the latest compaction boundary before compacting.`)
          return false
        }
        return true
      } catch (error) {
        screen.addNotice('error', `Could not check compaction history: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    },
    compactHistory: async () => {
      const input = {
        agentContextRootPath: state.workspaceRootPath,
        chatMode: state.chatMode,
        contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
        conversationId: state.conversationId,
        messages: state.messages,
        modelId: state.modelId,
        providerId: state.providerId,
        reasoningEffort: state.reasoningEffort,
        terminalExecutionMode: state.terminalExecutionMode,
      }
      try {
        const runService = await ensureRunServiceClient()
        void runService.compactConversation(input).catch((error) => {
          screen.addNotice('error', `Compaction failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      } catch (error) {
        screen.addNotice('error', `Could not start compaction: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    undoLastTurn: async () => {
      const selection = getLatestUndoEditSelection(state.messages)
      if (!selection) {
        screen.addNotice('warning', 'There is no previous turn to edit.')
        return
      }

      // /undo is a staged edit, not an immediate history mutation. Keep the
      // complete transcript visible while marking the selected historical user
      // turn. Up/Down moves that marker and the editable composer draft; Esc
      // exits edit mode without changing history or workspace checkpoints.
      state.pendingUndoEdit = { targetUserMessageId: selection.targetUserMessageId }
      // Seed the editable draft before computing the history viewport so a
      // multiline historical prompt reserves its full sticky-composer height.
      screen.setNextPromptDraft(selection.text, selection.attachments)
      screen.restoreConversation(state.messages, {
        mode: state.chatMode,
        model: state.modelId,
        provider: state.providerId,
        workspace: state.workspaceRootPath,
      }, true, { selectedUserMessageId: selection.targetUserMessageId })
    },
    loadSession: async (conversationId: string) => {
      try {
        const record = await resumeCliConversation(state, conversationId)
        if (!record) return false
        const compactionMarkers = await listCompactionMarkers(record.id)
        state.compactionLocked = !hasMinimumCompactionMessages(record.messages, compactionMarkers)
        screen.restoreConversation(record.messages, {
          mode: state.chatMode,
          model: state.modelId,
          provider: state.providerId,
          workspace: state.workspaceRootPath,
        }, true, { compactionMarkers })
        const runService = await ensureRunServiceClient()
        const runtime = await runService.getConversationRuntime(state.conversationId)
        if (runtime) {
          const runtimeChange = await applyCliConversationRuntime(state, screen, runtime)
          onRuntimeChanged?.(runtimeChange)
        } else {
          onRuntimeChanged?.({ refreshCodexUsage: state.providerId === 'codex' })
        }
        const liveCompaction = await runService.getCompactionState(state.conversationId)
        const liveCompactionIsPersisted = liveCompaction?.phase === 'compacted' &&
          compactionMarkers.some((marker) => marker.compactionId === liveCompaction.compactionId)
        screen.setCompactionState(liveCompactionIsPersisted ? null : liveCompaction)
        await attachCliToActiveSharedRun(state, screen)
        return true
      } catch {
        return false
      }
    },
    setConversationArchived: async (conversationId: string, isArchived: boolean) => {
      if (isArchived && conversationId === state.conversationId && state.isStreaming) {
        screen.addNotice('warning', 'Wait for the current turn to finish before archiving this chat.')
        return false
      }

      try {
        await updateStoredConversationArchived(conversationId, isArchived)
        if (isArchived && conversationId === state.conversationId) {
          state.conversationId = randomUUID()
          state.messages = []
          state.pendingUndoEdit = undefined
          state.compactionLocked = true
          await resetFreshSessionModel()
          screen.clearSession()
        }
        return true
      } catch (error) {
        screen.addNotice('error', `Could not ${isArchived ? 'archive' : 'unarchive'} this chat: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    },
    clearSession: async () => {
      state.conversationId = randomUUID()
      state.messages = []
      state.pendingUndoEdit = undefined
      state.compactionLocked = true
      await resetFreshSessionModel()
      screen.clearSession()
    },
    startRemoteDaemon: async () => {
      await startRemoteRelayDaemon(state)
    },
    select: (options) => screen.select(options),
    input: (options) => screen.input(options),
    selectResume: (items, workspacePath, projectLabel, page) => screen.selectResume(items, workspacePath, projectLabel, page),
    checklist: (options) => screen.checklist(options),
    confirm: (question, defaultYes) => screen.confirm(question, defaultYes),
    exit: () => {
      screen.stop()
      process.exit(0)
    },
  }

  return helpers
}
