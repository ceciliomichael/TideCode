import { colors } from './renderer'

export const THINKING_STATUS_MESSAGES = [
  'I am working on it',
  'Almost there',
  'Still working on your request',
  'Finishing this up',
] as const

export const THINKING_STATUS_ROTATION_INTERVAL_MS = 5000
export const THINKING_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
export const THINKING_SPINNER_INTERVAL_MS = 80

export function getThinkingSpinnerFrame(index: number): string {
  return THINKING_SPINNER_FRAMES[
    ((index % THINKING_SPINNER_FRAMES.length) + THINKING_SPINNER_FRAMES.length) % THINKING_SPINNER_FRAMES.length
  ]
}

export function getThinkingStatusMessage(index: number): string {
  return THINKING_STATUS_MESSAGES[
    ((index % THINKING_STATUS_MESSAGES.length) + THINKING_STATUS_MESSAGES.length) % THINKING_STATUS_MESSAGES.length
  ]
}

export class TerminalThinkingIndicator {
  private timer: NodeJS.Timeout | null = null
  private messageTimer: NodeJS.Timeout | null = null
  private frameIndex = 0
  private messageIndex = 0
  private isRunning = false
  private customText: string | null = null
  private fallbackRendered = false

  start(initialText?: string) {
    if (this.isRunning) return
    this.isRunning = true
    this.customText = initialText || null
    this.frameIndex = 0
    this.messageIndex = 0

    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % THINKING_SPINNER_FRAMES.length
      this.render()
    }, THINKING_SPINNER_INTERVAL_MS)
    this.timer.unref()

    this.messageTimer = setInterval(() => {
      if (!this.customText) {
        this.messageIndex = (this.messageIndex + 1) % THINKING_STATUS_MESSAGES.length
        this.render()
      }
    }, THINKING_STATUS_ROTATION_INTERVAL_MS)
    this.messageTimer.unref()

    this.render()
  }

  setText(text: string | null) {
    this.customText = text
    this.render()
  }

  stop() {
    if (!this.isRunning) return
    this.isRunning = false

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.messageTimer) {
      clearInterval(this.messageTimer)
      this.messageTimer = null
    }

    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[2K')
    }
    this.fallbackRendered = false
  }

  private render() {
    if (!this.isRunning) return

    const frame = getThinkingSpinnerFrame(this.frameIndex)
    const text = this.customText || getThinkingStatusMessage(this.messageIndex)
    if (!process.stdout.isTTY) {
      if (!this.fallbackRendered) {
        process.stdout.write(`${colors.accent}${frame}${colors.reset} ${colors.subtle}${text}${colors.reset}\n`)
        this.fallbackRendered = true
      }
      return
    }

    process.stdout.write(
      `\r\x1b[2K${colors.accent}${frame}${colors.reset} ${colors.subtle}${text}${colors.reset}`,
    )
  }
}
