import type { Terminal } from '@xterm/xterm'

export function pasteTextIntoTerminal(
  terminal: Pick<Terminal, 'paste'>,
  text: string,
) {
  if (text.length === 0) {
    return false
  }

  terminal.paste(text)
  return true
}
