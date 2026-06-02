import { type ReactNode } from 'react'
import type { HighlightedToken } from '../../../lib/codeHighlighting'
import { computeDiffLines } from '../../../lib/textDiff'

export const EDITOR_LINE_HEIGHT_PX = 20
export const EDITOR_LINE_OVERSCAN_COUNT = 40
export const EDITOR_VIRTUALIZATION_THRESHOLD = 800
export const EDITOR_BOTTOM_BUFFER_PX = EDITOR_LINE_HEIGHT_PX
export const EDITOR_HORIZONTAL_PADDING_PX = 24
export const SEARCH_HIGHLIGHT_BACKGROUND = 'var(--workspace-editor-search-highlight-background)'
export const ACTIVE_SEARCH_HIGHLIGHT_BACKGROUND = 'var(--workspace-editor-search-highlight-active-background)'

export type WorkspaceEditorLineStatus = 'added' | 'changed'

export interface SelectionLineRect {
  /** 0-based index of the line within the full document */
  lineIndex: number
  /** Column (in characters) where the selection starts on this line */
  startCh: number
  /** Column (in characters) where the selection ends on this line; null = spans to end of line */
  endCh: number | null
}

export interface TextRange {
  end: number
  isActive: boolean
  start: number
}

export interface SearchMatch {
  end: number
  start: number
  value: string
}

export interface SearchOptions {
  matchCase: boolean
  regex: boolean
  wholeWord: boolean
}

export function buildWorkspaceEditorLineStatusMap(
  originalContent: string | null | undefined,
  nextContent: string,
) {
  const lineStatusByLineNumber = new Map<number, WorkspaceEditorLineStatus>()

  if (originalContent === null || originalContent === undefined) {
    const normalizedNextLines = nextContent.split('\n')
    for (let index = 0; index < normalizedNextLines.length; index += 1) {
      lineStatusByLineNumber.set(index + 1, 'added')
    }

    return lineStatusByLineNumber
  }

  if (originalContent.length === 0) {
    if (nextContent.length === 0) {
      return lineStatusByLineNumber
    }

    const normalizedNextLines = nextContent.split('\n')
    for (let index = 0; index < normalizedNextLines.length; index += 1) {
      lineStatusByLineNumber.set(index + 1, 'added')
    }

    return lineStatusByLineNumber
  }

  const diffLines = computeDiffLines(originalContent, nextContent)

  for (let index = 0; index < diffLines.length; index += 1) {
    const diffLine = diffLines[index]
    if (diffLine.type !== 'added') {
      continue
    }

    const addedBlockStartIndex = index
    let addedBlockEndIndex = index + 1
    while (addedBlockEndIndex < diffLines.length && diffLines[addedBlockEndIndex].type === 'added') {
      addedBlockEndIndex += 1
    }

    const previousDiffLine = diffLines[addedBlockStartIndex - 1]
    const lineStatus: WorkspaceEditorLineStatus =
      previousDiffLine?.type === 'removed' ? 'changed' : 'added'

    for (let addedIndex = addedBlockStartIndex; addedIndex < addedBlockEndIndex; addedIndex += 1) {
      const addedLine = diffLines[addedIndex]
      if (addedLine.newLineNumber !== undefined) {
        lineStatusByLineNumber.set(addedLine.newLineNumber, lineStatus)
      }
    }

    index = addedBlockEndIndex - 1
  }

  return lineStatusByLineNumber
}

export function countLines(value: string) {
  if (value.length === 0) {
    return 1
  }

  let totalLines = 1
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) {
      totalLines += 1
    }
  }

  return totalLines
}

export function normalizeEditorLineText(value: string) {
  return value.replace(/\r\n?/g, '\n')
}

export function measureEditorLineWrapCount(
  context: CanvasRenderingContext2D,
  text: string,
  availableWidthPx: number,
) {
  if (text.length === 0 || availableWidthPx <= 0) {
    return 1
  }

  return Math.max(1, Math.ceil(context.measureText(text).width / availableWidthPx))
}

export function getWorkspaceEditorAvailableWidth(clientWidthPx: number) {
  return Math.max(0, clientWidthPx - EDITOR_HORIZONTAL_PADDING_PX)
}

export function getWorkspaceEditorScrollTransform(
  scrollLeftPx: number,
  scrollTopPx: number,
  wordWrapEnabled: boolean,
) {
  return wordWrapEnabled
    ? `translateY(${-scrollTopPx}px)`
    : `translate(${-scrollLeftPx}px, ${-scrollTopPx}px)`
}

function getTokenClassName(fontStyle: number | undefined) {
  if (!fontStyle) {
    return ''
  }

  return [fontStyle & 4 ? 'underline' : '']
    .filter((value) => value.length > 0)
    .join(' ')
}

function isWordCharacter(charCode: number | undefined) {
  if (charCode === undefined) {
    return false
  }

  return (
    (charCode >= 48 && charCode <= 57) ||
    (charCode >= 65 && charCode <= 90) ||
    (charCode >= 97 && charCode <= 122) ||
    charCode === 95
  )
}

