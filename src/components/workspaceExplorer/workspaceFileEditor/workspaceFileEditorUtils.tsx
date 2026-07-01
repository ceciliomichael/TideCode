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

export function renderHighlightedTokens(tokens: readonly HighlightedToken[], searchMatches: readonly TextRange[], selectionMatches: readonly TextRange[] = []): ReactNode {
  if (tokens.length === 0) {
    if (selectionMatches.length > 0) {
      // Empty line with selection
      return (
        <span 
          className="workspace-editor-selection"
        >
          {'\u00A0'}
        </span>
      )
    }
    return '\u00A0'
  }

  if (searchMatches.length === 0 && selectionMatches.length === 0) {
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
  let searchMatchIndex = 0
  let selectionMatchIndex = 0

  for (const token of tokens) {
    const tokenStartIndex = absoluteIndex
    const tokenEndIndex = tokenStartIndex + token.content.length
    let tokenOffset = 0

    while (tokenOffset < token.content.length) {
      const absoluteOffset = tokenStartIndex + tokenOffset

      while (searchMatchIndex < searchMatches.length && searchMatches[searchMatchIndex].end <= absoluteOffset) {
        searchMatchIndex += 1
      }
      while (selectionMatchIndex < selectionMatches.length && selectionMatches[selectionMatchIndex].end <= absoluteOffset) {
        selectionMatchIndex += 1
      }

      const activeSearchMatch = searchMatches[searchMatchIndex]
      const activeSelectionMatch = selectionMatches[selectionMatchIndex]

      let nextBreak = tokenEndIndex

      if (activeSearchMatch) {
        if (activeSearchMatch.start > absoluteOffset) {
          nextBreak = Math.min(nextBreak, activeSearchMatch.start)
        } else if (activeSearchMatch.end > absoluteOffset) {
          nextBreak = Math.min(nextBreak, activeSearchMatch.end)
        }
      }

      if (activeSelectionMatch) {
        if (activeSelectionMatch.start > absoluteOffset) {
          nextBreak = Math.min(nextBreak, activeSelectionMatch.start)
        } else if (activeSelectionMatch.end > absoluteOffset) {
          nextBreak = Math.min(nextBreak, activeSelectionMatch.end)
        }
      }

      const segmentText = token.content.slice(tokenOffset, nextBreak - tokenStartIndex)
      
      const isSearchActive = activeSearchMatch && activeSearchMatch.start <= absoluteOffset && activeSearchMatch.end >= nextBreak
      const isSelectionActive = activeSelectionMatch && activeSelectionMatch.start <= absoluteOffset && activeSelectionMatch.end >= nextBreak

      const style: React.CSSProperties = {}
      let className = getTokenClassName(token.fontStyle)

      if (isSelectionActive) {
        className += ' workspace-editor-selection'
      } else if (isSearchActive) {
        style.backgroundColor = activeSearchMatch.isActive ? ACTIVE_SEARCH_HIGHLIGHT_BACKGROUND : SEARCH_HIGHLIGHT_BACKGROUND
        style.borderRadius = 2
      } else if (token.color) {
        style.color = token.color
      }

      renderedSegments.push(
        <span
          key={`${tokenStartIndex}:${tokenOffset}:${segmentText.slice(0, 16)}`}
          className={className}
          style={Object.keys(style).length > 0 ? style : undefined}
        >
          {segmentText}
        </span>
      )

      tokenOffset += segmentText.length
    }

    absoluteIndex = tokenEndIndex
  }

  // If there's a selection on the newline character at the end of a line with tokens
  const lastSelection = selectionMatches[selectionMatches.length - 1]
  if (tokens.length > 0 && lastSelection && (lastSelection as any).isNewlineSelected) {
    renderedSegments.push(
      <span 
        key={`newline-selection`}
        className="workspace-editor-selection workspace-editor-selection-newline"
      >
        {'\u200B'}
      </span>
    )
  }

  return renderedSegments
}


