import { type ReactNode } from 'react'
import type { HighlightedToken } from '../../../lib/codeHighlighting'

export const EDITOR_LINE_HEIGHT_PX = 20
export const EDITOR_LINE_OVERSCAN_COUNT = 40
export const EDITOR_VIRTUALIZATION_THRESHOLD = 800
export const EDITOR_BOTTOM_BUFFER_PX = EDITOR_LINE_HEIGHT_PX
export const SEARCH_HIGHLIGHT_BACKGROUND = 'var(--workspace-editor-search-highlight-background)'
export const ACTIVE_SEARCH_HIGHLIGHT_BACKGROUND = 'var(--workspace-editor-search-highlight-active-background)'

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

function getTokenClassName(fontStyle: number | undefined) {
  if (!fontStyle) {
    return ''
  }

  return [fontStyle & 1 ? 'italic' : '', fontStyle & 2 ? 'font-semibold' : '', fontStyle & 4 ? 'underline' : '']
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

export function findLineStartOffsets(text: string) {
  const offsets = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      offsets.push(index + 1)
    }
  }
  return offsets
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
