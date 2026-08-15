export const BRACKETED_PASTE_START = '\x1b[200~'
export const BRACKETED_PASTE_END = '\x1b[201~'

export interface BracketedPasteChunk {
  pastedTexts: string[]
  containsPasteSequence: boolean
}

function longestPrefixSuffix(value: string, marker: string): string {
  const maximumLength = Math.min(value.length, marker.length - 1)
  for (let length = maximumLength; length > 0; length -= 1) {
    if (value.endsWith(marker.slice(0, length))) return value.slice(-length)
  }
  return ''
}

export function normalizeBracketedPasteText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Decodes terminal bracketed-paste frames without exposing their payload to
 * the regular keypress decoder. Terminals may split the frame markers across
 * multiple data events, so the decoder retains only the active payload and a
 * possible partial start marker between calls.
 */
export class BracketedPasteDecoder {
  private active = false
  private payload = ''
  private partialStartMarker = ''

  consume(data: string): BracketedPasteChunk {
    let remaining = `${this.partialStartMarker}${data}`
    this.partialStartMarker = ''
    const pastedTexts: string[] = []
    let containsPasteSequence = this.active

    while (remaining.length > 0) {
      if (this.active) {
        containsPasteSequence = true
        const endIndex = remaining.indexOf(BRACKETED_PASTE_END)
        if (endIndex < 0) {
          this.payload += remaining
          remaining = ''
          break
        }

        this.payload += remaining.slice(0, endIndex)
        pastedTexts.push(normalizeBracketedPasteText(this.payload))
        this.payload = ''
        this.active = false
        remaining = remaining.slice(endIndex + BRACKETED_PASTE_END.length)
        continue
      }

      const startIndex = remaining.indexOf(BRACKETED_PASTE_START)
      if (startIndex >= 0) {
        containsPasteSequence = true
        this.active = true
        remaining = remaining.slice(startIndex + BRACKETED_PASTE_START.length)
        continue
      }

      const partialMarker = longestPrefixSuffix(remaining, BRACKETED_PASTE_START)
      if (partialMarker) {
        this.partialStartMarker = partialMarker
        containsPasteSequence = true
      }
      break
    }

    return { pastedTexts, containsPasteSequence }
  }

  get isConsuming(): boolean {
    return this.active || this.partialStartMarker.length > 0
  }

  reset(): void {
    this.active = false
    this.payload = ''
    this.partialStartMarker = ''
  }
}
