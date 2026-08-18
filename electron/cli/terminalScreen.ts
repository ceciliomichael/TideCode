import { randomUUID } from 'node:crypto'
import readline from 'node:readline'
import type { ChatAttachment, ChatCompactionLifecycleState, ChatCompactionMarker, ChatMode } from '../../src/types/chat'
import {
  applyComposerAction,
  attachImagesToComposer,
  composerText,
  createComposerState,
  getComposerCursorIndex,
  getComposerCursorPosition,
  getComposerVisualLines,
  insertTextIntoComposer,
  recordComposerHistory,
  setComposerCursorIndex,
  setComposerText,
  type ComposerState,
} from './composer'
import {
  extractPastedImageFilePaths,
  formatCliImageReferenceInText,
  readCliImageAttachmentSync,
} from './cliImageAttachments'
import { readSystemClipboardImageOrText } from './cliClipboardImage'
import { interactiveConfirm, interactiveSelect, type SelectOptions } from './interactiveSelect'
import { interactiveChecklist, type ChecklistOptions } from './interactiveChecklist'
import { interactiveTextInput, type TextInputOptions } from './interactiveTextInput'
import { createActiveTurnPromptPanel, renderActiveTurn as renderActiveTurnView, renderCommittedTurn, renderConversationHistory } from './terminalActiveTurn'
import { ensureKeypressEvents, TerminalLifecycle } from './terminalLifecycle'
import { getTerminalInputAction, type TerminalInputAction } from './terminalInput'
import { colors, renderDiffLines, stripAnsi } from './renderer'
import { StreamingTerminalMarkdown } from './terminalMarkdown'
import { getTerminalPanelWidth, renderPromptPanel, renderSessionPanel } from './terminalPanels'
import { clearTerminalRegion, updateTerminalRegion } from './terminalRedraw'
import { processTerminalOutput, type TerminalOutput } from './terminalOutput'
import {
  getThinkingSpinnerFrame,
  getThinkingStatusMessage,
  TerminalThinkingIndicator,
  THINKING_SPINNER_FRAMES,
  THINKING_SPINNER_INTERVAL_MS,
  THINKING_STATUS_MESSAGES,
  THINKING_STATUS_ROTATION_INTERVAL_MS,
} from './thinkingIndicator'
import type { ActiveTurnFollowUpView, CompletionItemView, TerminalScreenViewState } from './terminalView'
import { createTerminalScreenView, nextTranscriptId, type TerminalSessionView } from './terminalView'
import type { Message } from '../../src/types/chat'
import { createTerminalHistoryEntries } from './terminalHistory'
import { renderTerminalToolRowText } from './terminalToolRow'
import { renderTerminalActivityLine } from './terminalActivity'
import { TerminalOutputBuffer } from './terminalOutputBuffer'
import { getFollowUpKeyHint, resolveFollowUpKeyBehavior } from './terminalFollowUpKeys'
import type { FollowUpBehavior } from '../../src/lib/appSettings'
import { renderTerminalComposerStatus } from './terminalComposerStatus'
import type { ReasoningEffort } from '../../src/types/chat'
import { BracketedPasteDecoder } from './terminalBracketedPaste'
import { interactiveResumeSelect, type ResumeSelectionResult } from './interactiveResumeSelect'
import type { ResumeConversationItem } from './resumeCatalog'
import type { ResumePage } from './terminalResumeView'
import { formatThoughtDuration } from './terminalDuration'
import {
  buildChatMentionPathMap,
  collapseChatMentionMarkup,
  expandChatMentions,
  findChatMentionMatches,
  getChatMentionAtPosition,
  getChatMentionBeforePosition,
} from '../../src/lib/chatMentions'
import type { InteractiveResizeHost } from './interactiveResize'

let activeTerminalScreen: TerminalScreen | null = null
const CLEAR_TERMINAL_SEQUENCE = '\x1b[2J\x1b[3J\x1b[H'
const RESIZE_FRAME_INTERVAL_MS = 16
const TERMINAL_SIZE_POLL_INTERVAL_MS = 32

export function getActiveTerminalScreen(): TerminalScreen | null {
  return activeTerminalScreen
}

function setActiveTerminalScreen(screen: TerminalScreen | null): void {
  activeTerminalScreen = screen
}

export interface TerminalPromptContext {
  mode: ChatMode
  modelId: string
  providerId: string
  onToggleMode?: (newMode: ChatMode) => void
  onCancelTurn?: () => void
  onCancelDraft?: () => void
  onNavigateUndoEdit?: (
    direction: 'older' | 'newer',
  ) => {
    text: string
    attachments: readonly ChatAttachment[]
    targetUserMessageId: string
  } | null | undefined
  onActiveMessage?: (text: string, behavior: ActiveTurnFollowUpView['behavior']) => void
  enterFollowUpBehavior?: FollowUpBehavior
  getCompletionItems?: (text: string, cursorIndex: number) => readonly CompletionItemView[]
}

export interface TerminalScreenEventPresentation {
  onWaiting: (label: string) => void
  onReasoningDelta: (delta: string) => void
  onReasoningCompleted: (durationSeconds: number) => void
  onContentStart: () => void
  onContentDelta: (delta: string) => void
  onToolStarted: (label: string) => void
  onToolCompleted: (label: string, detail?: string, diff?: string) => void
  onToolFailed: (label: string, detail?: string) => void
  onCompleted: () => void
}

export interface TerminalPromptSubmission {
  text: string
  attachments: ChatAttachment[]
}

interface PendingPrompt {
  context: TerminalPromptContext
  resolve: (value: TerminalPromptSubmission) => void
}

export class TerminalScreen {
  private readonly lifecycle = new TerminalLifecycle()
  private readonly history: string[] = []
  private readonly thinkingIndicator = new TerminalThinkingIndicator()
  private readonly markdown = new StreamingTerminalMarkdown()
  private readonly output: TerminalOutput
  private view: TerminalScreenViewState
  private composer: ComposerState = createComposerState()
  private readonly mentionPathMap = new Map<string, string>()
  private pendingPrompt: PendingPrompt | null = null
  private selectedHistoryUserMessageId: string | null = null
  private renderedPromptRows = 0
  private renderedPromptLines: string[] = []
  private renderedPromptCursorRow = 0
  private compactionState: ChatCompactionLifecycleState | null = null
  private compactionMarkers: ChatCompactionMarker[] = []
  private compactionFrameIndex = 0
  private compactionTimer: NodeJS.Timeout | null = null
  private activeAssistantId: string | null = null
  private activeThought = ''
  private activeThoughtEntryId: string | null = null
  private activeTurnCancel: (() => void) | null = null
  private activeThoughtDurationSeconds = 0
  private activityLabel = ''
  private hasTurnOutput = false
  private activeTurn = false
  private activeTurnStartIndex = 0
  private activeTurnLines: string[] = []
  private activeTurnCursorRow = 0
  private activeTurnCursorColumn = 0
  private activeTurnActivityRow: number | null = null
  private activeTurnLeadingSpacer = true
  private activeThinkingFrameIndex = 0
  private activeThinkingMessageIndex = 0
  private activeThinkingMessageStartedAt = 0
  private activeThinkingTimer: NodeJS.Timeout | null = null
  private activeFollowUps: ActiveTurnFollowUpView[] = []
  private nextPromptDraft: { text: string; attachments: ChatAttachment[] } | null = null
  private readonly bracketedPasteDecoder = new BracketedPasteDecoder()
  private suppressKeypressEvents = false
  private keypressSuppressionHandle: NodeJS.Immediate | null = null
  private resizeRedrawTimer: NodeJS.Timeout | null = null
  private terminalSizePollTimer: NodeJS.Timeout | null = null
  private resizeRedrawPending = false
  private interactiveResizeHandler: (() => void) | null = null
  private lastTerminalSize: { columns: number; rows: number } | null = null
  private readonly interactiveResizeHost: InteractiveResizeHost = {
    registerResizeHandler: (handler) => {
      this.interactiveResizeHandler = handler
    },
    redrawBackground: () => this.redrawAfterResize(),
  }
  private composerStatus: { contextPercent: number; codexUsage?: string; reasoningEffort: ReasoningEffort } = {
    contextPercent: 0,
    reasoningEffort: 'medium',
  }
  private readonly usesProcessOutput: boolean

