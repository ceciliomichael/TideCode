// ANSI control bytes are required here because terminal output is not plain text.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g

const WIDE_CODE_POINT_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
]

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, '')
}

function isWideCodePoint(codePoint: number): boolean {
  return WIDE_CODE_POINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)
}

export function visibleWidth(text: string): number {
  let width = 0
  for (const character of stripAnsi(text)) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint === 0 || codePoint === 0x200b || codePoint === 0x200c || codePoint === 0x200d) {
      continue
    }
    width += isWideCodePoint(codePoint) ? 2 : 1
  }
  return width
}

export function truncateVisible(text: string, maxWidth: number, suffix = '…'): string {
  if (maxWidth <= 0) return ''
  if (visibleWidth(text) <= maxWidth) return text

  const suffixWidth = visibleWidth(suffix)
  if (suffixWidth >= maxWidth) {
    return Array.from(stripAnsi(text)).slice(0, maxWidth).join('')
  }

  let result = ''
  let width = 0
  for (const character of stripAnsi(text)) {
    const characterWidth = isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1
    if (width + characterWidth + suffixWidth > maxWidth) break
    result += character
    width += characterWidth
  }
  return `${result}${suffix}`
}

export function padVisible(text: string, width: number, fill = ' '): string {
  const remaining = Math.max(0, width - visibleWidth(text))
  return `${text}${fill.repeat(remaining)}`
}

export function wrapVisible(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return ['']
  if (text.length === 0) return ['']

  const result: string[] = []
  let line = ''
  let lineWidth = 0

  const pushLine = () => {
    result.push(line)
    line = ''
    lineWidth = 0
  }

  for (const word of text.split(/(\s+)/)) {
    if (word.length === 0) continue
    const wordWidth = visibleWidth(word)

    if (wordWidth > maxWidth) {
      for (const character of word) {
        const characterWidth = isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1
        if (lineWidth + characterWidth > maxWidth && line.length > 0) pushLine()
        line += character
        lineWidth += characterWidth
      }
      continue
    }

    if (lineWidth + wordWidth > maxWidth && line.length > 0) {
      pushLine()
      if (/^\s+$/.test(word)) continue
    }

    line += word
    lineWidth += wordWidth
  }

  if (line.length > 0 || result.length === 0) pushLine()
  return result
}

export function clipAnsiLine(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text
  return truncateVisible(text, maxWidth)
}
