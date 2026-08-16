import readline from 'node:readline'
import { readSystemClipboardImageOrText } from './cliClipboardImage'
import { BracketedPasteDecoder } from './terminalBracketedPaste'
import { ensureKeypressEvents } from './terminalLifecycle'
import { clearTerminalRegion, updateTerminalRegion } from './terminalRedraw'
import { colors, getTerminalWidth } from './renderer'
import { padVisible, truncateVisible, visibleWidth } from './terminalText'
import type { InteractiveResizeHost } from './interactiveResize'

export interface TextInputOptions {
  title: string
  label?: string
  initialValue?: string
  placeholder?: string
  secret?: boolean
  footer?: string
  validate?: (value: string) => string | null | undefined
}

export interface TextInputFrame {
  lines: string[]
  cursorRow: number
  cursorColumn: number
}

function borderTitle(title: string, width: number): string {
  const cleanTitle = truncateVisible(title, Math.max(1, width - 6))
  const prefix = `╭─ ${cleanTitle} `
  return `${colors.accent}${prefix}${'─'.repeat(Math.max(0, width - visibleWidth(prefix) - 1))}╮${colors.reset}`
}

function borderLine(left: string, right: string, width: number): string {
  return `${colors.separator}${left}${'─'.repeat(Math.max(0, width - 2))}${right}${colors.reset}`
}

function panelRow(content: string, width: number): string {
  const innerWidth = Math.max(1, width - 2)
  const clipped = truncateVisible(content, Math.max(1, innerWidth - 2))
  return `${colors.separator}│${colors.reset} ${padVisible(clipped, Math.max(1, innerWidth - 2))} ${colors.separator}│${colors.reset}`
}

function renderInputValue(
  value: string,
  cursor: number,
  availableWidth: number,
  secret: boolean,
): { text: string; cursorOffset: number } {
  const displayedValue = secret ? '•'.repeat(value.length) : value
  const safeCursor = Math.max(0, Math.min(cursor, displayedValue.length))
  const maxValueWidth = Math.max(1, availableWidth)
  if (displayedValue.length <= maxValueWidth) {
    return { text: displayedValue || `${colors.subtle}type here${colors.reset}`, cursorOffset: safeCursor }
  }

  const windowWidth = Math.max(1, maxValueWidth - 1)
  const start = Math.max(0, Math.min(safeCursor - windowWidth + 1, displayedValue.length - windowWidth))
  const visibleValue = displayedValue.slice(start, start + windowWidth)
  return {
    text: `…${visibleValue}`,
    cursorOffset: 1 + safeCursor - start,
  }
}

export function buildTextInputFrame(
  options: TextInputOptions,
  value: string,
  cursor = value.length,
  errorMessage?: string,
): TextInputFrame {
  const width = getTerminalWidth()
  const label = options.label ? `${options.label}: ` : ''
  const availableWidth = Math.max(1, width - 8 - visibleWidth(label))
  const inputValue = renderInputValue(value, cursor, availableWidth, options.secret === true)
  const valueText = value.length === 0 && options.placeholder
    ? `${colors.subtle}${options.placeholder}${colors.reset}`
    : inputValue.text
  const lines = [
    borderTitle(options.title, width),
    panelRow(`${colors.accent}›${colors.reset} ${label}${valueText}`, width),
  ]
  if (errorMessage) lines.push(panelRow(`${colors.danger}${errorMessage}${colors.reset}`, width))
  if (options.footer) lines.push(panelRow(`${colors.subtle}${options.footer}${colors.reset}`, width))
  lines.push(borderLine('╰', '╯', width))

  return {
    lines,
    cursorRow: 1,
    cursorColumn: Math.min(width - 2, 4 + visibleWidth(label) + inputValue.cursorOffset),
  }
}

function isPasteShortcut(input: string, key: readline.Key): boolean {
  return input === '\u0016' || input === '\u001bv' || input === '\x16' || input === '\x1bv' ||
    (key.ctrl === true && key.name === 'v') ||
    (key.meta === true && key.name === 'v')
}

function insertValue(value: string, cursor: number, text: string): { value: string; cursor: number } {
  const cleanText = text.replace(/[\r\n]/gu, '')
  if (!cleanText) return { value, cursor }
  return {
    value: `${value.slice(0, cursor)}${cleanText}${value.slice(cursor)}`,
    cursor: cursor + cleanText.length,
  }
}

function deletePreviousWord(value: string, cursor: number): { value: string; cursor: number } {
  let nextCursor = cursor
  while (nextCursor > 0 && /\s/u.test(value[nextCursor - 1])) nextCursor -= 1
  while (nextCursor > 0 && !/\s/u.test(value[nextCursor - 1])) nextCursor -= 1
  return {
    value: `${value.slice(0, nextCursor)}${value.slice(cursor)}`,
    cursor: nextCursor,
  }
}

