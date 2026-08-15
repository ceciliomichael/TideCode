import { padVisible, stripAnsi as stripAnsiText, truncateVisible, visibleWidth, wrapVisible } from './terminalText'
import { TIDECODE_VERSION } from '../appVersion'

export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Standard Colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright Colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Semantic palette
  // These 256-color approximations mirror TideCode's dark desktop theme.
  accent: '\x1b[38;5;109m',
  foreground: '\x1b[38;5;254m',
  muted: '\x1b[38;5;250m',
  subtle: '\x1b[38;5;246m',
  separator: '\x1b[38;5;237m',
  success: '\x1b[38;5;114m',
  warning: '\x1b[38;5;179m',
  danger: '\x1b[38;5;209m',
  info: '\x1b[38;5;117m',

  // Background Colors
  bgCyan: '\x1b[46m',
  bgBlue: '\x1b[44m',
  bgDark: '\x1b[100m',
  bgContainer: '\x1b[48;5;236m', // Sleek dark charcoal background for input bar
  bgContainerDim: '\x1b[48;5;235m',
}

const defaultColorValues = { ...colors }

export function setColorEnabled(enabled: boolean): void {
  for (const key of Object.keys(defaultColorValues) as (keyof typeof colors)[]) {
    colors[key] = enabled ? defaultColorValues[key] : ''
  }
}

export function stripAnsi(text: string): string {
  return stripAnsiText(text)
}

export function getTerminalWidth(): number {
  // Leave two columns unused so a panel border never lands in the terminal's
  // wrap-pending column, which is especially important while Windows Terminal
  // or cmd.exe is being resized or zoomed.
  return Math.max(20, (process.stdout.columns || 100) - 2)
}

export function renderBanner() {
  console.log(`${colors.accent}${colors.bold}TideCode${colors.reset} ${colors.subtle}workspace agent${colors.reset}`)
}

export function renderBoxMessage(title: string, message: string, color = colors.accent) {
  const width = getTerminalWidth()
  const innerWidth = Math.max(1, width - 4)
  const titleText = truncateVisible(title, innerWidth - 2)
  console.log(`\n${color}┌─ ${colors.bold}${titleText}${colors.reset}${color} ${'─'.repeat(Math.max(1, width - visibleWidth(titleText) - 5))}┐${colors.reset}`)
  message.split('\n').flatMap((mLine) => wrapVisible(mLine, innerWidth)).forEach((mLine) => {
    console.log(`${color}│${colors.reset} ${padVisible(mLine, innerWidth)} ${color}│${colors.reset}`)
  })
  console.log(`${color}└${'─'.repeat(Math.max(1, width - 2))}┘${colors.reset}\n`)
}

export function renderSessionHeader(session: {
  workspace: string
  model: string
  provider: string
  mode?: string
}) {
  const width = getTerminalWidth()
  const innerWidth = width - 4

  const formatLine = (left: string, right = '') => {
    const leftLen = stripAnsi(left).length
    const rightLen = stripAnsi(right).length
    const padding = Math.max(1, innerWidth - leftLen - rightLen)
    return `${left}${' '.repeat(padding)}${right}`
  }

  const providerDisplay = session.provider.startsWith('custom:') ? 'custom' : session.provider
  const isPlan = session.mode === 'plan'
  const modeBadge = isPlan ? `${colors.warning}[plan]${colors.reset}` : `${colors.success}[agent]${colors.reset}`
  const titleText = `⚡ TideCode (v${TIDECODE_VERSION}) ${modeBadge}`
  const titleLen = stripAnsi(titleText).length
  const topDashes = Math.max(2, width - titleLen - 5)

  console.log(`\n${colors.separator}┌─ ${colors.bold}${colors.accent}${titleText}${colors.reset}${colors.separator} ${'─'.repeat(topDashes)}┐${colors.reset}`)
  console.log(`${colors.separator}│${colors.reset}  ${formatLine(`${colors.subtle}directory:${colors.reset} ${colors.foreground}${session.workspace}${colors.reset}`)}  ${colors.separator}│${colors.reset}`)
  console.log(`${colors.separator}│${colors.reset}  ${formatLine(`${colors.subtle}model:    ${colors.reset} ${colors.foreground}${session.model}${colors.reset} ${colors.warning}[${providerDisplay}]${colors.reset}`, `${colors.accent}/model${colors.subtle} to switch catalog${colors.reset}`)}  ${colors.separator}│${colors.reset}`)
  console.log(`${colors.separator}└${'─'.repeat(width - 2)}┘${colors.reset}\n`)
}

export class TerminalSpinner {
  private timer: NodeJS.Timeout | null = null
  private frameIndex = 0
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  private message = ''

  start(message: string) {
    this.stop()
    this.message = message
    this.frameIndex = 0

    if (!process.stdout.isTTY) {
      console.log(`[..] ${message}`)
      return
    }

    this.timer = setInterval(() => {
      const frame = this.frames[this.frameIndex]
      this.frameIndex = (this.frameIndex + 1) % this.frames.length
      process.stdout.write(`\r\x1b[2K${colors.accent}${frame}${colors.reset} ${colors.subtle}${this.message}${colors.reset}`)
    }, 80)
    this.timer.unref()
  }

  stop(finalMessage?: string, prefix = '[OK]') {
    const hadLiveOutput = this.timer !== null || this.message.length > 0
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    if (hadLiveOutput && process.stdout.isTTY) {
      process.stdout.write('\r\x1b[2K')
    }
    this.message = ''

    if (finalMessage) {
      console.log(`${colors.success}${prefix}${colors.reset} ${finalMessage}`)
    }
  }

  fail(errorMessage: string) {
    this.stop()
    console.log(`  ${colors.danger}✖${colors.reset} ${errorMessage}`)
  }
}

export function renderDiffLines(diffText: string): string[] {
  if (!diffText.trim()) {
    return [`${colors.dim}  No differences detected.${colors.reset}`]
  }

  return diffText.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return `${colors.bold}${colors.accent}${line}${colors.reset}`
    }
    if (line.startsWith('@@')) return `${colors.info}${line}${colors.reset}`
    if (line.startsWith('+')) return `${colors.success}${line}${colors.reset}`
    if (line.startsWith('-')) return `${colors.danger}${line}${colors.reset}`
    return `${colors.subtle}${line}${colors.reset}`
  })
}

export function renderDiff(diffText: string) {
  for (const line of renderDiffLines(diffText)) console.log(line)
}