  constructor(session: TerminalSessionView, options: { output?: TerminalOutput } = {}) {
    this.view = createTerminalScreenView(session)
    this.output = options.output ?? processTerminalOutput
    this.usesProcessOutput = options.output === undefined
  }

  start(): void {
    if (this.lifecycle.active) return
    this.lifecycle.start()
    setActiveTerminalScreen(this)
    if (this.usesProcessOutput) {
      if (process.stdout.isTTY) process.stdout.on('resize', this.handleResize)
      this.lastTerminalSize = this.readTerminalSize()
      this.terminalSizePollTimer = setInterval(this.checkTerminalSize, TERMINAL_SIZE_POLL_INTERVAL_MS)
      this.terminalSizePollTimer.unref()
    }
    this.output.write(CLEAR_TERMINAL_SEQUENCE)
    this.printSessionIntro()
  }

  stop(): void {
    if (this.resizeRedrawTimer) {
      clearTimeout(this.resizeRedrawTimer)
      this.resizeRedrawTimer = null
    }
    if (this.terminalSizePollTimer) {
      clearInterval(this.terminalSizePollTimer)
      this.terminalSizePollTimer = null
    }
    this.stopCompactionSpinner()
    this.resizeRedrawPending = false
    this.interactiveResizeHandler = null
    this.lastTerminalSize = null
    this.activeTurnCancel = null
    process.stdin.removeListener('keypress', this.handleKeypress)
    this.lifecycle.disableRawInput()
    this.resetBracketedPasteInput()
    if (this.usesProcessOutput) process.stdout.removeListener('resize', this.handleResize)
    this.clearPromptDisplay()
    this.clearActiveTurnDisplay()
    this.stopActivity()
    this.lifecycle.stop()
    if (activeTerminalScreen === this) setActiveTerminalScreen(null)
  }

  updateSession(patch: Partial<TerminalSessionView>): void {
    this.view.session = { ...this.view.session, ...patch }
    if (patch.provider && patch.provider !== 'codex') {
      this.composerStatus = { ...this.composerStatus, codexUsage: undefined }
    }
    if (this.pendingPrompt) this.renderCurrentPrompt()
  }

  updateComposerStatus(patch: Partial<typeof this.composerStatus>): void {
    this.composerStatus = { ...this.composerStatus, ...patch }
    if (this.pendingPrompt) this.renderCurrentPrompt()
  }

  setCompactionState(state: ChatCompactionLifecycleState | null): void {
    const isSameState = this.compactionState?.phase === state?.phase
      && this.compactionState?.attemptId === state?.attemptId
      && this.compactionState?.streamId === state?.streamId
      && (this.compactionState?.phase !== 'compacted'
        || state?.phase !== 'compacted'
        || this.compactionState.compactionId === state.compactionId)
    if (isSameState) return

    this.compactionState = state
    this.stopCompactionSpinner()
    if (state?.phase === 'compacting') {
      this.compactionFrameIndex = 0
      this.compactionTimer = setInterval(() => {
        this.compactionFrameIndex = (this.compactionFrameIndex + 1) % THINKING_SPINNER_FRAMES.length
        if (this.pendingPrompt && !this.activeTurn) this.renderPrompt()
      }, THINKING_SPINNER_INTERVAL_MS)
      this.compactionTimer.unref()
    }
    if (this.pendingPrompt && !this.activeTurn) this.renderPrompt()
  }

  clearSession(): void {
    this.activeTurnCancel = null
    this.activeTurnLeadingSpacer = true
    this.compactionState = null
    this.compactionMarkers = []
    this.stopCompactionSpinner()
    this.clearPromptDisplay()
    this.clearActiveTurnDisplay()
    this.stopActivity()
    this.output.write(CLEAR_TERMINAL_SEQUENCE)
    this.view.entries = []
    this.selectedHistoryUserMessageId = null
    this.view.activity = { kind: 'idle', label: '' }
    this.view.notification = null
    this.activeAssistantId = null
    this.activeThought = ''
    this.activeThoughtEntryId = null
    this.activeThoughtDurationSeconds = 0
    this.activityLabel = ''
    this.hasTurnOutput = false
    this.activeFollowUps = []
    this.printSessionIntro()
  }

  restoreConversation(
    messages: readonly Message[],
    sessionPatch: Partial<TerminalSessionView> = {},
    clearScreen = false,
    options: {
      compactionMarkers?: readonly ChatCompactionMarker[]
      selectedUserMessageId?: string | null
    } = {},
  ): void {
    this.activeTurnCancel = null
    this.clearPromptDisplay()
    this.clearActiveTurnDisplay()
    this.stopActivity()
    this.view.session = { ...this.view.session, ...sessionPatch }
    if (options.compactionMarkers) this.compactionMarkers = [...options.compactionMarkers]
    this.view.entries = createTerminalHistoryEntries(messages, this.view.session.workspace, this.compactionMarkers)
    if ('selectedUserMessageId' in options) {
      this.selectedHistoryUserMessageId = options.selectedUserMessageId ?? null
    } else if (
      this.selectedHistoryUserMessageId &&
      !this.view.entries.some((entry) => entry.kind === 'user' && entry.id === this.selectedHistoryUserMessageId)
    ) {
      this.selectedHistoryUserMessageId = null
    }
    this.activeAssistantId = null
    this.activeThought = ''
    this.activeThoughtEntryId = null
    this.activeThoughtDurationSeconds = 0
    this.activeTurn = false
    this.activeTurnLeadingSpacer = true
    this.activeTurnStartIndex = 0
    this.activeFollowUps = []

    if (clearScreen) {
      this.output.write(CLEAR_TERMINAL_SEQUENCE)
      this.printSessionIntro()
    }
    const historyLines = renderConversationHistory(this.view.entries, {
      selectedUserMessageId: this.selectedHistoryUserMessageId,
      maxLines: this.getSelectedHistoryViewportMaxLines(),
    })
    if (historyLines.length > 0) this.output.write(`${historyLines.join('\n')}\n`)
    if (this.pendingPrompt) this.renderCurrentPrompt()
  }

  setNotification(level: 'info' | 'success' | 'warning' | 'error', text: string): void {
    this.view.notification = { level, text: stripAnsi(text) }
  }

  addUserMessage(
    text: string,
    print = true,
    options: { leadingSpacer?: boolean } = {},
  ): void {
    this.view.entries.push({ kind: 'user', id: nextTranscriptId('user'), text })
    if (print) {
      const leadingSpacer = options.leadingSpacer === false ? '' : '\n'
      this.output.write(`${leadingSpacer}${colors.accent}›${colors.reset} ${formatCliImageReferenceInText(text)}\n`)
    }
  }