export async function interactiveTextInput(
  options: TextInputOptions,
  resizeHost?: InteractiveResizeHost,
): Promise<string | null> {
  if (!process.stdin.isTTY) {
    const readlineInterface = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise((resolve) => {
      readlineInterface.question(`${options.title}: `, (answer) => {
        readlineInterface.close()
        resolve(answer)
      })
    })
  }

  return new Promise((resolve) => {
    let value = options.initialValue ?? ''
    let cursor = value.length
    let errorMessage: string | undefined
    let renderedLines: string[] = []
    let renderedFrame: TextInputFrame | null = null
    let initialized = false
    let finished = false
    let suppressKeypresses = false
    let suppressionHandle: NodeJS.Immediate | null = null
    const pasteDecoder = new BracketedPasteDecoder()

    const moveCursorToFrame = (frame: TextInputFrame) => {
      readline.moveCursor(process.stdout, 0, frame.cursorRow)
      readline.cursorTo(process.stdout, frame.cursorColumn)
    }

    const render = () => {
      if (finished) return
      const frame = buildTextInputFrame(options, value, cursor, errorMessage)
      if (!initialized) {
        process.stdout.write(`\x1b[?25l${frame.lines.join('\n')}`)
        readline.moveCursor(process.stdout, 0, -(frame.lines.length - 1))
        readline.cursorTo(process.stdout, 0)
        initialized = true
      } else {
        if (renderedFrame) readline.moveCursor(process.stdout, 0, -renderedFrame.cursorRow)
        readline.cursorTo(process.stdout, 0)
        updateTerminalRegion(renderedLines, frame.lines)
      }
      moveCursorToFrame(frame)
      process.stdout.write('\x1b[?25h')
      renderedLines = frame.lines
      renderedFrame = frame
    }

    const redrawAfterResize = () => {
      if (finished) return
      resizeHost?.redrawBackground()
      renderedLines = []
      renderedFrame = null
      initialized = false
      render()
    }

    const finish = (result: string | null) => {
      if (finished) return
      finished = true
      if (suppressionHandle) clearImmediate(suppressionHandle)
      pasteDecoder.reset()
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('keypress', onKeypress)
      resizeHost?.registerResizeHandler(null)
      if (renderedFrame) {
        clearTerminalRegion(renderedLines.length, renderedFrame.cursorRow)
      }
      process.stdout.write('\x1b[?25h\n')
      try {
        process.stdin.setRawMode(false)
      } catch {
        // Some terminal adapters do not expose raw mode on shutdown.
      }
      resolve(result)
    }

    const setValue = (next: { value: string; cursor: number }) => {
      value = next.value
      cursor = next.cursor
      errorMessage = undefined
      render()
    }

    const onData = (data: Buffer | string) => {
      const decoded = pasteDecoder.consume(typeof data === 'string' ? data : data.toString('utf8'))
      if (!decoded.containsPasteSequence) return
      suppressKeypresses = true
      if (!suppressionHandle) {
        suppressionHandle = setImmediate(() => {
          suppressionHandle = null
          suppressKeypresses = false
        })
      }
      for (const pastedText of decoded.pastedTexts) setValue(insertValue(value, cursor, pastedText))
    }

    const onKeypress = (input: string, key: readline.Key) => {
      if (finished || suppressKeypresses || pasteDecoder.isConsuming) return
      if (input === '\u0003' || (key.ctrl === true && key.name === 'c')) {
        finish(null)
        return
      }
      if (input === '\u001b' || key.name === 'escape') {
        finish(null)
        return
      }
      if (isPasteShortcut(input, key)) {
        void readSystemClipboardImageOrText().then((clipboard) => {
          if (clipboard.text && !finished) setValue(insertValue(value, cursor, clipboard.text))
        }).catch(() => undefined)
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        const validationError = options.validate?.(value)
        if (validationError) {
          errorMessage = validationError
          render()
          return
        }
        finish(value)
        return
      }
      if (key.name === 'backspace') {
        if (cursor > 0) setValue({ value: `${value.slice(0, cursor - 1)}${value.slice(cursor)}`, cursor: cursor - 1 })
        return
      }
      if (key.name === 'delete') {
        if (cursor < value.length) setValue({ value: `${value.slice(0, cursor)}${value.slice(cursor + 1)}`, cursor })
        return
      }
      if (key.name === 'left') {
        setValue({ value, cursor: key.ctrl ? Math.max(0, value.lastIndexOf(' ', cursor - 1) + 1) : Math.max(0, cursor - 1) })
        return
      }
      if (key.name === 'right') {
        setValue({ value, cursor: key.ctrl ? Math.min(value.length, value.indexOf(' ', cursor) < 0 ? value.length : value.indexOf(' ', cursor)) : Math.min(value.length, cursor + 1) })
        return
      }
      if (key.name === 'home' || (key.ctrl === true && key.name === 'a')) {
        setValue({ value, cursor: 0 })
        return
      }
      if (key.name === 'end' || (key.ctrl === true && key.name === 'e')) {
        setValue({ value, cursor: value.length })
        return
      }
      if (key.ctrl === true && key.name === 'u') {
        setValue({ value: '', cursor: 0 })
        return
      }
      if (key.ctrl === true && key.name === 'w') {
        setValue(deletePreviousWord(value, cursor))
        return
      }
      if (input && !key.ctrl && !key.meta) setValue(insertValue(value, cursor, input))
    }

    ensureKeypressEvents()
    process.stdin.prependListener('data', onData)
    process.stdin.on('keypress', onKeypress)
    resizeHost?.registerResizeHandler(redrawAfterResize)
    try {
      process.stdin.setRawMode(true)
    } catch {
      finish(null)
      return
    }
    process.stdin.resume()
    render()
  })
}
