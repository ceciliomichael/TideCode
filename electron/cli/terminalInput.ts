import type readline from 'node:readline'

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
  if (key?.name === 'return' || key?.name === 'enter') {
    return key.ctrl || key.shift ? { type: 'newline' } : { type: 'submit' }
  }
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
