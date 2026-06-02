import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useHighlightedCodeLines } from '../../../hooks/useHighlightedCodeLines'
import type { GitFileDiff } from '../../../types/chat'
import {
  buildWorkspaceEditorLineStatusMap,
  buildSearchRegularExpression,
  computeSelectionLineRects,
  countLines,
  getWorkspaceEditorScrollTransform,
  EDITOR_LINE_HEIGHT_PX,
  EDITOR_LINE_OVERSCAN_COUNT,
  EDITOR_VIRTUALIZATION_THRESHOLD,
  findLineIndexForOffset,
  findLineStartOffsets,
  findSearchMatches,
  mapTextareaOffsetToValueOffset,
  type SearchOptions,
  type SelectionLineRect,
  type TextRange,
} from './workspaceFileEditorUtils'

interface WorkspaceFileEditorProps {
  fileName: string
  gitFileDiff: GitFileDiff | null
  onOpenMarkdownPreview?: () => void
  originalContent: string | null
  value: string
  wordWrapEnabled: boolean
  onChange: (nextValue: string) => void
}

function makeSearchOptions(
  matchCase: boolean,
  regex: boolean,
  wholeWord: boolean,
): SearchOptions {
  return {
    matchCase,
    regex,
    wholeWord,
  }
}

export function useWorkspaceFileEditorState({
  fileName,
  gitFileDiff,
  onOpenMarkdownPreview,
  originalContent,
  value,
  wordWrapEnabled,
  onChange,
}: WorkspaceFileEditorProps) {
  const editorViewportRef = useRef<HTMLDivElement | null>(null)
  const lineNumbersRef = useRef<HTMLDivElement | null>(null)
  const highlightedLayerRef = useRef<HTMLDivElement | null>(null)
  const lineNumbersContentRef = useRef<HTMLElement | null>(null)
  const highlightedContentRef = useRef<HTMLElement | null>(null)
  const highlightedLineElementsRef = useRef(new Map<number, HTMLDivElement>())
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const previousFileNameRef = useRef(fileName)
  const previousValueRef = useRef(value)
  const scrollPositionRef = useRef({ scrollLeft: 0, scrollTop: 0 })
  const highlightedLines = useHighlightedCodeLines(value, { fileName, stripTrailingNewline: false })
  const totalLineCount = useMemo(() => countLines(value), [value])
  const [searchValue, setSearchValue] = useState('')
  const [replaceValue, setReplaceValue] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isReplaceOpen, setIsReplaceOpen] = useState(false)
  const [isMatchCaseEnabled, setIsMatchCaseEnabled] = useState(false)
  const [isRegexEnabled, setIsRegexEnabled] = useState(false)
  const [isWholeWordEnabled, setIsWholeWordEnabled] = useState(false)
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(-1)
  const [editorSelectionStart, setEditorSelectionStart] = useState(0)
  const [editorSelectionEnd, setEditorSelectionEnd] = useState(0)
  const [virtualRange, setVirtualRange] = useState(() => ({
    endIndex: Math.min(totalLineCount, EDITOR_VIRTUALIZATION_THRESHOLD),
    startIndex: 0,
  }))
  const [wrappedLineCounts, setWrappedLineCounts] = useState<number[]>(() => highlightedLines.map(() => 1))

  const shouldVirtualize = !wordWrapEnabled && totalLineCount >= EDITOR_VIRTUALIZATION_THRESHOLD
  const visibleStartIndex = shouldVirtualize ? virtualRange.startIndex : 0
  const visibleEndIndex = shouldVirtualize ? Math.min(totalLineCount, virtualRange.endIndex) : totalLineCount
  const topSpacerHeight = shouldVirtualize ? visibleStartIndex * EDITOR_LINE_HEIGHT_PX : 0
  const bottomSpacerHeight = shouldVirtualize ? (totalLineCount - visibleEndIndex) * EDITOR_LINE_HEIGHT_PX : 0
  const lineStartOffsets = useMemo(() => findLineStartOffsets(value), [value])
  const searchMatches = useMemo(
    () =>
      findSearchMatches(
        value,
        searchValue,
        makeSearchOptions(isMatchCaseEnabled, isRegexEnabled, isWholeWordEnabled),
      ),
    [isMatchCaseEnabled, isRegexEnabled, isWholeWordEnabled, searchValue, value],
  )
  const searchMatchesByLine = useMemo(() => {
    const matchesByLine = highlightedLines.map(() => [] as TextRange[])
    for (let index = 0; index < searchMatches.length; index += 1) {
      const match = searchMatches[index]
      if (match.end <= match.start) {
        continue
      }

      const startLineIndex = findLineIndexForOffset(lineStartOffsets, match.start)
      const endLineIndex = findLineIndexForOffset(lineStartOffsets, Math.max(match.end - 1, match.start))
      if (startLineIndex !== endLineIndex) {
        continue
      }

      const lineStartOffset = lineStartOffsets[startLineIndex] ?? 0
      matchesByLine[startLineIndex].push({
        end: match.end - lineStartOffset,
        isActive: index === activeSearchMatchIndex,
        start: match.start - lineStartOffset,
      })
    }
    return matchesByLine
  }, [activeSearchMatchIndex, highlightedLines, lineStartOffsets, searchMatches])
  const visibleLineNumbers = useMemo(
    () =>
      Array.from({ length: Math.max(0, visibleEndIndex - visibleStartIndex) }, (_, index) => visibleStartIndex + index + 1),
    [visibleEndIndex, visibleStartIndex],
  )
  const visibleHighlightedLines = useMemo(
    () => highlightedLines.slice(visibleStartIndex, visibleEndIndex),
    [highlightedLines, visibleEndIndex, visibleStartIndex],
  )
  const visibleSearchMatches = useMemo(
    () => searchMatchesByLine.slice(visibleStartIndex, visibleEndIndex),
    [searchMatchesByLine, visibleEndIndex, visibleStartIndex],
  )
  const lineStatusBaselineContent = gitFileDiff ? gitFileDiff.oldContent : originalContent
  const lineStatusByLineNumber = useMemo(
    () => buildWorkspaceEditorLineStatusMap(lineStatusBaselineContent, value),
    [lineStatusBaselineContent, value],
  )
  const gutterWidthCh = Math.max(5, String(totalLineCount).length + 2)
  const highlightedCodeClassName = wordWrapEnabled ? 'block min-w-full w-full bg-transparent' : 'block w-fit min-w-full bg-transparent'
  const highlightedLineClassName = wordWrapEnabled ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'
  const textAreaClassName = [
    'workspace-editor-scrollbar workspace-editor-textarea absolute inset-0 h-full min-h-0 w-full resize-none border-0 bg-transparent px-3 py-1.5 font-mono text-[12px] leading-5 outline-none',
    wordWrapEnabled ? 'overflow-y-auto overflow-x-hidden whitespace-pre-wrap [overflow-wrap:anywhere]' : 'overflow-auto whitespace-pre',
  ].join(' ')
  const lineNumberRows = useMemo(
    () =>
      visibleLineNumbers.map((lineNumber, index) => {
        const sourceLineIndex = visibleStartIndex + index
        const wrappedLineCount = wrappedLineCounts[sourceLineIndex] ?? 1

        return {
          lineNumber,
          minHeight: wrappedLineCount * EDITOR_LINE_HEIGHT_PX,
          status: lineStatusByLineNumber.get(lineNumber) ?? null,
        }
      }),
    [lineStatusByLineNumber, visibleLineNumbers, visibleStartIndex, wrappedLineCounts],
  )

  const allSelectionLineRects = useMemo(() => {
    const valueSelectionStart = mapTextareaOffsetToValueOffset(value, editorSelectionStart)
    const valueSelectionEnd = mapTextareaOffsetToValueOffset(value, editorSelectionEnd)
    return computeSelectionLineRects(lineStartOffsets, valueSelectionStart, valueSelectionEnd, value)
  }, [lineStartOffsets, editorSelectionStart, editorSelectionEnd, value])

  const visibleSelectionRectsMap = useMemo(() => {
    const map = new Map<number, SelectionLineRect>()
    for (const rect of allSelectionLineRects) {
      if (rect.lineIndex >= visibleStartIndex && rect.lineIndex < visibleEndIndex) {
        map.set(rect.lineIndex, rect)
      }
    }
    return map
  }, [allSelectionLineRects, visibleStartIndex, visibleEndIndex])

  const handleSelect = useCallback(() => {
    const textArea = textAreaRef.current
    if (!textArea) return
    setEditorSelectionStart(textArea.selectionStart)
    setEditorSelectionEnd(textArea.selectionEnd)
  }, [])

  // Track selection in real-time via document.selectionchange, which fires
  // continuously during mouse-drag and held-key selection (unlike onSelect /
  // onMouseUp which only fire after the interaction ends).
  useEffect(() => {
    const onSelectionChange = () => {
      const textArea = textAreaRef.current
      if (!textArea) {
        return
      }
      setEditorSelectionStart(textArea.selectionStart)
      setEditorSelectionEnd(textArea.selectionEnd)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [])

  const handleScroll = useCallback(() => {
    const textAreaElement = textAreaRef.current
    if (!textAreaElement) {
      return
    }

    const scrollLeft = wordWrapEnabled ? 0 : textAreaElement.scrollLeft
    const scrollTop = textAreaElement.scrollTop
    scrollPositionRef.current = {
      scrollLeft,
      scrollTop,
    }

    const scrollTransform = getWorkspaceEditorScrollTransform(scrollLeft, scrollTop, wordWrapEnabled)
    if (highlightedContentRef.current) {
      highlightedContentRef.current.style.transform = scrollTransform
    }
    if (lineNumbersContentRef.current) {
      lineNumbersContentRef.current.style.transform = `translateY(${-scrollTop}px)`
    }

    if (!shouldVirtualize) {
      return
    }

    const visibleTop = textAreaElement.scrollTop
    const visibleBottom = visibleTop + textAreaElement.clientHeight
    const visibleStart = Math.max(0, Math.floor(visibleTop / EDITOR_LINE_HEIGHT_PX) - EDITOR_LINE_OVERSCAN_COUNT)
    const visibleEnd = Math.min(totalLineCount, Math.ceil(visibleBottom / EDITOR_LINE_HEIGHT_PX) + EDITOR_LINE_OVERSCAN_COUNT)

    setVirtualRange((currentRange) => {
      if (currentRange.startIndex === visibleStart && currentRange.endIndex === visibleEnd) {
        return currentRange
      }

      return {
        endIndex: visibleEnd,
        startIndex: visibleStart,
      }
    })
  }, [shouldVirtualize, totalLineCount, wordWrapEnabled])

  const setHighlightedLineElement = useCallback((lineNumber: number, element: HTMLDivElement | null) => {
    const sourceLineIndex = lineNumber - 1
    if (element) {
      highlightedLineElementsRef.current.set(sourceLineIndex, element)
      return
    }

    highlightedLineElementsRef.current.delete(sourceLineIndex)
  }, [])

  const updateWrappedLineCountsFromRenderedLines = useCallback(() => {
    if (!wordWrapEnabled) {
      setWrappedLineCounts(highlightedLines.map(() => 1))
      return
    }

    setWrappedLineCounts((currentCounts) => {
      const nextCounts = highlightedLines.map((_, lineIndex) => {
        const lineElement = highlightedLineElementsRef.current.get(lineIndex)
        if (!lineElement) {
          return currentCounts[lineIndex] ?? 1
        }

        const renderedHeight = lineElement.getBoundingClientRect().height
        return Math.max(1, Math.round(renderedHeight / EDITOR_LINE_HEIGHT_PX))
      })

      if (
        currentCounts.length === nextCounts.length &&
        currentCounts.every((count, index) => count === nextCounts[index])
      ) {
        return currentCounts
      }

      return nextCounts
    })
  }, [highlightedLines, wordWrapEnabled])

  useLayoutEffect(() => {
    const textAreaElement = textAreaRef.current
    if (!textAreaElement) {
      previousFileNameRef.current = fileName
      previousValueRef.current = value
      return
    }

    const isSameFileContentUpdate = previousFileNameRef.current === fileName && previousValueRef.current !== value
    previousFileNameRef.current = fileName
    previousValueRef.current = value

    if (!isSameFileContentUpdate) {
      scrollPositionRef.current = {
        scrollLeft: textAreaElement.scrollLeft,
        scrollTop: textAreaElement.scrollTop,
      }
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      handleScroll()
      updateWrappedLineCountsFromRenderedLines()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [fileName, handleScroll, updateWrappedLineCountsFromRenderedLines, value])

  const closeSearchPanel = useCallback(() => {
    setIsSearchOpen(false)
    setIsReplaceOpen(false)
    window.requestAnimationFrame(() => {
      textAreaRef.current?.focus()
    })
  }, [])

  const focusSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  const focusReplaceInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      replaceInputRef.current?.focus()
      replaceInputRef.current?.select()
    })
  }, [])

  const moveSearchMatch = useCallback(
    (direction: 1 | -1) => {
      if (searchMatches.length === 0) {
        return
      }
      setActiveSearchMatchIndex((currentIndex) => {
        const baseIndex = currentIndex < 0 ? 0 : currentIndex
        return (baseIndex + direction + searchMatches.length) % searchMatches.length
      })
    },
    [searchMatches],
  )

  const handleReplaceCurrentMatch = useCallback(() => {
    if (activeSearchMatchIndex < 0 || activeSearchMatchIndex >= searchMatches.length) {
      return
    }

    const activeMatch = searchMatches[activeSearchMatchIndex]
    const replacementText = isRegexEnabled
      ? activeMatch.value.replace(
          buildSearchRegularExpression(
            searchValue,
            makeSearchOptions(isMatchCaseEnabled, true, isWholeWordEnabled),
            false,
          ) ?? /$^/,
          replaceValue,
        )
      : replaceValue
    const nextValue = `${value.slice(0, activeMatch.start)}${replacementText}${value.slice(activeMatch.end)}`
    onChange(nextValue)
  }, [
    activeSearchMatchIndex,
    isMatchCaseEnabled,
    isRegexEnabled,
    isWholeWordEnabled,
    onChange,
    replaceValue,
    searchMatches,
    searchValue,
    value,
  ])

  const handleReplaceAllMatches = useCallback(() => {
    if (searchMatches.length === 0) {
      return
    }

    if (isRegexEnabled) {
      const expression = buildSearchRegularExpression(
        searchValue,
        makeSearchOptions(isMatchCaseEnabled, true, isWholeWordEnabled),
        true,
      )
      if (!expression) {
        return
      }
      onChange(value.replace(expression, replaceValue))
      return
    }

    let nextValue = value
    for (let index = searchMatches.length - 1; index >= 0; index -= 1) {
      const match = searchMatches[index]
      nextValue = `${nextValue.slice(0, match.start)}${replaceValue}${nextValue.slice(match.end)}`
    }
    onChange(nextValue)
  }, [isMatchCaseEnabled, isRegexEnabled, isWholeWordEnabled, onChange, replaceValue, searchMatches, searchValue, value])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        onOpenMarkdownPreview?.()
        return
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setIsSearchOpen(true)
        setIsReplaceOpen(false)
        focusSearchInput()
        return
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        setIsSearchOpen(true)
        setIsReplaceOpen(true)
        focusReplaceInput()
        return
      }

      if (event.key === 'Escape' && isSearchOpen) {
        event.preventDefault()
        closeSearchPanel()
        return
      }

      if (event.key === 'Enter' && isSearchOpen) {
        event.preventDefault()
        moveSearchMatch(event.shiftKey ? -1 : 1)
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      event.preventDefault()
      const target = event.currentTarget
      const selectionStart = target.selectionStart
      const selectionEnd = target.selectionEnd
      const nextValue = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`
      onChange(nextValue)
      window.requestAnimationFrame(() => {
        if (!textAreaRef.current) {
          return
        }
        textAreaRef.current.selectionStart = selectionStart + 2
        textAreaRef.current.selectionEnd = selectionStart + 2
      })
    },
    [
      closeSearchPanel,
      focusReplaceInput,
      focusSearchInput,
      isSearchOpen,
      moveSearchMatch,
      onChange,
      onOpenMarkdownPreview,
      value,
    ],
  )

  useEffect(() => {
    setSearchValue('')
    setReplaceValue('')
    setIsSearchOpen(false)
    setIsReplaceOpen(false)
    setIsMatchCaseEnabled(false)
    setIsRegexEnabled(false)
    setIsWholeWordEnabled(false)
    setActiveSearchMatchIndex(-1)
    setEditorSelectionStart(0)
    setEditorSelectionEnd(0)
  }, [fileName])

  useEffect(() => {
    setActiveSearchMatchIndex((currentIndex) => {
      if (searchMatches.length === 0) {
        return -1
      }
      if (currentIndex < 0 || currentIndex >= searchMatches.length) {
        return 0
      }
      return currentIndex
    })
  }, [searchMatches])

  useEffect(() => {
    if (!shouldVirtualize) {
      setVirtualRange({
        endIndex: totalLineCount,
        startIndex: 0,
      })
      return
    }

    function updateVirtualRange() {
      const textAreaElement = textAreaRef.current
      if (!textAreaElement) {
        return
      }

      const visibleTop = textAreaElement.scrollTop
      const visibleBottom = visibleTop + textAreaElement.clientHeight
      const visibleStart = Math.max(0, Math.floor(visibleTop / EDITOR_LINE_HEIGHT_PX) - EDITOR_LINE_OVERSCAN_COUNT)
      const visibleEnd = Math.min(totalLineCount, Math.ceil(visibleBottom / EDITOR_LINE_HEIGHT_PX) + EDITOR_LINE_OVERSCAN_COUNT)

      setVirtualRange((currentRange) => {
        if (currentRange.startIndex === visibleStart && currentRange.endIndex === visibleEnd) {
          return currentRange
        }

        return {
          endIndex: visibleEnd,
          startIndex: visibleStart,
        }
      })
    }

    updateVirtualRange()
    const frameId = window.requestAnimationFrame(updateVirtualRange)
    window.addEventListener('resize', updateVirtualRange)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateVirtualRange)
    }
  }, [shouldVirtualize, totalLineCount])

  useEffect(() => {
    if (!isSearchOpen) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      handleScroll()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [handleScroll, isSearchOpen])

  useEffect(() => {
    if (!isSearchOpen || activeSearchMatchIndex < 0 || activeSearchMatchIndex >= searchMatches.length) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      const textAreaElement = textAreaRef.current
      if (!textAreaElement) {
        return
      }

      const activeMatch = searchMatches[activeSearchMatchIndex]
      const lineIndex = findLineIndexForOffset(lineStartOffsets, activeMatch.start)
      const targetScrollTop = Math.max(
        0,
        lineIndex * EDITOR_LINE_HEIGHT_PX - textAreaElement.clientHeight / 2 + EDITOR_LINE_HEIGHT_PX / 2,
      )
      textAreaElement.scrollTop = targetScrollTop
      const activeElement = document.activeElement
      const isTypingInSearchField = activeElement === searchInputRef.current || activeElement === replaceInputRef.current
      if (!isTypingInSearchField) {
        textAreaElement.selectionStart = activeMatch.start
        textAreaElement.selectionEnd = activeMatch.end
      }
      handleScroll()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [activeSearchMatchIndex, handleScroll, isSearchOpen, lineStartOffsets, searchMatches])

  useEffect(() => {
    if (!wordWrapEnabled) {
      return
    }

    const textAreaElement = textAreaRef.current
    if (textAreaElement) {
      textAreaElement.scrollLeft = 0
    }
    handleScroll()
  }, [handleScroll, wordWrapEnabled])

  useEffect(() => {
    if (!wordWrapEnabled) {
      setWrappedLineCounts(highlightedLines.map(() => 1))
      return
    }

    const viewportElement = editorViewportRef.current
    const highlightedContentElement = highlightedContentRef.current
    if (!viewportElement || !highlightedContentElement) {
      return
    }

    let isDisposed = false
    let frameId = 0

    const updateWrappedLineCounts = () => {
      if (isDisposed) {
        return
      }
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        updateWrappedLineCountsFromRenderedLines()
        handleScroll()
      })
    }

    updateWrappedLineCounts()

    const resizeObserver = new ResizeObserver(() => {
      updateWrappedLineCounts()
    })
    resizeObserver.observe(viewportElement)
    resizeObserver.observe(highlightedContentElement)
    for (const lineElement of highlightedLineElementsRef.current.values()) {
      resizeObserver.observe(lineElement)
    }

    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        updateWrappedLineCounts()
      })
    }

    return () => {
      isDisposed = true
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [handleScroll, highlightedLines, updateWrappedLineCountsFromRenderedLines, wordWrapEnabled])

  return {
    actions: {
      closeSearchPanel,
      focusReplaceInput,
      focusSearchInput,
      handleKeyDown,
      handleReplaceAllMatches,
      handleReplaceCurrentMatch,
      handleScroll,
      handleSelect,
      moveSearchMatch,
      setHighlightedLineElement,
    },
    layout: {
      bottomSpacerHeight,
      gutterWidthCh,
      highlightedCodeClassName,
      highlightedLineClassName,
      lineNumberRows,
      textAreaClassName,
      topSpacerHeight,
      visibleHighlightedLines,
      visibleLineNumbers,
      visibleSearchMatches,
      visibleSelectionRectsMap,
    },
    refs: {
      editorViewportRef,
      highlightedLayerRef,
      highlightedContentRef,
      lineNumbersRef,
      lineNumbersContentRef,
      replaceInputRef,
      searchInputRef,
      textAreaRef,
    },
    search: {
      activeSearchMatchIndex,
      isMatchCaseEnabled,
      isRegexEnabled,
      isReplaceOpen,
      isSearchOpen,
      isWholeWordEnabled,
      replaceValue,
      searchValue,
      setIsMatchCaseEnabled,
      setIsRegexEnabled,
      setIsReplaceOpen,
      setIsSearchOpen,
      setIsWholeWordEnabled,
      setReplaceValue,
      setSearchValue,
      totalSearchMatchCount: searchMatches.length,
    },
  }
}

export type WorkspaceFileEditorState = ReturnType<typeof useWorkspaceFileEditorState>