function hasWholeWordBoundary(text: string, start: number, end: number) {
  const previousCharCode = start > 0 ? text.charCodeAt(start - 1) : undefined
  const nextCharCode = end < text.length ? text.charCodeAt(end) : undefined
  return !isWordCharacter(previousCharCode) && !isWordCharacter(nextCharCode)
}

export function buildSearchRegularExpression(searchValue: string, options: SearchOptions, global: boolean) {
  if (searchValue.length === 0) {
    return null
  }

  const source = options.wholeWord ? `\\b(?:${searchValue})\\b` : searchValue
  const flags = `${global ? 'g' : ''}${options.matchCase ? '' : 'i'}`

  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

export function findSearchMatches(text: string, searchValue: string, options: SearchOptions): SearchMatch[] {
  if (searchValue.length === 0) {
    return []
  }

  if (options.regex) {
    const expression = buildSearchRegularExpression(searchValue, options, true)
    if (!expression) {
      return []
    }

    const matches: SearchMatch[] = []
    for (const match of text.matchAll(expression)) {
      const matchedText = match[0] ?? ''
      const start = match.index ?? -1
      if (start < 0) {
        continue
      }

      const safeValue = matchedText.length > 0 ? matchedText : text.slice(start, start + 1)
      matches.push({
        end: start + safeValue.length,
        start,
        value: safeValue,
      })

      if (matchedText.length === 0) {
        expression.lastIndex = start + 1
      }
    }
    return matches
  }

  const normalizedText = options.matchCase ? text : text.toLowerCase()
  const normalizedSearchValue = options.matchCase ? searchValue : searchValue.toLowerCase()
  const ranges: SearchMatch[] = []
  let searchStartIndex = 0

  while (searchStartIndex <= normalizedText.length - normalizedSearchValue.length) {
    const nextMatchIndex = normalizedText.indexOf(normalizedSearchValue, searchStartIndex)
    if (nextMatchIndex === -1) {
      break
    }

    const nextMatchEnd = nextMatchIndex + normalizedSearchValue.length
    if (options.wholeWord && !hasWholeWordBoundary(text, nextMatchIndex, nextMatchEnd)) {
      searchStartIndex = nextMatchIndex + 1
      continue
    }

    ranges.push({
      start: nextMatchIndex,
      end: nextMatchEnd,
      value: text.slice(nextMatchIndex, nextMatchEnd),
    })
    searchStartIndex = nextMatchIndex + Math.max(1, normalizedSearchValue.length)
  }

  return ranges
}

/**
 * Maps a selection offset from a textarea (which strips \r on Windows) back to
 * the corresponding absolute offset in the original string (which may contain \r).
 */
export function mapTextareaOffsetToValueOffset(value: string, textareaOffset: number): number {
  let nonCarriageReturnCount = 0
  for (let i = 0; i < value.length; i++) {
    if (nonCarriageReturnCount === textareaOffset) {
      return i
    }
    if (value.charCodeAt(i) !== 13) {
      nonCarriageReturnCount += 1
    }
  }
  return value.length
}


export function findLineStartOffsets(text: string) {
  const offsets = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      offsets.push(index + 1)
    }
  }
  return offsets
}

/**
 * Given a line's raw start offset (from findLineStartOffsets) and the content
 * string, returns the number of visual columns from the line start to the given
 * absolute offset. This accounts for CRLF files where \r characters are present
 * in the raw text but the textarea treats them as 0-width for selectionStart/End.
 *
 * The textarea's selectionStart/End on Windows normalises \r\n pairs: the \r
 * is NOT counted as a separate character position. So we must also skip \r
 * when computing ch column positions. We also skip other zero-width control
 * characters (like \x1b ANSI escapes) because they don't take up visual space.
 */
export function computeVisualColumn(text: string, lineStartOffset: number, absoluteOffset: number): number {
  let col = 0
  for (let i = lineStartOffset; i < absoluteOffset && i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 13) {
      continue // skip \r
    }
    // Skip zero-width control characters (like ANSI \x1b) so the CSS highlight doesn't drift.
    // Allow \t (9) and \n (10)
    if (code < 32 && code !== 9 && code !== 10) {
      continue
    }
    col += 1
  }
  return col
}

export function findLineIndexForOffset(lineStartOffsets: readonly number[], offset: number) {
  let low = 0
  let high = lineStartOffsets.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const lineStart = lineStartOffsets[middle]
    const nextLineStart = lineStartOffsets[middle + 1] ?? Number.POSITIVE_INFINITY

    if (offset < lineStart) {
      high = middle - 1
      continue
    }
    if (offset >= nextLineStart) {
      low = middle + 1
      continue
    }

    return middle
  }

  return Math.max(0, lineStartOffsets.length - 1)
}

