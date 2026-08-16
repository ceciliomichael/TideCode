import { colors, getTerminalWidth } from './renderer'

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch',
  'case', 'break', 'continue', 'default', 'import', 'export', 'from', 'class', 'extends',
  'interface', 'type', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'new',
  'this', 'super', 'null', 'undefined', 'true', 'false', 'def', 'self',
  'public', 'private', 'protected', 'readonly', 'static', 'enum', 'package', 'go',
  'struct', 'func', 'select', 'chan', 'defer',
])

export function highlightCodeLine(line: string): string {
  return line
    .replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g, `${colors.gray}$1${colors.reset}`)
    .replace(/(['"`])(.*?)\1/g, `${colors.green}$1$2$1${colors.reset}`)
    .replace(/\b(\d+(\.\d+)?)\b/g, `${colors.yellow}$1${colors.reset}`)
    .replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
      if (KEYWORDS.has(match)) {
        return `${colors.magenta}${match}${colors.reset}`
      }
      return match
    })
}

function formatNonCodeMarkdown(text: string): string {
  return text
    // Bold **text** or __text__ first
    .replace(/\*\*([^*]+)\*\*/g, `${colors.bold}${colors.foreground}$1${colors.reset}`)
    .replace(/__([^_]+)__/g, `${colors.bold}${colors.foreground}$1${colors.reset}`)
    // Italic *text* or _text_
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `${colors.italic}$1${colors.reset}`)
    .replace(/(?<!_)_([^_]+)_(?!_)/g, `${colors.italic}$1${colors.reset}`)
    // Markdown Links [title](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${colors.accent}$1${colors.reset} ${colors.subtle}($2)${colors.reset}`)
}

export function formatInlineMarkdown(text: string): string {
  if (!text) return ''

  return text
    .split(/(`[^`]+`)/g)
    .map((segment) => {
      if (segment.startsWith('`') && segment.endsWith('`')) {
        return `${colors.info}${segment.slice(1, -1)}${colors.reset}`
      }
      return formatNonCodeMarkdown(segment)
    })
    .join('')
}

export class StreamingTerminalMarkdown {
  private lineBuffer = ''
  private inCodeBlock = false
  private codeBlockLang = ''

  append(delta: string) {
    // If not in a code block and delta doesn't contain a code fence:
    // Stream tokens directly to stdout for instant, fluid word-by-word streaming!
    if (!this.inCodeBlock && !delta.includes('```') && this.lineBuffer.length === 0) {
      process.stdout.write(delta)
      return
    }

    // Inside code blocks or across code fences, buffer to render clean syntax-highlighted blocks
    this.lineBuffer += delta
    const lines = this.lineBuffer.split(/\r?\n/)
    this.lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      this.renderCompleteLine(line)
    }
  }

  finish() {
    if (this.lineBuffer.length > 0) {
      if (this.inCodeBlock) {
        process.stdout.write(`${colors.gray}│${colors.reset} ${highlightCodeLine(this.lineBuffer)}\n`)
      } else {
        process.stdout.write(this.lineBuffer)
      }
      this.lineBuffer = ''
    }

    if (this.inCodeBlock) {
      const width = getTerminalWidth()
      process.stdout.write(`${colors.gray}└${'─'.repeat(width - 2)}┘${colors.reset}\n`)
      this.inCodeBlock = false
    }
  }

  private renderCompleteLine(line: string) {
    const width = getTerminalWidth()
    const trimmed = line.trim()

    // Check Code Block Delimiter
    const codeMatch = /^```(\w*)/.exec(trimmed)
    if (codeMatch) {
      if (!this.inCodeBlock) {
        this.inCodeBlock = true
        this.codeBlockLang = codeMatch[1] || 'code'
        const tag = `[ ${this.codeBlockLang} ]`
        const header = `${colors.gray}┌─ ${colors.cyan}${tag}${colors.gray} ${'─'.repeat(Math.max(2, width - tag.length - 6))}┐${colors.reset}\n`
        process.stdout.write(header)
        return
      } else {
        this.inCodeBlock = false
        const footer = `${colors.gray}└${'─'.repeat(width - 2)}┘${colors.reset}\n`
        process.stdout.write(footer)
        return
      }
    }

    // Inside Code Block
    if (this.inCodeBlock) {
      process.stdout.write(`${colors.gray}│${colors.reset} ${highlightCodeLine(line)}\n`)
      return
    }

    // Outside code block, print line
    process.stdout.write(line + '\n')
  }
}
