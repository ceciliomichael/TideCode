import type { ChatAttachment, ChatCompactionLifecycleState, ConversationRecord } from '../../src/types/chat'
import { reduceChatCompactionStatus } from '../../src/lib/chatCompactionStatus'
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
import { navigateUndoEditSelection } from './undoEditNavigation'
import { resolveCliUndoCheckpointPlan, runWithCliUndoWorkspaceReverted } from './cliUndoCheckpoints'
import { getStoredConversation } from '../history/store'
import { applyCliConversationRuntime } from './cliConversationRuntime'
import { listCompactionMarkers } from '../chat/history/eventStore'
import { hasMinimumCompactionMessages } from '../../src/lib/chatCompactionGate'

function createPromptContext(
  state: CliSessionState,
  screen: TerminalScreen,
  completions: TerminalCompletionCatalog,
  onToggleMode: (mode: CliSessionState['chatMode']) => void,
): TerminalPromptContext {
  return {
    mode: state.chatMode,
    modelId: state.modelId,
    providerId: state.providerId,
    enterFollowUpBehavior: state.followUpBehavior ?? 'steer',
    getCompletionItems: (text, cursorIndex) => completions.getItems(text, cursorIndex, state),
    onToggleMode,
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
    onNavigateUndoEdit: (direction) => {
      const pendingUndoEdit = state.pendingUndoEdit
      if (!pendingUndoEdit) return undefined
      const selection = navigateUndoEditSelection(
        state.messages,
        pendingUndoEdit.targetUserMessageId,
        direction,
      )
      if (!selection) return null
      state.pendingUndoEdit = { targetUserMessageId: selection.targetUserMessageId }
      return {
        text: selection.text,
        attachments: selection.attachments,
        targetUserMessageId: selection.targetUserMessageId,
      }
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
  const createCurrentPromptContext = () => createPromptContext(
    state,
    screen,
    completions,
    (mode) => helpers.switchMode(mode),
  )
  let pendingInput: Promise<TerminalPromptSubmission> | null = null
  const queuedInputs: Array<{ text: string; attachments?: ChatAttachment[] }> = []

  warmSystemClipboardReader()
  screen.start()
  const initialCompactionMarkers = await listCompactionMarkers(state.conversationId).catch(() => [])
  state.compactionLocked = !hasMinimumCompactionMessages(state.messages, initialCompactionMarkers)
  screen.restoreConversation(state.messages, {}, false, { compactionMarkers: initialCompactionMarkers })
  screen.updateComposerStatus({ reasoningEffort: state.reasoningEffort })

  const runService = await ensureRunServiceClient()
  let compactionState: ChatCompactionLifecycleState | null = null
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
      if (
        state.pendingUndoEdit &&
        !conversation.messages.some((message) => message.id === state.pendingUndoEdit?.targetUserMessageId)
      ) {
        state.pendingUndoEdit = undefined
      }
      screen.restoreConversation(conversation.messages, {
        mode: conversation.chatMode,
        model: state.modelId,
        provider: state.providerId,
        workspace: conversation.agentContextRootPath,
      }, true)
    }
  }

  runService.onEvent((event) => {
    if (event.type === 'compaction_event' && event.conversationId === state.conversationId) {
      compactionState = reduceChatCompactionStatus(compactionState, event.event, state.conversationId)
      if (event.event.type === 'compaction_started' || event.event.type === 'compaction_committed') {
        state.compactionLocked = true
        screen.refreshPromptCompletions()
      }
      screen.setCompactionState(compactionState)
      if (event.event.type === 'compaction_committed') {
        void listCompactionMarkers(state.conversationId)
          .then((compactionMarkers) => {
            if (event.conversationId !== state.conversationId) return
            compactionState = null
            state.compactionLocked = !hasMinimumCompactionMessages(state.messages, compactionMarkers)
            screen.setCompactionState(null)
            screen.refreshPromptCompletions()
            screen.restoreConversation(state.messages, {
              mode: state.chatMode,
              model: state.modelId,
              provider: state.providerId,
              workspace: state.workspaceRootPath,
            }, true, { compactionMarkers })
          })
          .catch((error) => {
            screen.addNotice('error', `Could not load compacted history marker: ${error instanceof Error ? error.message : String(error)}`)
          })
      } else if (event.event.type === 'compaction_failed') {
        void listCompactionMarkers(state.conversationId)
          .then((compactionMarkers) => {
            if (event.conversationId !== state.conversationId) return
            state.compactionLocked = !hasMinimumCompactionMessages(state.messages, compactionMarkers)
            screen.refreshPromptCompletions()
          })
          .catch(() => undefined)
      }
      return
    }

    if (event.type === 'conversation_runtime_updated' && event.conversationId === state.conversationId) {
      void applyCliConversationRuntime(state, screen, event.runtime)
        .then((change) => refreshComposerStatus(change.refreshCodexUsage))
        .catch((error) => {
          screen.addNotice('error', `Could not apply shared conversation settings: ${error instanceof Error ? error.message : String(error)}`)
        })
      return
    }

    if (
      (event.type === 'conversation_appended' || event.type === 'conversation_replaced' || event.type === 'conversation_updated')
      && event.conversationId === state.conversationId
    ) {
      applySharedConversationSnapshot(event.conversation)
      void listCompactionMarkers(event.conversationId)
        .then((compactionMarkers) => {
          if (event.conversationId !== state.conversationId) return
          state.compactionLocked = !hasMinimumCompactionMessages(state.messages, compactionMarkers)
          screen.refreshPromptCompletions()
        })
        .catch(() => undefined)
      return
    }

    if (event.type !== 'run_state' || event.run.conversationId !== state.conversationId) return
    const isActive = event.run.status === 'starting'
      || event.run.status === 'running'
      || event.run.status === 'waiting_for_input'
    if (isActive) attachToSharedRunIfIdle()
  })

  const [initialRuntime, initialCompactionState] = await Promise.all([
    runService.getConversationRuntime(state.conversationId).catch(() => null),
    runService.getCompactionState(state.conversationId).catch(() => null),
  ])
  if (initialRuntime) {
    const runtimeChange = await applyCliConversationRuntime(state, screen, initialRuntime)
    refreshComposerStatus(runtimeChange.refreshCodexUsage)
  }
  const initialCompactionIsPersisted = initialCompactionState?.phase === 'compacted' &&
    initialCompactionMarkers.some((marker) => marker.compactionId === initialCompactionState.compactionId)
  compactionState = initialCompactionIsPersisted ? null : initialCompactionState
  screen.setCompactionState(compactionState)

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
      const promptContext = createCurrentPromptContext()
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
      // A slash command means the staged edit was abandoned. Restore the
      // authoritative transcript before running the command; /undo itself can
      // immediately create a fresh staged preview again.
      if (state.pendingUndoEdit) {
        state.pendingUndoEdit = undefined
        screen.restoreConversation(state.messages, {
          mode: state.chatMode,
          model: state.modelId,
          provider: state.providerId,
          workspace: state.workspaceRootPath,
        }, true, { selectedUserMessageId: null })
      }
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
          const storedConversation = await getStoredConversation(state.conversationId)
          if (!storedConversation) {
            throw new Error(`Conversation not found: ${state.conversationId}`)
          }

          const undoPlan = await resolveCliUndoCheckpointPlan(
            state.conversationId,
            storedConversation.messages,
            pendingUndoEdit.targetUserMessageId,
          )
          const conversation = await runWithCliUndoWorkspaceReverted(
            undoPlan,
            () => runService.replaceMessages({
              chatMode: state.chatMode,
              conversationId: state.conversationId,
              messages: storedConversation.messages.slice(0, undoPlan.targetUserIndex),
              synchronizeCanonicalHistory: true,
            }),
          )

          state.messages = [...conversation.messages]
          state.compactionLocked = !hasMinimumCompactionMessages(
            state.messages,
            await listCompactionMarkers(state.conversationId).catch(() => []),
          )
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
        createCurrentPromptContext(),
        { attachments, printUserMessage, userMessageLeadingSpacer },
      )
      queuedInputs.push(...result.queuedInputs.map((text) => ({ text })))
      pendingInput = result.nextInput
      refreshComposerStatus()
    } catch (error) {
      if (state.pendingUndoEdit) {
        // A failed staged-revert write keeps the authoritative transcript
        // visible and leaves the selected edit marker in place so the user can
        // retry the edit or exit it explicitly.
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
