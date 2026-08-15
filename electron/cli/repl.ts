import { cancelApiKeyChatStream } from '../chat/apiKey/runtime'
import { cancelCodexChatStream } from '../chat/codex/runtime'
import { executeSlashCommand } from './commands'
import { createReplCommandHelpers } from './replCommands'
import { runReplTurn } from './replTurn'
import { TerminalCompletionCatalog } from './terminalCompletions'
import { TerminalScreen, type TerminalPromptContext } from './terminalScreen'
import type { CliSessionState } from './types'
import { refreshCliComposerStatus } from './cliComposerStatus'
import { getStoredSettings } from '../settings/store'

function createPromptContext(
  state: CliSessionState,
  screen: TerminalScreen,
  completions: TerminalCompletionCatalog,
): TerminalPromptContext {
  return {
    mode: state.chatMode,
    modelId: state.modelId,
    providerId: state.providerId,
    enterFollowUpBehavior: state.followUpBehavior ?? 'steer',
    getCompletionItems: (text, cursorIndex) => completions.getItems(text, cursorIndex),
    onToggleMode: (mode) => {
      state.chatMode = mode
      screen.updateSession({ mode })
    },
    onCancelTurn: () => {
      const streamId = state.activeStreamId
      if (!streamId) return
      screen.setActivity('thinking', 'Stopping')
      const cancellation = state.providerId === 'codex'
        ? cancelCodexChatStream(streamId)
        : cancelApiKeyChatStream(streamId)
      void cancellation.catch((error) => {
        screen.addNotice('error', `Could not stop the turn: ${error instanceof Error ? error.message : String(error)}`)
      })
    },
  }
}

export async function startInteractiveRepl(state: CliSessionState): Promise<void> {
  const screen = new TerminalScreen({
    workspace: state.workspaceRootPath,
    model: state.modelId,
    provider: state.providerId,
    mode: state.chatMode,
    version: '1.1.11',
    permissions: state.terminalExecutionMode === 'full' ? 'full access' : 'sandboxed',
  })
  const completions = new TerminalCompletionCatalog()
  const refreshComposerStatus = (refreshCodexUsage = false) => {
    void refreshCliComposerStatus(state, screen, { refreshCodexUsage }).catch(() => undefined)
  }
  const helpers = createReplCommandHelpers(state, screen, (options) => {
    void completions.preloadWorkspace(state.workspaceRootPath)
    refreshComposerStatus(options?.refreshCodexUsage === true)
  })
  let pendingInput: Promise<string> | null = null
  const queuedInputs: string[] = []

  screen.start()
  screen.restoreConversation(state.messages)
  screen.updateComposerStatus({ reasoningEffort: state.reasoningEffort })
  refreshComposerStatus(true)
  void completions.preloadWorkspace(state.workspaceRootPath)

  for (;;) {
    const isQueuedInput = queuedInputs.length > 0
    if (isQueuedInput) screen.dismissPrompt()
    if (!isQueuedInput && !pendingInput) {
      const latestSettings = await getStoredSettings()
      state.followUpBehavior = latestSettings.followUpBehavior
    }
    const rawInput = isQueuedInput
      ? queuedInputs.shift() ?? ''
      : await (pendingInput ?? screen.ask(createPromptContext(state, screen, completions)))
    pendingInput = null
    const input = rawInput.trim()
    if (!input) continue

    if (input.startsWith('/')) {
      await executeSlashCommand(input, state, helpers)
      continue
    }

    try {
      const result = await runReplTurn(
        input,
        state,
        screen,
        createPromptContext(state, screen, completions),
        { printUserMessage: isQueuedInput },
      )
      queuedInputs.push(...result.queuedInputs)
      pendingInput = result.nextInput
      refreshComposerStatus()
    } catch (error) {
      screen.addNotice('error', `Could not save or start the turn: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