  beginTurn(
    onCancelTurn?: () => void,
    options: { leadingSpacer?: boolean } = {},
  ): void {
    // A shared run can begin while the REPL is already waiting on an idle
    // composer. Remove that rendered frame before the active-turn frame takes
    // ownership of the same terminal rows; the pending prompt itself remains
    // alive so it can become the steer/queue composer for the run.
    this.clearPromptDisplay()
    this.activeTurn = true
    this.activeTurnLeadingSpacer = options.leadingSpacer !== false
    this.activeTurnCancel = onCancelTurn ?? null
    this.activeTurnStartIndex = this.view.entries.length
    this.activeTurnLines = []
    this.activeTurnCursorRow = 0
    this.activeTurnCursorColumn = 0
    this.activeTurnActivityRow = null
    this.activeFollowUps = []
    this.activeThought = ''
    this.activeThoughtEntryId = null
    this.activeThoughtDurationSeconds = 0
    this.mentionPathMap.clear()
    this.composer = createComposerState(this.history)
    this.view.completionItems = []
    this.view.completionIndex = 0
    this.setActivity('thinking', 'Thinking')
  }

  setPendingActiveMessageHandler(handler: TerminalPromptContext['onActiveMessage']): boolean {
    if (!this.pendingPrompt) return false
    this.pendingPrompt.context = { ...this.pendingPrompt.context, onActiveMessage: handler }
    return true
  }

  setActiveFollowUps(followUps: readonly ActiveTurnFollowUpView[]): void {
    this.activeFollowUps = followUps.map((followUp) => ({ ...followUp }))
    if (this.activeTurn) this.renderActiveTurn()
  }

  addConsumedUserMessages(messages: readonly Message[]): void {
    const existingEntryIds = new Set(this.view.entries.map((entry) => entry.id))
    const nextMessages = messages.filter((message) => message.role === 'user' && !existingEntryIds.has(message.id))
    if (nextMessages.length === 0) return

    this.closeAssistantSegment()
    this.activeThought = ''
    this.activeThoughtEntryId = null
    this.activeThoughtDurationSeconds = 0
    for (const message of nextMessages) {
      existingEntryIds.add(message.id)
      this.view.entries.push({ kind: 'user', id: message.id, text: stripAnsi(message.content) })
    }

    if (this.activeTurn) {
      this.setActivity('thinking', 'Thinking')
    }
  }

  addNotice(level: 'info' | 'success' | 'warning' | 'error', text: string): void {
    this.stopActivity()
    const cleanText = stripAnsi(text)
    this.view.entries.push({ kind: 'notice', id: nextTranscriptId('notice'), level, text: cleanText })
    if (this.activeTurn) {
      this.renderActiveTurn()
      return
    }
    const color = level === 'success' ? colors.success : level === 'warning' ? colors.warning : level === 'error' ? colors.danger : colors.accent
    this.writeOutsidePrompt(`\n${color}${cleanText}${colors.reset}\n`)
  }

  addDiff(diff: string): void {
    this.writeOutsidePrompt(`\n${renderDiffLines(diff).join('\n')}\n`)
  }

  removeLastTurn(): void {
    const lastUserIndex = this.view.entries.map((entry) => entry.kind).lastIndexOf('user')
    if (lastUserIndex < 0) return
    this.view.entries.splice(lastUserIndex)
  }

  setActivity(kind: 'idle' | 'thinking' | 'tool', label: string, detail?: string): void {
    const previousActivity = this.view.activity
    const cleanLabel = stripAnsi(label)
    const detailText = detail ? stripAnsi(detail) : undefined
    this.view.activity = { kind, label: cleanLabel, detail: detailText }
    this.view.isStreaming = kind !== 'idle'
    const startsGenericWaitingPhase =
      kind === 'thinking' &&
      cleanLabel === 'Thinking' &&
      !detailText &&
      (previousActivity.kind !== 'thinking' ||
        previousActivity.label !== cleanLabel ||
        previousActivity.detail !== detailText)
    if (startsGenericWaitingPhase) {
      this.activeThinkingMessageIndex = 0
      this.activeThinkingMessageStartedAt = Date.now()
    }
    if (kind === 'idle') {
      this.stopActivity()
      return
    }

    this.hasTurnOutput = true
    if (cleanLabel === this.activityLabel && previousActivity.detail === detailText) {
      if (this.activeTurn) {
        if (kind === 'thinking') this.startActiveThinkingAnimation()
        this.renderActiveTurn()
      }
      return
    }
    this.activityLabel = cleanLabel
    if (!this.activeTurn) {
      const indicatorText = cleanLabel === 'Thinking' && !detailText ? null : cleanLabel || 'Thinking'
      this.thinkingIndicator.setText(indicatorText)
      this.thinkingIndicator.start(indicatorText ?? undefined)
    } else {
      if (kind === 'thinking') this.startActiveThinkingAnimation()
      else this.stopActiveThinkingAnimation()
      this.renderActiveTurn()
    }
  }

  addThought(durationSeconds: number, text?: string): void {
    this.closeAssistantSegment()
    this.stopActivity()
    this.activeThoughtDurationSeconds += durationSeconds
    const existingThought = this.activeThoughtEntryId
      ? this.view.entries.find((entry) => entry.kind === 'thought' && entry.id === this.activeThoughtEntryId)
      : undefined
    if (existingThought?.kind === 'thought') {
      existingThought.durationSeconds = this.activeThoughtDurationSeconds
      if (text) existingThought.text = stripAnsi(text)
    } else {
      const id = nextTranscriptId('thought')
      this.activeThoughtEntryId = id
      this.view.entries.push({
        kind: 'thought',
        id,
        durationSeconds: this.activeThoughtDurationSeconds,
        text: text ? stripAnsi(text) : undefined,
      })
    }
    this.activeThought = ''
    if (this.activeTurn) {
      this.renderActiveTurn()
      return
    }
    this.output.write(`\n  ${colors.subtle}Thought for${colors.reset} ${colors.foreground}${formatThoughtDuration(durationSeconds)}${colors.reset}\n`)
  }

  appendThought(delta: string): void {
    this.closeAssistantSegment()
    this.activeThought += delta
    this.setActivity('thinking', 'Thinking', this.getReasoningPreview())
  }

  startAssistant(): void {
    if (this.activeAssistantId) return
    if (!this.activeTurn) {
      this.stopActivity()
    }
    this.activeAssistantId = randomUUID()
    this.hasTurnOutput = true
    this.view.entries.push({ kind: 'assistant', id: this.activeAssistantId, text: '' })
    if (this.activeTurn) {
      this.renderActiveTurn()
      return
    }
    this.output.write('\n')
  }

  appendAssistant(delta: string): void {
    this.startAssistant()
    const assistant = this.view.entries.find((entry) => entry.kind === 'assistant' && entry.id === this.activeAssistantId)
    if (assistant && assistant.kind === 'assistant') assistant.text += delta
    if (this.activeTurn) {
      this.renderActiveTurn()
    } else {
      this.markdown.append(delta)
    }
  }

  addTool(label: string, status: 'running' | 'completed' | 'failed', detail?: string, diff?: string): void {
    this.closeAssistantSegment()
    this.stopActivity()
    this.activeThought = ''
    this.activeThoughtEntryId = null
    this.activeThoughtDurationSeconds = 0
    const cleanLabel = stripAnsi(label)
    this.view.entries.push({
      kind: 'tool',
      id: nextTranscriptId('tool'),
      label: cleanLabel,
      status,
      detail: detail ? stripAnsi(detail) : undefined,
      diff,
    })
    if (this.activeTurn) {
      this.renderActiveTurn()
      return
    }
    this.output.write(`\n  ${renderTerminalToolRowText(cleanLabel, status, detail)}\n`)
    if (diff) {
      this.output.write(`${renderDiffLines(diff).join('\n')}\n`)
    }
  }

