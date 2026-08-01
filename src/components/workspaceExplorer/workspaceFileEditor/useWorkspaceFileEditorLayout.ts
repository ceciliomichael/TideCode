import { useMemo } from 'react'
import type { GitFileDiff } from '../../../types/chat'
import {
  buildWorkspaceEditorLineStatusMap,
  EDITOR_LINE_HEIGHT_PX,
  type TextRange,
} from './workspaceFileEditorUtils'

interface UseWorkspaceFileEditorLayoutOptions<TLine> {
  gitFileDiff: GitFileDiff | null
  hasRepository: boolean
  highlightedLines: readonly TLine[]
  originalContent: string | null
  selectionMatchesByLine: readonly TextRange[][]
  totalLineCount: number
  value: string
  visibleEndIndex: number
  visibleStartIndex: number
  wordWrapEnabled: boolean
  wrappedLineCounts: readonly number[]
}

export function useWorkspaceFileEditorLayout<TLine>({
  gitFileDiff,
  hasRepository,
  highlightedLines,
  originalContent,
  selectionMatchesByLine,
  totalLineCount,
  value,
  visibleEndIndex,
  visibleStartIndex,
  wordWrapEnabled,
  wrappedLineCounts,
}: UseWorkspaceFileEditorLayoutOptions<TLine>) {
  const visibleLineNumbers = useMemo(
    () => Array.from(
      { length: Math.max(0, visibleEndIndex - visibleStartIndex) },
      (_, index) => visibleStartIndex + index + 1,
    ),
    [visibleEndIndex, visibleStartIndex],
  )
  const visibleHighlightedLines = useMemo(
    () => highlightedLines.slice(visibleStartIndex, visibleEndIndex),
    [highlightedLines, visibleEndIndex, visibleStartIndex],
  )
  const visibleSelectionMatches = useMemo(
    () => selectionMatchesByLine.slice(visibleStartIndex, visibleEndIndex),
    [selectionMatchesByLine, visibleEndIndex, visibleStartIndex],
  )
  const lineStatusBaselineContent = gitFileDiff ? gitFileDiff.oldContent : originalContent
  const lineStatusByLineNumber = useMemo(
    () => hasRepository ? buildWorkspaceEditorLineStatusMap(lineStatusBaselineContent, value) : new Map(),
    [hasRepository, lineStatusBaselineContent, value],
  )
  const lineNumberRows = useMemo(
    () => visibleLineNumbers.map((lineNumber, index) => {
      const sourceLineIndex = visibleStartIndex + index
      return {
        lineNumber,
        minHeight: (wrappedLineCounts[sourceLineIndex] ?? 1) * EDITOR_LINE_HEIGHT_PX,
        status: lineStatusByLineNumber.get(lineNumber) ?? null,
      }
    }),
    [lineStatusByLineNumber, visibleLineNumbers, visibleStartIndex, wrappedLineCounts],
  )

  return {
    gutterWidthCh: Math.max(5, String(totalLineCount).length + 2),
    highlightedCodeClassName: wordWrapEnabled
      ? 'block min-w-full w-full bg-transparent'
      : 'block w-fit min-w-full bg-transparent',
    highlightedLineClassName: wordWrapEnabled
      ? 'whitespace-pre-wrap [overflow-wrap:anywhere]'
      : 'whitespace-pre',
    lineNumberRows,
    textAreaClassName: [
      'workspace-editor-scrollbar workspace-editor-textarea absolute inset-0 h-full min-h-0 w-full resize-none border-0 bg-transparent px-3 py-1.5 font-mono text-[12px] leading-5 outline-none',
      wordWrapEnabled
        ? 'overflow-y-scroll overflow-x-hidden whitespace-pre-wrap [overflow-wrap:anywhere]'
        : 'overflow-scroll whitespace-pre',
    ].join(' '),
    visibleHighlightedLines,
    visibleLineNumbers,
    visibleSelectionMatches,
  }
}
