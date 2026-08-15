import { randomUUID } from 'node:crypto'
import readline from 'node:readline'
import type { ChatMode } from '../../src/types/chat'
import {
  applyComposerAction,
  composerText,
  createComposerState,
  getComposerCursorPosition,
  getComposerVisualLines,
  recordComposerHistory,
  type ComposerState,
} from './composer'
import { interactiveConfirm, interactiveSelect, type SelectOptions } from './interactiveSelect'
import { interactiveChecklist, type ChecklistOptions } from './interactiveChecklist'
import { createActiveTurnPromptPanel, renderActiveTurn as renderActiveTurnView, renderCommittedTurn, renderConversationHistory } from './terminalActiveTurn'
import { TerminalLifecycle } from './terminalLifecycle'
import { getTerminalInputAction, type TerminalInputAction } from './terminalInput'
import { colors, renderDiffLines, stripAnsi } from './renderer'
import { StreamingTerminalMarkdown } from './terminalMarkdown'
import { getTerminalPanelWidth, renderPromptPanel, renderSessionPanel } from './terminalPanels'
import { clearTerminalRegion, updateTerminalRegion } from './terminalRedraw'
import { processTerminalOutput, type TerminalOutput } from './terminalOutput'
import {
  getThinkingSpinnerFrame,
  TerminalThinkingIndicator,
  THINKING_SPINNER_FRAMES,
  THINKING_SPINNER_INTERVAL_MS,
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

let activeTerminalScreen: TerminalScreen | null = null
const CLEAR_TERMINAL_SEQUENCE = '\x1b[2J\x1b[3J\x1b[H'

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

interface PendingPrompt {
  context: TerminalPromptContext
  resolve: (value: string) => void
}

export class TerminalScreen {
  private readonly lifecycle = new TerminalLifecycle()
  private readonly history: string[] = []
  private readonly thinkingIndicator = new TerminalThinkingIndicator()
  private readonly markdown = new StreamingTerminalMarkdown()
  private readonly output: TerminalOutput
  private view: TerminalScreenViewState
  private composer: ComposerState = createComposerState()
  private pendingPrompt: PendingPrompt | null = null
  private renderedPromptRows = 0
  private renderedPromptLines: string[] = []
  private renderedPromptCursorRow = 0
  private activeAssistantId: string | null = null
  private activeThought = ''
  private activeThoughtEntryId: string | null = null
  private activeThoughtDurationSeconds = 0
  private activityLabel = ''
  private hasTurnOutput = false
  private activeTurn = false
  private activeTurnStartIndex = 0
  private activeTurnLines: string[] = []
  private activeTurnCursorRow = 0
  private activeTurnCursorColumn = 0
  private activeTurnActivityRow: number | null = null
  private activeThinkingFrameIndex = 0
  private activeThinkingTimer: NodeJS.Timeout | null = null
  private activeFollowUps: ActiveTurnFollowUpView[] = []
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
    if (this.usesProcessOutput && process.stdout.isTTY) process.stdout.on('resize', this.handleResize)
    this.output.write(CLEAR_TERMINAL_SEQUENCE)
    this.printSessionIntro()
  }

  stop(): void {
    process.stdin.removeListener('keypress', this.handleKeypress)
    this.lifecycle.disableRawInput()
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
  }

  updateComposerStatus(patch: Partial<typeof this.composerStatus>): void {
    this.composerStatus = { ...this.composerStatus, ...patch }
    if (this.pendingPrompt) this.renderCurrentPrompt()
  }

  clearSession(): void {
    this.clearPromptDisplay()
    this.clearActiveTurnDisplay()
    this.stopActivity()
    this.output.write(CLEAR_TERMINAL_SEQUENCE)
    this.view.entries = []
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

  restoreConversation(messages: readonly Message[], sessionPatch: Partial<TerminalSessionView> = {}, clearScreen = false): void {
    this.clearPromptDisplay()
    this.clearActiveTurnDisplay()
    this.stopActivity()
    this.view.session = { ...this.view.session, ...sessionPatch }
    this.view.entries = createTerminalHistoryEntries(messages, this.view.session.workspace)
    this.activeAssistantId = null
    this.activeThought = ''
    this.activeThoughtEntryId = null
    this.activeThoughtDurationSeconds = 0
    this.activeTurn = false
    this.activeTurnStartIndex = 0
    this.activeFollowUps = []

    if (clearScreen) {
      this.output.write(CLEAR_TERMINAL_SEQUENCE)
      this.printSessionIntro()
    }
    const historyLines = renderConversationHistory(this.view.entries)
    if (historyLines.length > 0) this.output.write(`${historyLines.join('\n')}\n`)
  }

  setNotification(level: 'info' | 'success' | 'warning' | 'error', text: string): void {
    this.view.notification = { level, text: stripAnsi(text) }
  }

  addUserMessage(text: string, print = true): void {
    this.view.entries.push({ kind: 'user', id: nextTranscriptId('user'), text })
    if (print) this.output.write(`\n${colors.accent}›${colors.reset} ${text}\n`)
  }

  beginTurn(): void {
    this.activeTurn = true
    this.activeTurnStartIndex = this.view.entries.length
    this.activeTurnLines = []
    this.activeTurnCursorRow = 0
    this.activeTurnCursorColumn = 0
    this.activeTurnActivityRow = null
    this.activeFollowUps = []
    this.activeThought = ''
    this.activeThoughtEntryId = null
    this.activeThoughtDurationSeconds = 0
    this.composer = createComposerState(this.history)
    this.view.completionItems = []
    this.view.completionIndex = 0
    this.setActivity('thinking', 'Thinking')
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
    this.addNotice('info', 'Last turn removed from the active session.')
  }

  setActivity(kind: 'idle' | 'thinking' | 'tool', label: string, detail?: string): void {
    const previousActivity = this.view.activity
    const cleanLabel = stripAnsi(label)
    const detailText = detail ? stripAnsi(detail) : undefined
    this.view.activity = { kind, label: cleanLabel, detail: detailText }
    this.view.isStreaming = kind !== 'idle'
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
      this.thinkingIndicator.setText(cleanLabel || 'Thinking')
      this.thinkingIndicator.start(cleanLabel || 'Thinking')
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
    this.output.write(`\n  ${colors.subtle}Thought for${colors.reset} ${colors.foreground}${durationSeconds.toFixed(1)}s${colors.reset}\n`)
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
      this.stopActivity()
      this.clearActiveTurnDisplay()
      this.output.write(`${renderCommittedTurn(turnEntries).join('\n')}\n`)
      this.activeTurn = false
      this.activeTurnStartIndex = 0
      this.activeTurnLines = []
      this.activeTurnCursorRow = 0
      this.activeTurnCursorColumn = 0
      this.activeTurnActivityRow = null
      this.activeThought = ''
      this.activeThoughtEntryId = null
      this.activeThoughtDurationSeconds = 0
      this.activeAssistantId = null
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
      onReasoningCompleted: (durationSeconds) => this.addThought(durationSeconds, this.activeThought),
      onContentStart: () => {
        this.activeThought = ''
        this.stopActivity()
        this.startAssistant()
      },
      onContentDelta: (delta) => this.appendAssistant(delta),
      onToolStarted: () => undefined,
      onToolCompleted: (label, detail, diff) => {
        this.addTool(label, 'completed', detail, diff)
      },
      onToolFailed: (label, detail) => {
        this.addTool(label, 'failed', detail)
      },
      onCompleted: () => this.finishTurn(),
    }
  }

  async ask(context: TerminalPromptContext): Promise<string> {
    if (!process.stdin.isTTY && this.usesProcessOutput) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      return new Promise((resolve) => {
        rl.question('> ', (answer) => {
          rl.close()
          resolve(answer)
        })
      })
    }

    if (this.pendingPrompt) throw new Error('A terminal prompt is already active.')
    this.updateSession({ mode: context.mode, model: context.modelId, provider: context.providerId })
    this.composer = createComposerState(this.history)
    if (this.usesProcessOutput) {
      this.lifecycle.enableRawInput()
      process.stdin.removeListener('keypress', this.handleKeypress)
      process.stdin.on('keypress', this.handleKeypress)
    }
    this.pendingPrompt = { context, resolve: () => undefined }
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
    this.composer = createComposerState(this.history)
    this.view.completionItems = []
    this.view.completionIndex = 0
    if (this.usesProcessOutput) {
      this.lifecycle.disableRawInput()
      process.stdin.removeListener('keypress', this.handleKeypress)
    }
  }

  async select<T>(options: SelectOptions<T>): Promise<T | null> {
    this.clearPromptDisplay()
    return interactiveSelect(options)
  }

  async checklist<T>(options: ChecklistOptions<T>): Promise<T[] | null> {
    this.clearPromptDisplay()
    return interactiveChecklist(options)
  }

  async confirm(question: string, defaultYes = true): Promise<boolean> {
    this.clearPromptDisplay()
    return interactiveConfirm(question, defaultYes)
  }

  handleInputAction(action: TerminalInputAction): void {
    this.handlePromptAction(action)
  }

  private readonly handleKeypress = (input: string, key: readline.Key) => {
    if (input === '\u0003' || (key.ctrl && key.name === 'c')) {
      if (this.activeTurn && this.pendingPrompt?.context.onCancelTurn) {
        this.pendingPrompt.context.onCancelTurn()
        return
      }
      if (composerText(this.composer).length > 0) {
        this.handlePromptAction({ type: 'cancel' })
        return
      }
      this.stop()
      this.output.write('\n')
      process.exit(0)
    }
    if (!this.pendingPrompt) return
    const action = getTerminalInputAction(input, key)
    if (!action) return
    this.handlePromptAction(action)
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
        pending.context.onCancelTurn?.()
        return
      }
      this.composer = createComposerState(this.history)
      this.updateCompletionItems(pending.context)
      this.renderCurrentPrompt()
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
      const completion = this.view.completionItems[this.view.completionIndex]
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
        process.stdin.removeListener('keypress', this.handleKeypress)
      }
      this.finishPrompt(text)
      resolve(text)
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
    this.history.splice(0, this.history.length, ...recordComposerHistory(this.composer, text).history)
    this.activeFollowUps.push({ behavior, text })
    this.composer = createComposerState(this.history)
    this.view.completionItems = []
    this.view.completionIndex = 0
    pending.context.onActiveMessage?.(text, behavior)
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
    const nextText = `${text.slice(0, start)}${item.value}${appendSpace ? ' ' : ''}${text.slice(cursorIndex)}`
    const next = createComposerState(this.history)
    const lines = nextText.split('\n')
    return { ...next, lines, lineIndex: lines.length - 1, column: lines.at(-1)?.length ?? 0 }
  }

  private applyActionWithPaste(action: TerminalInputAction): ComposerState {
    if (action.type !== 'insert' || !action.text.includes('\n')) return applyComposerAction(this.composer, action)
    let next = this.composer
    for (const character of action.text) {
      next = applyComposerAction(next, character === '\n' ? { type: 'newline' } : { type: 'insert', text: character })
    }
    return next
  }

  private updateCompletionItems(context: TerminalPromptContext): void {
    const cursorIndex = this.composer.lines.slice(0, this.composer.lineIndex).reduce((total, line) => total + line.length + 1, 0) + this.composer.column
    const items = context.getCompletionItems?.(composerText(this.composer), cursorIndex) ?? []
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
    this.activeThinkingTimer = setInterval(() => {
      if (!this.activeTurn || this.view.activity.kind !== 'thinking') {
        this.stopActiveThinkingAnimation()
        return
      }
      this.activeThinkingFrameIndex = (this.activeThinkingFrameIndex + 1) % THINKING_SPINNER_FRAMES.length
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
  }

  private patchActiveThinkingFrame(): void {
    const activityRow = this.activeTurnActivityRow
    if (
      activityRow === null ||
      this.view.activity.kind !== 'thinking' ||
      activityRow >= this.activeTurnLines.length
    ) {
      return
    }

    const nextLine = renderTerminalActivityLine(
      this.view.activity,
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

  private shouldShowActiveComposerCaret(): boolean {
    return this.pendingPrompt !== null && composerText(this.composer).length > 0
  }

  private clearActiveTurnDisplay(): void {
    if (this.activeTurnLines.length === 0) return
    clearTerminalRegion(this.activeTurnLines.length, this.activeTurnCursorRow, this.output)
    this.activeTurnLines = []
    this.activeTurnCursorRow = 0
    this.activeTurnCursorColumn = 0
    this.activeTurnActivityRow = null
  }

  private renderActiveTurn(): void {
    if (!this.activeTurn) return
    const redrawOutput = this.usesProcessOutput && process.stdout.isTTY
      ? new TerminalOutputBuffer()
      : this.output
    redrawOutput.write('\x1b[?25l')
    const panelWidth = getTerminalPanelWidth()
    const composerWidth = Math.max(1, panelWidth - 6)
    const visualLines = getComposerVisualLines(this.composer, composerWidth)
    const cursor = getComposerCursorPosition(this.composer, composerWidth)
    const render = renderActiveTurnView({
      activity: this.view.activity,
      entries: this.view.entries.slice(this.activeTurnStartIndex),
      followUps: this.activeFollowUps,
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
    if (redrawOutput instanceof TerminalOutputBuffer) redrawOutput.flushTo(this.output)
  }

  private printSessionIntro(): void {
    const panel = renderSessionPanel(this.view.session)
    this.output.write(`\n${panel.join('\n')}\n`)
    this.output.write(`${colors.subtle}  /help${colors.reset} ${colors.muted}commands${colors.reset}  ${colors.separator}·${colors.reset}  ${colors.subtle}@${colors.reset} ${colors.muted}files${colors.reset}  ${colors.separator}·${colors.reset}  ${colors.subtle}Shift+Tab${colors.reset} ${colors.muted}mode${colors.reset}\n\n`)
  }

  private clearPromptDisplay(): void {
    if (this.renderedPromptRows === 0) return
    clearTerminalRegion(this.renderedPromptRows, this.renderedPromptCursorRow, this.output)
    this.renderedPromptRows = 0
    this.renderedPromptLines = []
    this.renderedPromptCursorRow = 0
  }

  private finishPrompt(text: string): void {
    this.clearPromptDisplay()
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      const prefix = index === 0 ? `${colors.accent}›${colors.reset} ` : '  '
      this.output.write(`${prefix}${line}\n`)
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

  private readonly handleResize = () => {
    if (this.activeTurn) {
      this.renderActiveTurn()
      return
    }
    if (this.pendingPrompt) this.renderPrompt()
  }

  private renderPrompt(): void {
    if (!this.pendingPrompt) return
    const redrawOutput = this.usesProcessOutput && process.stdout.isTTY
      ? new TerminalOutputBuffer()
      : this.output
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
    const cursorIsAtTop = this.renderedPromptLines.length > 0
    if (!cursorIsAtTop) {
      redrawOutput.write(panel.lines.join('\n'))
    } else {
      redrawOutput.moveCursor(0, -this.renderedPromptCursorRow)
      redrawOutput.cursorTo(0)
      updateTerminalRegion(this.renderedPromptLines, panel.lines, redrawOutput)
    }
    this.renderedPromptRows = panel.lines.length
    this.renderedPromptLines = panel.lines
    this.renderedPromptCursorRow = panel.cursorRow
    if (cursorIsAtTop) {
      if (panel.cursorRow > 0) redrawOutput.moveCursor(0, panel.cursorRow)
    } else {
      const cursorOffsetFromBottom = panel.lines.length - 1 - panel.cursorRow
      if (cursorOffsetFromBottom > 0) redrawOutput.moveCursor(0, -cursorOffsetFromBottom)
    }
    redrawOutput.cursorTo(panel.cursorColumn)
    redrawOutput.write('\x1b[6 q\x1b[?25h')
    if (redrawOutput instanceof TerminalOutputBuffer) redrawOutput.flushTo(this.output)
  }
}
