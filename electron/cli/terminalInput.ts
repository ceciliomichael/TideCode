import type readline from 'node:readline'

const WIN32_INPUT_RECORD_REGEX = /^\x1b\[(\d+);(\d+);(\d+);([01]);(\d+);(\d+)_/u
const WIN32_INPUT_RECORD_PREFIX_REGEX = /^\x1b\[\d*(?:;\d*){0,5}$/u

const WIN32_CONTROL_STATE = {
  rightAlt: 0x01,
  leftAlt: 0x02,
  rightCtrl: 0x04,
  leftCtrl: 0x08,
  shift: 0x10,
} as const

const WIN32_VIRTUAL_KEY_NAMES = new Map<number, string>([
  [0x08, 'backspace'],
  [0x09, 'tab'],
  [0x0d, 'return'],
  [0x1b, 'escape'],
  [0x21, 'pageup'],
  [0x22, 'pagedown'],
  [0x23, 'end'],
  [0x24, 'home'],
  [0x25, 'left'],
  [0x26, 'up'],
  [0x27, 'right'],
  [0x28, 'down'],
  [0x2d, 'insert'],
  [0x2e, 'delete'],
])

const CLIPBOARD_PASTE_SEQUENCES = new Set([
  '\x1b[118;3u',
  '\x1b[118;5u',
  '\x1b[118;6u',
  '\x1b[86;3u',
  '\x1b[86;5u',
  '\x1b[86;6u',
])

export type TerminalInputAction =
  | { type: 'insert'; text: string }
  | { type: 'paste-clipboard' }
  | { type: 'submit' }
  | { type: 'alternate-submit' }
  | { type: 'cancel' }
  | { type: 'toggle-mode' }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'newline' }
  | { type: 'move-left' }
  | { type: 'move-right' }
  | { type: 'move-up' }
  | { type: 'move-down' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'word-left' }
  | { type: 'word-right' }
  | { type: 'history-previous' }
  | { type: 'history-next' }
  | { type: 'page-up' }
  | { type: 'page-down' }
  | { type: 'scroll-top' }
  | { type: 'scroll-bottom' }

function isModifiedEnterSequence(input: string): boolean {
  if (input === '\n' || input === '\x1b\r') return true

  const kittyMatch = /^\x1b\[13;(\d+)u$/u.exec(input)
  if (kittyMatch) return Number(kittyMatch[1]) > 1

  const modifyOtherKeysMatch = /^\x1b\[27;(\d+);13~$/u.exec(input)
  return modifyOtherKeysMatch ? Number(modifyOtherKeysMatch[1]) > 1 : false
}

function getWin32KeyName(virtualKey: number, unicodeCodePoint: number): string | undefined {
  const namedKey = WIN32_VIRTUAL_KEY_NAMES.get(virtualKey)
  if (namedKey) return namedKey
  if (virtualKey >= 0x41 && virtualKey <= 0x5a) return String.fromCharCode(virtualKey + 0x20)
  if (virtualKey >= 0x30 && virtualKey <= 0x39) return String.fromCharCode(virtualKey)

  if (unicodeCodePoint > 0) {
    const character = String.fromCodePoint(unicodeCodePoint)
    return /^[a-z0-9]$/iu.test(character) ? character.toLowerCase() : undefined
  }
  return undefined
}

function appendDecodedAction(actions: TerminalInputAction[], action: TerminalInputAction, repeatCount: number): void {
  const repeats = Math.max(1, repeatCount)
  if (action.type === 'insert') {
    const repeatedText = action.text.repeat(repeats)
    const previous = actions.at(-1)
    if (previous?.type === 'insert') {
      previous.text += repeatedText
    } else {
      actions.push({ type: 'insert', text: repeatedText })
    }
    return
  }

  for (let index = 0; index < repeats; index += 1) actions.push(action)
}

export class Win32TerminalInputDecoder {
  private buffer = ''

  reset(): void {
    this.buffer = ''
  }

  consume(input: string): { actions: TerminalInputAction[]; consumed: boolean } {
    this.buffer += input
    const actions: TerminalInputAction[] = []
    let consumed = false

    while (this.buffer.length > 0) {
      const match = WIN32_INPUT_RECORD_REGEX.exec(this.buffer)
      if (!match) {
        if (WIN32_INPUT_RECORD_PREFIX_REGEX.test(this.buffer)) {
          return { actions, consumed: true }
        }
        this.buffer = ''
        return { actions, consumed }
      }

      consumed = true
      this.buffer = this.buffer.slice(match[0].length)
      const virtualKey = Number(match[1])
      const unicodeCodePoint = Number(match[3])
      const isKeyDown = match[4] === '1'
      const controlState = Number(match[5])
      const repeatCount = Number(match[6])
      if (!isKeyDown || virtualKey === 0x10 || virtualKey === 0x11 || virtualKey === 0x12) continue

      const ctrl = (controlState & (WIN32_CONTROL_STATE.leftCtrl | WIN32_CONTROL_STATE.rightCtrl)) !== 0
      const meta = (controlState & (WIN32_CONTROL_STATE.leftAlt | WIN32_CONTROL_STATE.rightAlt)) !== 0
      const shift = (controlState & WIN32_CONTROL_STATE.shift) !== 0
      const inputText = unicodeCodePoint > 0 ? String.fromCodePoint(unicodeCodePoint) : ''
      const key: readline.Key = {
        ctrl,
        meta,
        name: getWin32KeyName(virtualKey, unicodeCodePoint),
        sequence: inputText,
        shift,
      }
      const action = getTerminalInputAction(inputText, key)
      if (action) appendDecodedAction(actions, action, repeatCount)
    }

    return { actions, consumed }
  }
}

export function getTerminalInputAction(input: string, key: readline.Key | undefined): TerminalInputAction | null {
  if (input === '\u0003' || (key?.ctrl && key.name === 'c')) return { type: 'cancel' }
  if (input === '\u0004' || (key?.ctrl && key.name === 'd')) return { type: 'delete' }
  if (input === '\u001b' || key?.name === 'escape') return { type: 'cancel' }

  if (
    input === '\u0016' ||
    input === '\u001bv' ||
    input === '\x16' ||
    input === '\x1bv' ||
    CLIPBOARD_PASTE_SEQUENCES.has(input) ||
    (key?.ctrl && (key.name === 'v' || key.sequence === '\u0016' || key.sequence === '\x16')) ||
    (key?.meta && (key.name === 'v' || key.sequence === '\u001bv' || key.sequence === '\x1bv')) ||
    (key?.name === 'insert' && key.shift)
  ) {
    return { type: 'paste-clipboard' }
  }

  if (key?.ctrl && key.name === 'home') return { type: 'scroll-top' }
  if (key?.ctrl && key.name === 'end') return { type: 'scroll-bottom' }
  if (key?.ctrl && key.name === 'a') return { type: 'home' }
  if (key?.ctrl && key.name === 'e') return { type: 'end' }
  if (key?.ctrl && key.name === 'u') return { type: 'word-left' }
  if (key?.ctrl && key.name === 'k') return { type: 'word-right' }
  if (key?.ctrl && key.name === 'l') return { type: 'scroll-bottom' }

  if (key?.shift && key.name === 'tab') return { type: 'toggle-mode' }
  if (key?.name === 'tab') return { type: 'alternate-submit' }
  if (isModifiedEnterSequence(input)) return { type: 'newline' }
  if (key?.name === 'return' || key?.name === 'enter') {
    return key.ctrl || key.shift || key.meta ? { type: 'newline' } : { type: 'submit' }
  }
  if (input === '\r') return { type: 'submit' }
  if (key?.name === 'backspace') return { type: 'backspace' }
  if (key?.name === 'delete') return { type: 'delete' }
  if (key?.name === 'left') return key.ctrl ? { type: 'word-left' } : { type: 'move-left' }
  if (key?.name === 'right') return key.ctrl ? { type: 'word-right' } : { type: 'move-right' }
  if (key?.name === 'up') return { type: 'move-up' }
  if (key?.name === 'down') return { type: 'move-down' }
  if (key?.name === 'home') return { type: 'home' }
  if (key?.name === 'end') return { type: 'end' }
  if (key?.name === 'pageup') return { type: 'page-up' }
  if (key?.name === 'pagedown') return { type: 'page-down' }

  if (input && (input.startsWith('\x1b[200~') || input.includes('\x1b[200~'))) {
    const cleanText = input.split('\x1b[200~').join('').split('\x1b[201~').join('')
    return { type: 'insert', text: cleanText }
  }

  if (input && input.length > 0 && !key?.ctrl && !key?.meta) {
    return { type: 'insert', text: input }
  }

  return null
}
