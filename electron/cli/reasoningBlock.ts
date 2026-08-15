import readline from 'node:readline'
import { colors } from './renderer'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export class TerminalReasoningBlock {
  private startTime = 0
  private timer: NodeJS.Timeout | null = null
  private frameIndex = 0
  private isActive = false
  private reasoningBuffer = ''
  private renderedLineCount = 0

  start() {
    if (this.isActive) return
    this.isActive = true
    this.startTime = Date.now()
    this.reasoningBuffer = ''
    this.renderedLineCount = 0
    this.frameIndex = 0

    if (process.stdout.isTTY) {
      this.timer = setInterval(() => {
        this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length
        this.renderLiveHeader()
      }, 80)
      this.timer.unref()
    }

    this.renderLiveHeader()
  }

  appendDelta(delta: string) {
    if (!this.isActive) {
      this.start()
    }
    this.reasoningBuffer += delta
    this.renderLive()
  }

  complete(): number {
    if (!this.isActive) return 0
    this.isActive = false

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    const durationSec = Math.max(0.1, (Date.now() - this.startTime) / 1000)

    // Clear live thinking lines and swap with the compact Thought for duration summary
    if (process.stdout.isTTY && this.renderedLineCount > 0) {
      readline.moveCursor(process.stdout, 0, -this.renderedLineCount)
      readline.cursorTo(process.stdout, 0)
      readline.clearScreenDown(process.stdout)
      this.renderedLineCount = 0
    }

    // Print the clean collapsed badge with subtle indentation
    console.log(`  ${colors.dim}Thought for ${durationSec.toFixed(1)}s${colors.reset}`)
    return durationSec
  }

  private renderLiveHeader() {
    if (!this.isActive || !process.stdout.isTTY) return

    const frame = SPINNER_FRAMES[this.frameIndex]
    process.stdout.write(`\r\x1b[2K${colors.brightCyan}${frame}${colors.reset} ${colors.dim}Thinking...${colors.reset}`)
  }

  private renderLive() {
    if (!this.isActive || !process.stdout.isTTY) return

    // Clear previous live block
    if (this.renderedLineCount > 0) {
      readline.moveCursor(process.stdout, 0, -this.renderedLineCount)
      readline.cursorTo(process.stdout, 0)
      readline.clearScreenDown(process.stdout)
    }

    const frame = SPINNER_FRAMES[this.frameIndex]
    const width = Math.min(process.stdout.columns || 80, 80)
    const header = `${colors.brightCyan}${frame}${colors.reset} ${colors.dim}Thinking...${colors.reset}`

    const snippetLines = this.reasoningBuffer.split(/\r?\n/).slice(-3)
    const previewLines = [header]

    for (const sLine of snippetLines) {
      if (sLine.trim().length > 0) {
        previewLines.push(`  ${colors.dim}${colors.italic}${sLine.slice(0, width - 4)}${colors.reset}`)
      }
    }

    process.stdout.write(previewLines.join('\n'))
    this.renderedLineCount = previewLines.length - 1
  }
}
