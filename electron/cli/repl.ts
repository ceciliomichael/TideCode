import type { ChatAttachment } from '../../src/types/chat'
import { ensureRunServiceClient } from '../runService/ensureService'
import { executeSlashCommand } from './commands'
import { createReplCommandHelpers } from './replCommands'
import { runReplTurn } from './replTurn'
import { TerminalCompletionCatalog } from './terminalCompletions'
import { TerminalScreen, type TerminalPromptContext, type TerminalPromptSubmission } from './terminalScreen'
import type { CliSessionState } from './types'
import { refreshCliComposerStatus } from './cliComposerStatus'
import { getStoredSettings } from '../settings/store'
import { warmSystemClipboardReader } from './cliClipboardImage'
import { TIDECODE_VERSION } from '../appVersion'
import { attachCliToActiveSharedRun } from './sharedRunAttachment'

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
      void ensureRunServiceClient()
        .then((client) => client.cancelStream(streamId))
        .catch((error) => {
          screen.addNotice('error', `Could not stop the turn: ${error instanceof Error ? error.message : String(error)}`)
        })
    },
  }
}

export async function startInteractiveRepl(
  state: CliSessionState,
  options: { openResumePicker?: boolean } = {},
): Promise<void> {
  const screen = new TerminalScreen({
    workspace: state.workspaceRootPath,
    model: state.modelId,
    provider: state.providerId,
    mode: state.chatMode,
    version: TIDECODE_VERSION,
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
  let pendingInput: Promise<TerminalPromptSubmission> | null = null
  const queuedInputs: Array<{ text: string; attachments?: ChatAttachment[] }> = []

  warmSystemClipboardReader()
  screen.start()
  screen.restoreConversation(state.messages)
  screen.updateComposerStatus({ reasoningEffort: state.reasoningEffort })
  if (options.openResumePicker) {
    await executeSlashCommand('/resume', state, helpers)
  } else {
    await attachCliToActiveSharedRun(state, screen)
  }
  let startupPreparationStarted = false

  for (;;) {
    const isQueuedInput = queuedInputs.length > 0
    if (isQueuedInput) screen.dismissPrompt()

    let rawSubmission: TerminalPromptSubmission
    if (isQueuedInput) {
      const queuedSubmission = queuedInputs.shift() ?? { text: '' }
      rawSubmission = {
        text: queuedSubmission.text,
        attachments: queuedSubmission.attachments ?? [],
      }
    } else if (pendingInput) {
      rawSubmission = await pendingInput
    } else {
      const promptContext = createPromptContext(state, screen, completions)
      const prompt = screen.ask(promptContext)
      pendingInput = prompt

      if (!startupPreparationStarted) {
        startupPreparationStarted = true
        refreshComposerStatus(true)
        void completions.preloadWorkspace(state.workspaceRootPath)
      }

      // Arm the prompt before refreshing settings. The settings read is
      // intentionally background work so startup keystrokes cannot be
      // consumed while the terminal is already showing the composer.
      void getStoredSettings()
        .then((latestSettings) => {
          state.followUpBehavior = latestSettings.followUpBehavior
          promptContext.enterFollowUpBehavior = latestSettings.followUpBehavior
        })
        .catch(() => undefined)

      rawSubmission = await prompt
    }
    pendingInput = null
    const input = rawSubmission.text.trim()
    const attachments = rawSubmission.attachments ?? []
    if (!input && attachments.length === 0) continue

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
        { attachments, printUserMessage: isQueuedInput },
      )
      queuedInputs.push(...result.queuedInputs.map((text) => ({ text })))
      pendingInput = result.nextInput
      refreshComposerStatus()
    } catch (error) {
      screen.addNotice('error', `Could not save or start the turn: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
