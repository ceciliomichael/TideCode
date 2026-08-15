import { colors, getTerminalWidth } from './renderer'
import { formatInlineMarkdown } from './terminalMarkdown'
import type { ChatMode } from '../../src/types/chat'
import { formatThoughtDuration } from './terminalDuration'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const SPLASH_MESSAGES = [
  'Thinking',
  'Analyzing context',
  'Inspecting workspace',
  'Preparing response',
]

type ProgressState = 'idle' | 'waiting' | 'reasoning' | 'tool' | 'content'

export interface ProgressPresenterOptions {
  mode?: ChatMode
  modelId?: string
  providerId?: string
}

export class TerminalProgressPresenter {
  private state: ProgressState = 'idle'
  private timer: NodeJS.Timeout | null = null
  private splashTimer: NodeJS.Timeout | null = null
  private frameIndex = 0
  private splashIndex = 0
  private customText: string | null = null

  private reasoningStartTime = 0
  private reasoningBuffer = ''
  private hasPrintedThoughtForTurn = false
  private options: ProgressPresenterOptions

  constructor(options: ProgressPresenterOptions = {}) {
    this.options = options
  }

  updateSession(options: Partial<ProgressPresenterOptions>) {
    this.options = { ...this.options, ...options }
  }

  startWaiting(initialText?: string) {
    if (this.state === 'content') return

    this.cleanupLiveDisplay()
    this.state = 'waiting'
    this.customText = initialText || null
    this.frameIndex = 0
    this.splashIndex = 0

    this.ensureTimerRunning()
    this.renderSingleRow()
  }

  appendReasoningDelta(delta: string) {
    if (this.state === 'content') return

    if (this.state !== 'reasoning') {
      this.cleanupLiveDisplay()
      this.state = 'reasoning'
      this.reasoningStartTime = Date.now()
      this.reasoningBuffer = ''
      this.ensureTimerRunning()
    }

    this.reasoningBuffer += delta
    this.renderSingleRow()
  }

  completeReasoning() {
    if (this.state !== 'reasoning' && this.reasoningBuffer.length === 0) {
      return
    }

    const durationSec = Math.max(0.1, (Date.now() - (this.reasoningStartTime || Date.now())) / 1000)

    this.cleanupLiveDisplay()
    this.state = 'idle'
    this.stopTimer()

    if (!this.hasPrintedThoughtForTurn) {
      this.hasPrintedThoughtForTurn = true
      process.stdout.write(`  ${colors.dim}Thought for ${formatThoughtDuration(durationSec)}${colors.reset}\n`)
    }

    this.reasoningBuffer = ''
  }

  onToolStart() {
    this.completeReasoning()
    this.cleanupLiveDisplay()
    this.state = 'tool'
    this.stopTimer()
  }

  onToolCompleted() {
    this.cleanupLiveDisplay()
    this.state = 'idle'
    this.stopTimer()
    this.startWaiting()
  }

  onContentStart() {
    this.completeReasoning()
    this.cleanupLiveDisplay()
    this.state = 'content'
    this.stopTimer()
  }

  stop() {
    this.stopTimer()
    if (this.state === 'waiting' || this.state === 'reasoning') {
      this.cleanupLiveDisplay()
    }
    this.state = 'idle'
  }

  private ensureTimerRunning() {
    if (this.timer) return

    if (process.stdout.isTTY) {
      this.timer = setInterval(() => {
        this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length
        if (this.state === 'waiting' || this.state === 'reasoning') {
          this.renderSingleRow()
        }
      }, 80)
      this.timer.unref()

      this.splashTimer = setInterval(() => {
        if (this.state === 'waiting' && !this.customText) {
          this.splashIndex = (this.splashIndex + 1) % SPLASH_MESSAGES.length
          this.renderSingleRow()
        }
      }, 3000)
      this.splashTimer.unref()
    }
  }

  private stopTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.splashTimer) {
      clearInterval(this.splashTimer)
      this.splashTimer = null
    }
  }

  cleanupLiveDisplay() {
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[2K')
    }
  }

  private renderSingleRow() {
    if (!process.stdout.isTTY || (this.state !== 'waiting' && this.state !== 'reasoning')) return

    const width = getTerminalWidth()
    const frame = SPINNER_FRAMES[this.frameIndex]

    if (this.state === 'reasoning') {
      const nonBlank = this.reasoningBuffer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const latestSnippet = nonBlank.length > 0 ? nonBlank[nonBlank.length - 1] : ''
      const snippetFormatted = latestSnippet
        ? ` ${colors.dim}${colors.italic}${formatInlineMarkdown(latestSnippet.slice(0, Math.max(10, width - 26)))}${colors.reset}`
        : ''

      process.stdout.write(
        `\r\x1b[2K  ${colors.brightCyan}${frame}${colors.reset} ${colors.dim}Thinking...${colors.reset}${snippetFormatted}`,
      )
    } else {
      const text = this.customText || SPLASH_MESSAGES[this.splashIndex]
      process.stdout.write(
        `\r\x1b[2K  ${colors.brightCyan}${frame}${colors.reset} ${colors.dim}${text}...${colors.reset}`,
      )
    }
  }
}