  finishTurn(): void {
    if (this.activeTurn) {
      const turnEntries = this.view.entries.slice(this.activeTurnStartIndex)
      const deferVisualCommit = this.resizeRedrawPending && this.usesProcessOutput
      this.stopActivity()
      this.clearActiveTurnDisplay()
      if (!deferVisualCommit) {
        this.output.write(`${renderCommittedTurn(turnEntries, { leadingSpacer: this.activeTurnLeadingSpacer }).join('\n')}\n`)
      }
      this.activeTurn = false
      this.activeTurnLeadingSpacer = true
      this.activeTurnStartIndex = 0
      this.activeTurnLines = []
      this.activeTurnCursorRow = 0
      this.activeTurnCursorColumn = 0
      this.activeTurnActivityRow = null
      this.activeThought = ''
      this.activeThoughtEntryId = null
      this.activeThoughtDurationSeconds = 0
      this.activeAssistantId = null
      this.activeTurnCancel = null
      this.view.isStreaming = false
      this.hasTurnOutput = false
      this.activeFollowUps = []
      if (this.pendingPrompt) this.renderPrompt()
      else this.output.write('\x1b[?25h')
      return
    }

    this.stopActivity()
    if (this.activeAssistantId) this.markdown.finish()
    this.activeAssistantId = null
    this.activeTurnCancel = null
    this.activeThought = ''
    this.activeThoughtEntryId = null
    this.activeThoughtDurationSeconds = 0
    this.view.isStreaming = false
    if (this.hasTurnOutput) this.output.write('\n')
    this.hasTurnOutput = false
    this.output.write('\x1b[?25h')
  }

  scroll(delta: number): void {
    // Append-only mode intentionally leaves scrollback to the terminal.
    void delta
  }

  get eventPresentation(): TerminalScreenEventPresentation {
    return {
      onWaiting: (label) => this.setActivity('thinking', label),
      onReasoningDelta: (delta) => this.appendThought(delta),
      onReasoningCompleted: (durationSeconds) => {
        this.addThought(durationSeconds, this.activeThought)
        if (this.activeTurn) this.setActivity('thinking', 'Thinking')
      },
      onContentStart: () => {
        this.activeThought = ''
        this.activeThoughtEntryId = null
        this.activeThoughtDurationSeconds = 0
        this.stopActivity()
        this.startAssistant()
      },
      onContentDelta: (delta) => this.appendAssistant(delta),
      onToolStarted: () => undefined,
      onToolCompleted: (label, detail, diff) => {
        this.addTool(label, 'completed', detail, diff)
        if (this.activeTurn) this.setActivity('thinking', 'Thinking')
      },
      onToolFailed: (label, detail) => {
        this.addTool(label, 'failed', detail)
        if (this.activeTurn) this.setActivity('thinking', 'Thinking')
      },
      onCompleted: () => this.finishTurn(),
    }
  }

  attachImages(attachments: readonly ChatAttachment[]): void {
    this.composer = attachImagesToComposer(this.composer, attachments)
    if (this.pendingPrompt) this.renderCurrentPrompt()
  }

  getComposerAttachments(): ChatAttachment[] {
    return [...this.composer.attachments]
  }

  private restoreComposerDraft(
    composer: ComposerState,
    text: string,
    attachments: readonly ChatAttachment[] = [],
  ): ComposerState {
    this.mentionPathMap.clear()
    for (const [label, mentionPath] of buildChatMentionPathMap(text)) {
      this.mentionPathMap.set(label, mentionPath)
    }
    return setComposerText(composer, collapseChatMentionMarkup(text), attachments)
  }

  setNextPromptDraft(text: string, attachments: readonly ChatAttachment[] = []): void {
    this.nextPromptDraft = { text, attachments: [...attachments] }
    this.composer = this.restoreComposerDraft(this.composer, text, attachments)
    if (this.pendingPrompt) {
      this.renderCurrentPrompt()
    }
  }

  async ask(context: TerminalPromptContext): Promise<TerminalPromptSubmission> {
    if (!process.stdin.isTTY && this.usesProcessOutput) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      return new Promise((resolve) => {
        rl.question('> ', (answer) => {
          rl.close()
          resolve({ text: answer, attachments: [] })
        })
      })
    }

    if (this.pendingPrompt) throw new Error('A terminal prompt is already active.')
    this.updateSession({ mode: context.mode, model: context.modelId, provider: context.providerId })
    if (this.nextPromptDraft) {
      this.composer = this.restoreComposerDraft(
        createComposerState(this.history),
        this.nextPromptDraft.text,
        this.nextPromptDraft.attachments,
      )
      this.nextPromptDraft = null
    } else {
      this.mentionPathMap.clear()
      this.composer = createComposerState(this.history)
    }
    this.resetBracketedPasteInput()
    this.pendingPrompt = { context, resolve: () => undefined }
    if (this.usesProcessOutput) {
      // Register our listeners before resuming stdin. A key sent while the
      // prompt is being armed can already be buffered by the TTY; resuming
      // first would let Node drain it before the composer can see it.
      ensureKeypressEvents()
      process.stdin.removeListener('data', this.handleRawStdinData)
      process.stdin.prependListener('data', this.handleRawStdinData)
      process.stdin.removeListener('keypress', this.handleKeypress)
      process.stdin.on('keypress', this.handleKeypress)
      this.lifecycle.enableRawInput()
    }
    this.updateCompletionItems(context)
    this.renderCurrentPrompt()

