import { useEffect, useMemo, useState } from 'react'
import { highlightCodeLines, type HighlightedCodeLine } from '../lib/codeHighlighting'
import { useResolvedDocumentTheme } from './useResolvedDocumentTheme'

interface UseHighlightedCodeLinesOptions {
  fileName?: string
  language?: string
  stripTrailingNewline?: boolean
}

function createPlainLines(code: string, stripTrailingNewline: boolean): HighlightedCodeLine[] {
  let normalizedCode = code.replace(/\r\n?/g, '\n')
  if (stripTrailingNewline && normalizedCode.endsWith('\n')) {
    normalizedCode = normalizedCode.slice(0, -1)
  }

  const lines = normalizedCode.length === 0 ? [''] : normalizedCode.split('\n')
  return lines.map((line) => ({
    text: line,
    tokens: line.length > 0 ? [{ content: line }] : [],
  }))
}

export function useHighlightedCodeLines(
  code: string,
  { fileName, language, stripTrailingNewline = true }: UseHighlightedCodeLinesOptions = {},
) {
  const theme = useResolvedDocumentTheme()
  const requestKey = useMemo(
    () => JSON.stringify([code, fileName ?? '', language ?? '', stripTrailingNewline, theme]),
    [code, fileName, language, stripTrailingNewline, theme],
  )
  const plainLines = useMemo(
    () => createPlainLines(code, stripTrailingNewline),
    [code, stripTrailingNewline],
  )
  const [highlightedResult, setHighlightedResult] = useState<{
    lines: HighlightedCodeLine[]
    requestKey: string
  }>(() => ({
    lines: plainLines,
    requestKey,
  }))

  useEffect(() => {
    let isCancelled = false

    void highlightCodeLines({
      code,
      fileName,
      language,
      stripTrailingNewline,
      theme,
    }).then((highlightedLines) => {
      if (!isCancelled) {
        setHighlightedResult({
          lines: highlightedLines,
          requestKey,
        })
      }
    })

    return () => {
      isCancelled = true
    }
  }, [code, fileName, language, requestKey, stripTrailingNewline, theme])

  return highlightedResult.requestKey === requestKey
    ? highlightedResult.lines
    : plainLines
}
