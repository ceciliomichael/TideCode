import type { ChatAttachment, ConversationRecord } from '../../src/types/chat'
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
    onCancelDraft: () => {
      state.pendingUndoEdit = undefined
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

  const runService = await ensureRunServiceClient()
  let applyingPendingUndoMutation = false
  let sharedRunAttachmentPromise: Promise<boolean> | null = null
  const attachToSharedRunIfIdle = (): Promise<boolean> | null => {
    if (state.isStreaming) return null
    if (sharedRunAttachmentPromise) return sharedRunAttachmentPromise
    sharedRunAttachmentPromise = attachCliToActiveSharedRun(state, screen)
      .catch((error) => {
        screen.addNotice('error', `Could not attach to the shared Tidecode run: ${error instanceof Error ? error.message : String(error)}`)
        return false
      })
      .finally(() => {
        sharedRunAttachmentPromise = null
      })
    return sharedRunAttachmentPromise
  }

  const applySharedConversationSnapshot = (conversation: ConversationRecord) => {
    state.messages = [...conversation.messages]
    state.chatMode = conversation.chatMode
    state.workspaceRootPath = conversation.agentContextRootPath
    if (!state.isStreaming && !applyingPendingUndoMutation) {
      state.activeStreamId = null
      screen.restoreConversation(conversation.messages, {
        mode: conversation.chatMode,
        model: state.modelId,
        provider: state.providerId,
        workspace: conversation.agentContextRootPath,
      }, true)
    }
  }

  runService.onEvent((event) => {
    if (
      (event.type === 'conversation_appended' || event.type === 'conversation_replaced' || event.type === 'conversation_updated')
      && event.conversationId === state.conversationId
    ) {
      applySharedConversationSnapshot(event.conversation)
      return
    }

    if (event.type !== 'run_state' || event.run.conversationId !== state.conversationId) return
    const isActive = event.run.status === 'starting'
      || event.run.status === 'running'
      || event.run.status === 'waiting_for_input'
    if (isActive) attachToSharedRunIfIdle()
  })

  if (options.openResumePicker) {
    await executeSlashCommand('/resume', state, helpers)
  } else {
    await (attachToSharedRunIfIdle() ?? Promise.resolve(false))
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
      // A slash command means the staged edit was abandoned. /undo itself can
      // immediately create a fresh staged edit again.
      state.pendingUndoEdit = undefined
      await executeSlashCommand(input, state, helpers)
      continue
    }

    try {
      let printUserMessage = isQueuedInput
      let userMessageLeadingSpacer: boolean | undefined
      const pendingUndoEdit = state.pendingUndoEdit
      if (pendingUndoEdit) {
        const targetUserIndex = state.messages.findIndex((message) => message.id === pendingUndoEdit.targetUserMessageId)
        if (targetUserIndex < 0) {
          state.pendingUndoEdit = undefined
          screen.restoreConversation(state.messages, {
            mode: state.chatMode,
            model: state.modelId,
            provider: state.providerId,
            workspace: state.workspaceRootPath,
          }, true)
          screen.setNextPromptDraft(input, attachments)
          screen.addNotice('warning', 'That turn changed before the edit was submitted. Nothing was reverted.')
          continue
        }

        applyingPendingUndoMutation = true
        try {
          const conversation = await runService.replaceMessages({
            chatMode: state.chatMode,
            conversationId: state.conversationId,
            messages: state.messages.slice(0, targetUserIndex),
            synchronizeCanonicalHistory: true,
          })
          state.messages = [...conversation.messages]
          state.pendingUndoEdit = undefined
          screen.restoreConversation(state.messages, {
            mode: state.chatMode,
            model: state.modelId,
            provider: state.providerId,
            workspace: state.workspaceRootPath,
          }, true)
          // ask() already printed the edited draft before returning it to this
          // loop. The history redraw above intentionally removes that stale
          // line, so print the submitted edit once as the new user turn. The
          // restored history already owns the spacer immediately above it.
          printUserMessage = true
          userMessageLeadingSpacer = false
        } finally {
          applyingPendingUndoMutation = false
        }
      }

      const result = await runReplTurn(
        input,
        state,
        screen,
        createPromptContext(state, screen, completions),
        { attachments, printUserMessage, userMessageLeadingSpacer },
      )
      queuedInputs.push(...result.queuedInputs.map((text) => ({ text })))
      pendingInput = result.nextInput
      refreshComposerStatus()
    } catch (error) {
      if (state.pendingUndoEdit) {
        // A failed staged-revert write must leave the original history intact
        // and return the edited text to the composer so the user can retry or
        // cancel it explicitly.
        screen.restoreConversation(state.messages, {
          mode: state.chatMode,
          model: state.modelId,
          provider: state.providerId,
          workspace: state.workspaceRootPath,
        }, true)
        screen.setNextPromptDraft(input, attachments)
      }
      screen.addNotice('error', `Could not save or start the turn: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
