import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChatMode } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import { compactApiKeyConversation } from '../chat/apiKey/runtime'
import { compactCodexConversation } from '../chat/codex/runtime'
import { startRemoteRelayDaemon } from './remoteDaemon'
import { getLatestUndoEditSelection } from './undoEditNavigation'
import type { CliSessionState, SlashCommandHelpers } from './types'
import type { TerminalScreen } from './terminalScreen'
import { resumeCliConversation } from './cliHistory'
import { persistCliReasoningEffort } from './cliReasoningEffortSettings'
import { shouldRefreshCodexUsage } from './cliComposerStatus'
import { attachCliToActiveSharedRun } from './sharedRunAttachment'
import { updateStoredConversationArchived } from '../history/store'

const execFileAsync = promisify(execFile)

export function createReplCommandHelpers(
  state: CliSessionState,
  screen: TerminalScreen,
  onRuntimeChanged?: (options?: { refreshCodexUsage?: boolean }) => void,
): SlashCommandHelpers {
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
    switchModel: async (modelId, providerId) => {
      const previousProviderId = state.providerId
      state.modelId = modelId
      if (providerId) state.providerId = providerId
      screen.updateSession({ model: state.modelId, provider: state.providerId })
      onRuntimeChanged?.({
        refreshCodexUsage: shouldRefreshCodexUsage(previousProviderId, state.providerId),
      })
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
      screen.addNotice('success', `${mode === 'plan' ? 'Plan' : 'Agent'} mode is active.`)
    },
    compactHistory: async () => {
      screen.addNotice('info', 'Compacting conversation history…')
      try {
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
        if (state.providerId === 'codex') await compactCodexConversation(input)
        else await compactApiKeyConversation(input)
        screen.addNotice('success', 'Conversation history compacted.')
      } catch (error) {
        screen.addNotice('error', `Compaction failed: ${error instanceof Error ? error.message : String(error)}`)
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
      screen.restoreConversation(state.messages, {
        mode: state.chatMode,
        model: state.modelId,
        provider: state.providerId,
        workspace: state.workspaceRootPath,
      }, true, { selectedUserMessageId: selection.targetUserMessageId })
      screen.setNextPromptDraft(selection.text, selection.attachments)
    },
    loadSession: async (conversationId: string) => {
      try {
        const record = await resumeCliConversation(state, conversationId)
        if (!record) return false
        screen.restoreConversation(record.messages, {
          mode: state.chatMode,
          model: state.modelId,
          provider: state.providerId,
          workspace: state.workspaceRootPath,
        }, true)
        onRuntimeChanged?.({ refreshCodexUsage: state.providerId === 'codex' })
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
