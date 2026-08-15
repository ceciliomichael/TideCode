import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChatMode } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import { compactApiKeyConversation } from '../chat/apiKey/runtime'
import { compactCodexConversation } from '../chat/codex/runtime'
import { startRemoteRelayDaemon } from './remoteDaemon'
import { replaceStoredMessages } from '../history/store'
import { isHumanUserMessage } from '../../src/lib/chatMessageMetadata'
import type { CliSessionState, SlashCommandHelpers } from './types'
import type { TerminalScreen } from './terminalScreen'
import { resumeCliConversation } from './cliHistory'
import { persistCliReasoningEffort } from './cliReasoningEffortSettings'
import { shouldRefreshCodexUsage } from './cliComposerStatus'

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
      screen.addNotice('success', `Now using ${state.modelId} (${state.providerId}).`)
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
      const lastUserIndex = state.messages.map((message) => isHumanUserMessage(message)).lastIndexOf(true)
      if (lastUserIndex < 0) {
        screen.addNotice('warning', 'There is no previous turn to remove.')
        return
      }
      state.messages = state.messages.slice(0, lastUserIndex)
      const conversation = await replaceStoredMessages({
        chatMode: state.chatMode,
        conversationId: state.conversationId,
        messages: state.messages,
        synchronizeCanonicalHistory: true,
      })
      state.messages = [...conversation.messages]
      screen.removeLastTurn()
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
        return true
      } catch {
        return false
      }
    },
    clearSession: async () => {
      state.conversationId = randomUUID()
      state.messages = []
      screen.clearSession()
    },
    startRemoteDaemon: async () => {
      await startRemoteRelayDaemon(state)
    },
    select: (options) => screen.select(options),
    checklist: (options) => screen.checklist(options),
    confirm: (question, defaultYes) => screen.confirm(question, defaultYes),
    exit: () => {
      screen.stop()
      process.exit(0)
    },
  }

  return helpers
}