    return new Promise((resolve) => {
      if (this.pendingPrompt) this.pendingPrompt.resolve = resolve
    })
  }

  dismissPrompt(): void {
    if (!this.pendingPrompt) return
    if (this.activeTurn) this.clearActiveTurnDisplay()
    else this.clearPromptDisplay()
    this.pendingPrompt = null
    this.mentionPathMap.clear()
    this.composer = createComposerState(this.history)
    this.view.completionItems = []
    this.view.completionIndex = 0
    if (this.usesProcessOutput) {
      this.lifecycle.disableRawInput()
      process.stdin.removeListener('data', this.handleRawStdinData)
      process.stdin.removeListener('keypress', this.handleKeypress)
    }
    this.resetBracketedPasteInput()
  }

  private async runInteractiveOverlay<T>(run: (resizeHost: InteractiveResizeHost) => Promise<T>): Promise<T> {
    this.clearPromptDisplay()
    try {
      return await run(this.interactiveResizeHost)
    } finally {
      this.interactiveResizeHandler = null
    }
  }

  async select<T>(options: SelectOptions<T>): Promise<T | null> {
    return this.runInteractiveOverlay((resizeHost) => interactiveSelect(options, resizeHost))
  }

  async input(options: TextInputOptions): Promise<string | null> {
    return this.runInteractiveOverlay((resizeHost) => interactiveTextInput(options, resizeHost))
  }

  async selectResume(
    items: readonly ResumeConversationItem[],
    workspacePath: string,
    projectLabel: string,
    page: ResumePage = 'active',
  ): Promise<ResumeSelectionResult | null> {
    return this.runInteractiveOverlay((resizeHost) => (
      interactiveResumeSelect({ items, workspacePath, projectLabel, page }, resizeHost)
    ))
  }

  async checklist<T>(options: ChecklistOptions<T>): Promise<T[] | null> {
    return this.runInteractiveOverlay((resizeHost) => interactiveChecklist(options, resizeHost))
  }

  async confirm(question: string, defaultYes = true): Promise<boolean> {
    return this.runInteractiveOverlay((resizeHost) => interactiveConfirm(question, defaultYes, resizeHost))
  }

  handleInputAction(action: TerminalInputAction): void {
    this.handlePromptAction(action)
  }

  private readonly handleRawStdinData = (data: Buffer | string) => {
    const str = typeof data === 'string' ? data : data.toString('utf8')
    if (!this.pendingPrompt) {
      this.bracketedPasteDecoder.reset()
      return
    }

    if (str === '\u001b') {
      this.suppressKeypressesUntilDataCycleCompletes()
      if (this.requestActiveTurnCancellation()) return
      this.handlePromptAction({ type: 'cancel' })
      return
    }

    const decoded = this.bracketedPasteDecoder.consume(str)
    if (!decoded.containsPasteSequence) return

    this.suppressKeypressesUntilDataCycleCompletes()
    for (const pastedText of decoded.pastedTexts) {
      this.composer = this.applyActionWithPaste({ type: 'insert', text: pastedText })
    }
    if (decoded.pastedTexts.length > 0) {
      this.updateCompletionItems(this.pendingPrompt.context)
      this.renderCurrentPrompt()
    }
  }

  private readonly handleKeypress = (input: string, key: readline.Key) => {
    if (this.suppressKeypressEvents || this.bracketedPasteDecoder.isConsuming) return
    const isCtrlC = input === '\u0003' || (key.ctrl && key.name === 'c')
    const isEscape = input === '\u001b' || key.name === 'escape'
    if (isCtrlC) {
      if (this.requestActiveTurnCancellation()) return
      if (composerText(this.composer).length > 0) {
        this.handlePromptAction({ type: 'cancel' })
        return
      }
      this.stop()
      this.output.write('\n')
      process.exit(0)
    }
    if (isEscape) {
      if (this.requestActiveTurnCancellation()) return
      if (!this.pendingPrompt) return
      this.handlePromptAction({ type: 'cancel' })
      return
    }
    if (!this.pendingPrompt) return
    const action = getTerminalInputAction(input, key)
    if (!action) return
    this.handlePromptAction(action)
  }

  private requestActiveTurnCancellation(): boolean {
    if (!this.activeTurn) return false
    const onCancelTurn = this.pendingPrompt?.context.onCancelTurn ?? this.activeTurnCancel
    onCancelTurn?.()
    return true
  }

  private handlePromptAction(action: TerminalInputAction): void {
    const pending = this.pendingPrompt
    if (!pending) return

    if (action.type === 'toggle-mode') {
      const nextMode: ChatMode = pending.context.mode === 'plan' ? 'agent' : 'plan'
      pending.context.mode = nextMode
      pending.context.onToggleMode?.(nextMode)
      this.updateSession({ mode: nextMode })
      this.updateCompletionItems(pending.context)
      this.renderCurrentPrompt()
      return
    }

    if (action.type === 'cancel') {
      if (this.activeTurn) {
        this.requestActiveTurnCancellation()
        return
      }
      pending.context.onCancelDraft?.()
      this.selectedHistoryUserMessageId = null
      this.mentionPathMap.clear()
      this.composer = createComposerState(this.history)
      this.updateCompletionItems(pending.context)
      this.redrawFromState()
      return
    }

    if (action.type === 'paste-clipboard') {
      void readSystemClipboardImageOrText(this.view.session.workspace).then((clipboardResult) => {
        if (!this.pendingPrompt) return
        if (clipboardResult.image) {
          this.composer = attachImagesToComposer(this.composer, [clipboardResult.image])
          this.updateCompletionItems(pending.context)
          this.renderCurrentPrompt()
          return
        }
        if (clipboardResult.text) {
          this.composer = this.applyActionWithPaste({ type: 'insert', text: clipboardResult.text })
          this.updateCompletionItems(pending.context)
          this.renderCurrentPrompt()
          return
        }
      })
      return
    }

    if (action.type === 'alternate-submit') {
      if (this.activeTurn) {
        this.submitActiveMessage(
          pending,
          resolveFollowUpKeyBehavior('alternate', pending.context.enterFollowUpBehavior ?? 'steer'),
        )
      } else if (this.view.completionItems.length > 0) {
        this.composer = this.insertCompletion(this.view.completionItems[this.view.completionIndex], true)
        this.updateCompletionItems(pending.context)
        this.renderCurrentPrompt()
      }
      return
    }

    if (action.type === 'submit') {
      const text = composerText(this.composer).trim()
      const attachments = [...this.composer.attachments]
      const completion = this.view.completionItems[this.view.completionIndex]
      if (completion?.mentionKind) {
        this.composer = this.insertCompletion(completion, true)
        this.updateCompletionItems(pending.context)
        this.renderCurrentPrompt()
        return
      }
      if (completion && text.startsWith('/') && !text.includes(' ') && text !== completion.value) {
        this.composer = this.insertCompletion(completion, false)
        this.updateCompletionItems(pending.context)
        this.renderCurrentPrompt()
        return
      }
      if (!text) return
      if (this.activeTurn) {
        this.submitActiveMessage(
          pending,
          resolveFollowUpKeyBehavior('primary', pending.context.enterFollowUpBehavior ?? 'steer'),
        )
        return
      }
      this.history.splice(0, this.history.length, ...recordComposerHistory(this.composer, text).history)
      const resolve = pending.resolve
      this.pendingPrompt = null
      if (this.usesProcessOutput) {
        this.lifecycle.disableRawInput()
        process.stdin.removeListener('data', this.handleRawStdinData)
        process.stdin.removeListener('keypress', this.handleKeypress)
      }
      this.resetBracketedPasteInput()
      const expandedText = expandChatMentions(text, this.mentionPathMap)
      this.selectedHistoryUserMessageId = null
      this.finishPrompt(text)
      this.mentionPathMap.clear()
      resolve({ text: expandedText, attachments })
      return
    }

    if (action.type === 'move-up' || action.type === 'move-down') {
      if (this.view.completionItems.length > 0) {
        const increment = action.type === 'move-up' ? -1 : 1
        const count = this.view.completionItems.length
        this.view.completionIndex = (this.view.completionIndex + increment + count) % count
        this.renderCurrentPrompt()
        return
      }

      const undoNavigation = pending.context.onNavigateUndoEdit?.(action.type === 'move-up' ? 'older' : 'newer')
      if (undoNavigation !== undefined) {
        if (undoNavigation) {
          this.selectedHistoryUserMessageId = undoNavigation.targetUserMessageId
          this.composer = this.restoreComposerDraft(this.composer, undoNavigation.text, undoNavigation.attachments)
          this.updateCompletionItems(pending.context)
          this.redrawFromState()
        } else {
          this.renderCurrentPrompt()
        }
        return
      }
    }

    if (action.type === 'insert' && this.view.completionItems.length > 0 && (action.text === '\t' || action.text === ' ')) {
      this.composer = this.insertCompletion(this.view.completionItems[this.view.completionIndex], true)
    } else {
      this.composer = this.applyActionWithPaste(action)
    }
    this.updateCompletionItems(pending.context)
    this.renderCurrentPrompt()
  }

  private submitActiveMessage(pending: PendingPrompt, behavior: ActiveTurnFollowUpView['behavior']): void {
    const text = composerText(this.composer).trim()
    if (!text) return
    const expandedText = expandChatMentions(text, this.mentionPathMap)
    this.history.splice(0, this.history.length, ...recordComposerHistory(this.composer, text).history)
    this.activeFollowUps.push({ behavior, text })
    this.composer = createComposerState(this.history)
    this.mentionPathMap.clear()
    this.view.completionItems = []
    this.view.completionIndex = 0
    pending.context.onActiveMessage?.(expandedText, behavior)
    this.updateCompletionItems(pending.context)
    this.renderActiveTurn()
  }

  private insertCompletion(item: CompletionItemView, appendSpace: boolean): ComposerState {
    const text = composerText(this.composer)
    const cursorIndex = this.composer.lines.slice(0, this.composer.lineIndex).reduce((total, line) => total + line.length + 1, 0) + this.composer.column
    const before = text.slice(0, cursorIndex)
    const match = before.match(/(?:^|\s)([/@][^\s]*)$/)
    if (!match || match.index === undefined) return this.composer
    const start = match.index + (match[0].startsWith(' ') ? 1 : 0)
    if (item.mentionPath && item.value.startsWith('@')) {
      this.mentionPathMap.set(item.value.slice(1), item.mentionPath)
    }
    const nextText = `${text.slice(0, start)}${item.value}${appendSpace ? ' ' : ''}${text.slice(cursorIndex)}`
    const next = createComposerState(this.history, this.composer.attachments)
    const lines = nextText.split('\n')
    return { ...next, lines, lineIndex: lines.length - 1, column: lines.at(-1)?.length ?? 0 }
  }

  private applyCommittedMentionAction(action: TerminalInputAction): ComposerState | null {
    if (!['backspace', 'delete', 'move-left', 'move-right'].includes(action.type)) return null

    const text = composerText(this.composer)
    const cursorIndex = getComposerCursorIndex(this.composer)
    const mentionBefore = getChatMentionBeforePosition(text, cursorIndex, this.mentionPathMap)
    const mentionAt = getChatMentionAtPosition(text, cursorIndex, this.mentionPathMap)

    if (action.type === 'backspace') {
      const mention = mentionBefore ?? mentionAt
      if (!mention) return null
      const nextText = text.slice(0, mention.start) + text.slice(mention.end)
      const nextState = setComposerCursorIndex(setComposerText(this.composer, nextText), mention.start)
      const labelStillPresent = findChatMentionMatches(nextText, this.mentionPathMap)
        .some((match) => match.label === mention.label)
      if (!labelStillPresent) this.mentionPathMap.delete(mention.label)
      return nextState
    }

    if (action.type === 'delete') {
      const mention = findChatMentionMatches(text, this.mentionPathMap)
        .find((match) => match.start === cursorIndex)
      if (!mention) return null
      const nextText = text.slice(0, mention.start) + text.slice(mention.end)
      const nextState = setComposerCursorIndex(setComposerText(this.composer, nextText), mention.start)
      const labelStillPresent = findChatMentionMatches(nextText, this.mentionPathMap)
        .some((match) => match.label === mention.label)
      if (!labelStillPresent) this.mentionPathMap.delete(mention.label)
      return nextState
    }

    if (action.type === 'move-left') {
      const mention = mentionBefore ?? mentionAt
      return mention ? setComposerCursorIndex(this.composer, mention.start) : null
    }

    if (mentionAt && cursorIndex >= mentionAt.start && cursorIndex < mentionAt.end) {
      return setComposerCursorIndex(this.composer, mentionAt.end)
    }
    return null
  }

  private applyActionWithPaste(action: TerminalInputAction): ComposerState {
    const mentionActionState = this.applyCommittedMentionAction(action)
    if (mentionActionState) return mentionActionState

    if (action.type === 'insert') {
      const imagePaths = extractPastedImageFilePaths(action.text, this.view.session.workspace)
      if (imagePaths.length > 0) {
        const validAttachments: ChatAttachment[] = []
        for (const imgPath of imagePaths) {
          const attachment = readCliImageAttachmentSync(imgPath, this.view.session.workspace)
          if (attachment) {
            validAttachments.push(attachment)
          }
        }
        if (validAttachments.length > 0) {
          return attachImagesToComposer(this.composer, validAttachments)
        }
      }
      return insertTextIntoComposer(this.composer, action.text)
    }
    return applyComposerAction(this.composer, action)
  }

  private suppressKeypressesUntilDataCycleCompletes(): void {
    this.suppressKeypressEvents = true
    if (this.keypressSuppressionHandle) return

    this.keypressSuppressionHandle = setImmediate(() => {
      this.keypressSuppressionHandle = null
      this.suppressKeypressEvents = false
    })
  }

  private resetBracketedPasteInput(): void {
    this.bracketedPasteDecoder.reset()
    this.suppressKeypressEvents = false
    if (this.keypressSuppressionHandle) {
      clearImmediate(this.keypressSuppressionHandle)
      this.keypressSuppressionHandle = null
    }
  }

  refreshPromptCompletions(): void {
    if (!this.pendingPrompt) return
    this.updateCompletionItems(this.pendingPrompt.context)
    this.renderCurrentPrompt()
  }

  private updateCompletionItems(context: TerminalPromptContext): void {
    const text = composerText(this.composer)
    const cursorIndex = this.composer.lines.slice(0, this.composer.lineIndex).reduce((total, line) => total + line.length + 1, 0) + this.composer.column
    const committedMention = /@([^\s]*)$/u.exec(text.slice(0, cursorIndex))
    const items = committedMention && this.mentionPathMap.has(committedMention[1])
      ? []
      : context.getCompletionItems?.(text, cursorIndex) ?? []
    this.view.completionItems = items
    this.view.completionIndex = Math.max(0, Math.min(this.view.completionIndex, Math.max(0, items.length - 1)))
  }

  private getReasoningPreview(): string | undefined {
    const compact = stripAnsi(this.activeThought).replace(/\s+/g, ' ').trim()
    if (!compact) return undefined
    if (compact.length <= 160) return compact
    const tail = compact.slice(-159).replace(/^\S+\s*/u, '')
    return `…${tail || compact.slice(-159)}`
  }

  private closeAssistantSegment(): void {
    if (!this.activeAssistantId) return
    if (!this.activeTurn) this.markdown.finish()
    this.activeAssistantId = null
  }

  private stopActivity(): void {
    this.thinkingIndicator.stop()
    this.stopActiveThinkingAnimation()
    this.activityLabel = ''
    this.view.activity = { kind: 'idle', label: '' }
  }

  private startActiveThinkingAnimation(): void {
    if (this.activeThinkingTimer || !this.usesProcessOutput || !process.stdout.isTTY) return
    this.activeThinkingFrameIndex = 0
    if (this.activeThinkingMessageStartedAt === 0) {
      this.activeThinkingMessageIndex = 0
      this.activeThinkingMessageStartedAt = Date.now()
    }
    this.activeThinkingTimer = setInterval(() => {
      if (!this.activeTurn || this.view.activity.kind !== 'thinking') {
        this.stopActiveThinkingAnimation()
        return
      }
      this.activeThinkingFrameIndex = (this.activeThinkingFrameIndex + 1) % THINKING_SPINNER_FRAMES.length
      if (
        this.view.activity.label === 'Thinking' &&
        !this.view.activity.detail &&
        Date.now() - this.activeThinkingMessageStartedAt >= THINKING_STATUS_ROTATION_INTERVAL_MS
      ) {
        this.activeThinkingMessageIndex =
          (this.activeThinkingMessageIndex + 1) % THINKING_STATUS_MESSAGES.length
        this.activeThinkingMessageStartedAt = Date.now()
      }
      this.patchActiveThinkingFrame()
    }, THINKING_SPINNER_INTERVAL_MS)
    this.activeThinkingTimer.unref()
  }

  private stopActiveThinkingAnimation(): void {
    if (this.activeThinkingTimer) {
      clearInterval(this.activeThinkingTimer)
      this.activeThinkingTimer = null
    }
    this.activeThinkingFrameIndex = 0
    this.activeThinkingMessageIndex = 0
    this.activeThinkingMessageStartedAt = 0
  }

  private patchActiveThinkingFrame(): void {
    if (this.resizeRedrawPending) return

    const activityRow = this.activeTurnActivityRow
    if (
      activityRow === null ||
      this.view.activity.kind !== 'thinking' ||
      activityRow >= this.activeTurnLines.length
    ) {
      return
    }

    const nextLine = renderTerminalActivityLine(
      this.getRenderedActivity(),
      getTerminalPanelWidth(),
      getThinkingSpinnerFrame(this.activeThinkingFrameIndex),
    )
    if (nextLine === this.activeTurnLines[activityRow]) return

    const redrawOutput = new TerminalOutputBuffer()
    redrawOutput.write('\x1b[?25l')
    redrawOutput.moveCursor(0, activityRow - this.activeTurnCursorRow)
    redrawOutput.cursorTo(0)
    redrawOutput.write(`\x1b[2K${nextLine}`)
    redrawOutput.moveCursor(0, this.activeTurnCursorRow - activityRow)
    redrawOutput.cursorTo(this.activeTurnCursorColumn)
    if (this.shouldShowActiveComposerCaret()) redrawOutput.write('\x1b[6 q\x1b[?25h')
    redrawOutput.flushTo(this.output)
    this.activeTurnLines[activityRow] = nextLine
  }

  private getRenderedActivity() {
    if (
      this.view.activity.kind === 'thinking' &&
      this.view.activity.label === 'Thinking' &&
      !this.view.activity.detail
    ) {
      return {
        ...this.view.activity,
        label: getThinkingStatusMessage(this.activeThinkingMessageIndex),
      }
    }
    return this.view.activity
  }

  private shouldShowActiveComposerCaret(): boolean {
    return this.pendingPrompt !== null && composerText(this.composer).length > 0
  }

  private clearActiveTurnDisplay(): void {
    if (this.activeTurnLines.length === 0) return
    if (this.resizeRedrawPending && this.usesProcessOutput) {
      this.activeTurnLines = []
      this.activeTurnCursorRow = 0
      this.activeTurnCursorColumn = 0
      this.activeTurnActivityRow = null
      return
    }
    clearTerminalRegion(this.activeTurnLines.length, this.activeTurnCursorRow, this.output)
    this.activeTurnLines = []
    this.activeTurnCursorRow = 0
    this.activeTurnCursorColumn = 0
    this.activeTurnActivityRow = null
  }

  private renderActiveTurn(outputOverride?: TerminalOutput): void {
    if (!this.activeTurn) return
    if (outputOverride === undefined && this.resizeRedrawPending) return
    const redrawOutput = outputOverride ?? (this.usesProcessOutput && process.stdout.isTTY
      ? new TerminalOutputBuffer()
      : this.output)
    const ownsOutputBuffer = outputOverride === undefined && redrawOutput instanceof TerminalOutputBuffer
    redrawOutput.write('\x1b[?25l')
    const panelWidth = getTerminalPanelWidth()
    const composerWidth = Math.max(1, panelWidth - 6)
    const visualLines = getComposerVisualLines(this.composer, composerWidth)
    const cursor = getComposerCursorPosition(this.composer, composerWidth)
    const render = renderActiveTurnView({
      activity: this.getRenderedActivity(),
      entries: this.view.entries.slice(this.activeTurnStartIndex),
      followUps: this.activeFollowUps,
      leadingSpacer: this.activeTurnLeadingSpacer,
      panel: createActiveTurnPromptPanel({
        composerWidth,
        placeholder: getFollowUpKeyHint(this.pendingPrompt?.context.enterFollowUpBehavior ?? 'steer'),
        visualLines: visualLines.map((line) => line.text),
        completionItems: this.view.completionItems,
        completionIndex: this.view.completionIndex,
        cursorColumn: cursor.column,
        cursorRow: cursor.lineIndex,
        queued: false,
        statusLine: renderTerminalComposerStatus({
          ...this.composerStatus,
          mode: this.view.session.mode,
          model: this.view.session.model,
        }, panelWidth),
      }),
      maxOutputLines: process.stdout.rows ? Math.max(4, process.stdout.rows - 10) : undefined,
      thinkingFrame: getThinkingSpinnerFrame(this.activeThinkingFrameIndex),
    })

    const hasExistingFrame = this.activeTurnLines.length > 0
    if (!hasExistingFrame) {
      redrawOutput.write(render.lines.join('\n'))
    } else {
      redrawOutput.moveCursor(0, -this.activeTurnCursorRow)
      redrawOutput.cursorTo(0)
      updateTerminalRegion(this.activeTurnLines, render.lines, redrawOutput)
    }

    this.activeTurnLines = render.lines
    this.activeTurnCursorRow = render.cursorRow
    this.activeTurnCursorColumn = render.cursorColumn
    this.activeTurnActivityRow = render.activityRow
    if (hasExistingFrame) {
      if (render.cursorRow > 0) redrawOutput.moveCursor(0, render.cursorRow)
    } else {
      const cursorOffsetFromBottom = render.lines.length - 1 - render.cursorRow
      if (cursorOffsetFromBottom > 0) redrawOutput.moveCursor(0, -cursorOffsetFromBottom)
    }
    redrawOutput.cursorTo(render.cursorColumn)
    if (this.shouldShowActiveComposerCaret()) redrawOutput.write('\x1b[6 q\x1b[?25h')
    if (ownsOutputBuffer && redrawOutput instanceof TerminalOutputBuffer) redrawOutput.flushTo(this.output)
  }

  private printSessionIntro(output: TerminalOutput = this.output): void {
    const panel = renderSessionPanel(this.view.session)
    output.write(`\n${panel.join('\n')}\n`)
    output.write(`${colors.subtle}  /help${colors.reset} ${colors.muted}commands${colors.reset}  ${colors.separator}·${colors.reset}  ${colors.subtle}@${colors.reset} ${colors.muted}files${colors.reset}  ${colors.separator}·${colors.reset}  ${colors.subtle}Shift+Tab${colors.reset} ${colors.muted}mode${colors.reset}\n\n`)
  }

  private clearPromptDisplay(): void {
    if (this.renderedPromptRows === 0) return
    if (this.resizeRedrawPending && this.usesProcessOutput) {
      this.renderedPromptRows = 0
      this.renderedPromptLines = []
      this.renderedPromptCursorRow = 0
      return
    }
    clearTerminalRegion(this.renderedPromptRows, this.renderedPromptCursorRow, this.output)
    this.renderedPromptRows = 0
    this.renderedPromptLines = []
    this.renderedPromptCursorRow = 0
  }

  private finishPrompt(text: string): void {
    this.clearPromptDisplay()
    if (text.startsWith('/')) return
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      const prefix = index === 0 ? `${colors.accent}›${colors.reset} ` : '  '
      this.output.write(`${prefix}${formatCliImageReferenceInText(line)}\n`)
    })
  }

  private renderCurrentPrompt(): void {
    if (this.activeTurn) {
      this.renderActiveTurn()
      return
    }
    this.renderPrompt()
  }

  private writeOutsidePrompt(text: string): void {
    const restorePrompt = this.pendingPrompt !== null && !this.activeTurn
    if (restorePrompt) this.clearPromptDisplay()
    this.output.write(text)
    if (restorePrompt) this.renderPrompt()
  }

  private runResizeRedraw(): void {
    if (this.interactiveResizeHandler) {
      this.interactiveResizeHandler()
      return
    }
    this.redrawAfterResize()
  }

  private readonly handleResize = () => {
    if (!this.usesProcessOutput) {
      this.runResizeRedraw()
      return
    }

    this.resizeRedrawPending = true
    if (this.resizeRedrawTimer) return

    this.resizeRedrawTimer = setTimeout(() => {
      this.resizeRedrawTimer = null
      if (!this.resizeRedrawPending) return
      this.resizeRedrawPending = false
      this.runResizeRedraw()
      if (this.resizeRedrawPending) this.handleResize()
    }, RESIZE_FRAME_INTERVAL_MS)
  }

  private readonly checkTerminalSize = () => {
    const nextSize = this.readTerminalSize()
    if (!nextSize) return
    if (
      this.lastTerminalSize &&
      this.lastTerminalSize.columns === nextSize.columns &&
      this.lastTerminalSize.rows === nextSize.rows
    ) {
      return
    }
    this.lastTerminalSize = nextSize
    this.handleResize()
  }

  private readTerminalSize(): { columns: number; rows: number } | null {
    const columns = process.stdout.columns
    const rows = process.stdout.rows
    if (!columns || !rows) return null
    return { columns, rows }
  }

  private redrawFromState(): void {
    this.redrawAfterResize()
  }

  private getSelectedHistoryViewportMaxLines(): number | undefined {
    if (!this.selectedHistoryUserMessageId) return undefined
    const rows = process.stdout.rows
    if (!rows) return undefined

    const panelWidth = getTerminalPanelWidth()
    const composerWidth = Math.max(1, panelWidth - 6)
    const composerLineCount = Math.max(1, getComposerVisualLines(this.composer, composerWidth).length)
    const completionRows = this.view.completionItems.length > 0
      ? 1 + Math.min(6, this.view.completionItems.length)
      : 0
    const compactionRows = this.compactionState ? 2 : 0
    const promptRows = compactionRows + 1 + composerLineCount + completionRows + 1 + 1
    const sessionIntroRows = 8

    return Math.max(4, rows - sessionIntroRows - promptRows)
  }

  private redrawAfterResize(): void {
    // Terminal hosts reflow lines when their width changes, so the old cursor
    // row and frame dimensions are no longer trustworthy. Repaint from the
    // in-memory session state instead of diffing against a reflowed frame.
    const bufferedOutput = new TerminalOutputBuffer()
    // A resized terminal has already reflowed the old rows. Erase that stale
    // grid as part of the same synchronized write as the new frame so the
    // terminal never presents the intermediate, broken layout to the user.
    bufferedOutput.write(`\x1b[?25l${CLEAR_TERMINAL_SEQUENCE}`)
    const redrawOutput = bufferedOutput
    this.renderedPromptRows = 0
    this.renderedPromptLines = []
    this.renderedPromptCursorRow = 0
    this.activeTurnLines = []
    this.activeTurnCursorRow = 0
    this.activeTurnCursorColumn = 0
    this.activeTurnActivityRow = null

    this.printSessionIntro(redrawOutput)

    const historyEntries = this.activeTurn
      ? this.view.entries.slice(0, this.activeTurnStartIndex)
      : this.view.entries
    const historyLines = renderConversationHistory(historyEntries, {
      selectedUserMessageId: this.selectedHistoryUserMessageId,
      maxLines: this.getSelectedHistoryViewportMaxLines(),
    })
    if (historyLines.length > 0) redrawOutput.write(`${historyLines.join('\n')}\n`)

    if (this.activeTurn) {
      this.renderActiveTurn(redrawOutput)
    } else if (this.pendingPrompt) {
      this.renderPrompt(redrawOutput)
    } else {
      redrawOutput.write('\x1b[?25h')
    }

    bufferedOutput.flushTo(this.output)
  }

  private stopCompactionSpinner(): void {
    if (!this.compactionTimer) return
    clearInterval(this.compactionTimer)
    this.compactionTimer = null
  }

  private renderCompactionLine(): string | null {
    if (!this.compactionState) return null
    if (this.compactionState.phase === 'compacting') {
      return ` ${colors.accent}${getThinkingSpinnerFrame(this.compactionFrameIndex)}${colors.reset} ${colors.subtle}Compacting${colors.reset}`
    }
    return ` ${colors.success}✓${colors.reset} ${colors.subtle}Compacted${colors.reset}`
  }

  private renderPrompt(outputOverride?: TerminalOutput): void {
    if (!this.pendingPrompt) return
    if (outputOverride === undefined && this.resizeRedrawPending) return
    const redrawOutput = outputOverride ?? (this.usesProcessOutput && process.stdout.isTTY
      ? new TerminalOutputBuffer()
      : this.output)
    const ownsOutputBuffer = outputOverride === undefined && redrawOutput instanceof TerminalOutputBuffer
    redrawOutput.write('\x1b[?25l')
    const panelWidth = getTerminalPanelWidth()
    const composerWidth = Math.max(1, panelWidth - 6)
    const visualLines = getComposerVisualLines(this.composer, composerWidth)
    const cursor = getComposerCursorPosition(this.composer, composerWidth)
    const panel = renderPromptPanel({
      visualLines: visualLines.map((line) => line.text),
      placeholder: this.view.session.mode === 'plan' ? 'Plan mode · ask for an approach...' : 'Ask TideCode to inspect or change your workspace...',
      completionItems: this.view.completionItems,
      completionIndex: this.view.completionIndex,
      composerWidth,
      cursorColumn: cursor.column,
      cursorRow: cursor.lineIndex,
      statusLine: renderTerminalComposerStatus({
        ...this.composerStatus,
        mode: this.view.session.mode,
        model: this.view.session.model,
      }, panelWidth),
    })
    const compactionLine = this.renderCompactionLine()
    const promptLines = compactionLine ? [compactionLine, '', ...panel.lines] : panel.lines
    const promptCursorRow = panel.cursorRow + (compactionLine ? 2 : 0)
    const cursorIsAtTop = this.renderedPromptLines.length > 0
    if (!cursorIsAtTop) {
      redrawOutput.write(promptLines.join('\n'))
    } else {
      redrawOutput.moveCursor(0, -this.renderedPromptCursorRow)
      redrawOutput.cursorTo(0)
      updateTerminalRegion(this.renderedPromptLines, promptLines, redrawOutput)
    }
    this.renderedPromptRows = promptLines.length
    this.renderedPromptLines = promptLines
    this.renderedPromptCursorRow = promptCursorRow
    if (cursorIsAtTop) {
      if (promptCursorRow > 0) redrawOutput.moveCursor(0, promptCursorRow)
    } else {
      const cursorOffsetFromBottom = promptLines.length - 1 - promptCursorRow
      if (cursorOffsetFromBottom > 0) redrawOutput.moveCursor(0, -cursorOffsetFromBottom)
    }
    redrawOutput.cursorTo(panel.cursorColumn)
    redrawOutput.write('\x1b[6 q\x1b[?25h')
    if (ownsOutputBuffer && redrawOutput instanceof TerminalOutputBuffer) redrawOutput.flushTo(this.output)
  }
}