export function renderHighlightedTokens(tokens: readonly HighlightedToken[], matches: readonly TextRange[]): ReactNode {
  if (tokens.length === 0) {
    return '\u00A0'
  }

  if (matches.length === 0) {
    return tokens.map((token, index) => (
      <span
        key={`${index}:${token.content.slice(0, 16)}:${token.color ?? ''}`}
        className={getTokenClassName(token.fontStyle)}
        style={token.color ? { color: token.color } : undefined}
      >
        {token.content}
      </span>
    ))
  }

  const renderedSegments: ReactNode[] = []
  let absoluteIndex = 0
  let matchIndex = 0

  for (const token of tokens) {
    const tokenStartIndex = absoluteIndex
    const tokenEndIndex = tokenStartIndex + token.content.length
    let tokenOffset = 0

    while (tokenOffset < token.content.length) {
      while (matchIndex < matches.length && matches[matchIndex].end <= tokenStartIndex + tokenOffset) {
        matchIndex += 1
      }

      const activeMatch = matches[matchIndex]
      const absoluteOffset = tokenStartIndex + tokenOffset
      const hasMatchWithinToken =
        Boolean(activeMatch) && activeMatch.start < tokenEndIndex && activeMatch.end > absoluteOffset

      if (!hasMatchWithinToken) {
        const remainingText = token.content.slice(tokenOffset)
        if (remainingText.length > 0) {
          renderedSegments.push(
            <span
              key={`${tokenStartIndex}:${tokenOffset}:${remainingText.slice(0, 16)}:plain`}
              className={getTokenClassName(token.fontStyle)}
              style={token.color ? { color: token.color } : undefined}
            >
              {remainingText}
            </span>,
          )
        }
        break
      }

      if (activeMatch.start > absoluteOffset) {
        const plainEndIndex = Math.min(activeMatch.start, tokenEndIndex)
        const plainText = token.content.slice(tokenOffset, plainEndIndex - tokenStartIndex)
        if (plainText.length > 0) {
          renderedSegments.push(
            <span
              key={`${tokenStartIndex}:${tokenOffset}:${plainText.slice(0, 16)}:plain`}
              className={getTokenClassName(token.fontStyle)}
              style={token.color ? { color: token.color } : undefined}
            >
              {plainText}
            </span>,
          )
        }
        tokenOffset = plainEndIndex - tokenStartIndex
        continue
      }

      const highlightedEndIndex = Math.min(activeMatch.end, tokenEndIndex)
      const highlightedText = token.content.slice(tokenOffset, highlightedEndIndex - tokenStartIndex)
      renderedSegments.push(
        <span
          key={`${tokenStartIndex}:${tokenOffset}:${highlightedText.slice(0, 16)}:match`}
          className={getTokenClassName(token.fontStyle)}
          style={{
            backgroundColor: activeMatch.isActive ? ACTIVE_SEARCH_HIGHLIGHT_BACKGROUND : SEARCH_HIGHLIGHT_BACKGROUND,
            borderRadius: 2,
          }}
        >
          {highlightedText}
        </span>,
      )
      tokenOffset = highlightedEndIndex - tokenStartIndex
    }

    absoluteIndex = tokenEndIndex
  }

  return renderedSegments
}

/**
 * Converts raw textarea selectionStart/End offsets into an array of per-line
 * highlight rectangles expressed in character column units, suitable for
 * rendering as a gap-free selection overlay via CSS ch units / gradients.
 *
 * Uses computeVisualColumn so that CRLF files (\r\n) produce correct ch-unit
 * positions — the textarea counts \r\n as one position, not two.
 */
export function computeSelectionLineRects(
  lineStartOffsets: readonly number[],
  selectionStart: number,
  selectionEnd: number,
  text: string,
): SelectionLineRect[] {
  if (selectionStart >= selectionEnd) {
    return []
  }

  const startLineIndex = findLineIndexForOffset(lineStartOffsets, selectionStart)
  // Use selectionEnd - 1 so that a selection ending exactly at the start of the
  // next line (i.e. the newline was included) is attributed to the previous line.
  const endLineIndex = findLineIndexForOffset(lineStartOffsets, selectionEnd - 1)

  const rects: SelectionLineRect[] = []
  for (let lineIdx = startLineIndex; lineIdx <= endLineIndex; lineIdx++) {
    const lineStart = lineStartOffsets[lineIdx] ?? 0
    const nextLineStart = lineStartOffsets[lineIdx + 1]
    const lineEndOffset = nextLineStart !== undefined ? nextLineStart - 1 : text.length

    const startCh = lineIdx === startLineIndex ? computeVisualColumn(text, lineStart, selectionStart) : 0
    
    let endCh: number
    if (lineIdx === endLineIndex) {
      endCh = computeVisualColumn(text, lineStart, selectionEnd)
      if (nextLineStart !== undefined && selectionEnd >= nextLineStart) {
        const lineLengthCh = computeVisualColumn(text, lineStart, lineEndOffset)
        endCh = lineLengthCh + 0.5
      }
    } else {
      const lineLengthCh = computeVisualColumn(text, lineStart, lineEndOffset)
      endCh = lineLengthCh + 0.5
    }

    rects.push({ lineIndex: lineIdx, startCh, endCh })
  }

  return rects
}

