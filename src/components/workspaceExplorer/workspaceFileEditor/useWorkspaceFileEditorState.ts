import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useHighlightedCodeLines } from '../../../hooks/useHighlightedCodeLines'
import type { GitFileDiff } from '../../../types/chat'
import { isMarkdownPreviewablePath } from '../../../lib/markdown-preview'
import { isSvgPreviewablePath } from '../../../lib/svg-preview'
import {
  countLines,
  getWorkspaceEditorScrollTransform,
  EDITOR_LINE_HEIGHT_PX,
  EDITOR_LINE_OVERSCAN_COUNT,
  EDITOR_VIRTUALIZATION_THRESHOLD,
  findLineStartOffsets,
  type TextSelectionRange,
} from './workspaceFileEditorUtils'
import { useWorkspaceFileEditorSearch } from './useWorkspaceFileEditorSearch'
import { useWorkspaceFileEditorSelection } from './useWorkspaceFileEditorSelection'
import { useWorkspaceFileEditorLayout } from './useWorkspaceFileEditorLayout'

interface WorkspaceFileEditorProps {
  fileName: string
  gitFileDiff: GitFileDiff | null
  hasRepository: boolean
  initialSelection?: TextSelectionRange | null
  onOpenMarkdownPreview?: () => void
  onOpenSvgPreview?: () => void
  originalContent: string | null
  onSelectionChange?: (selection: TextSelectionRange | null) => void
  value: string
  wordWrapEnabled: boolean
  onChange: (nextValue: string) => void
}

export function useWorkspaceFileEditorState({
  fileName,
  gitFileDiff,
  hasRepository,
  initialSelection,
  onOpenMarkdownPreview,
  onOpenSvgPreview,
  originalContent,
  onSelectionChange,
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

  const {
    clearEditorSelection,
    handleEditorChange,
    handleEditorPointerDown,
    handleEditorSelect,
    matchesByLine: selectionMatchesByLine,
  } = useWorkspaceFileEditorSelection({
    initialSelection,
    onChange,
    onSelectionChange,
    textAreaRef,
    value,
  })

  const {
    gutterWidthCh,
    highlightedCodeClassName,
    highlightedLineClassName,
    lineNumberRows,
    textAreaClassName,
    visibleHighlightedLines,
    visibleLineNumbers,
    visibleSelectionMatches,
  } = useWorkspaceFileEditorLayout({
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
  })


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

  const {
    actions: {
      closeSearchPanel,
      focusReplaceInput,
      focusSearchInput,
      handleReplaceAllMatches,
      handleReplaceCurrentMatch,
      moveSearchMatch,
    },
    matchesByLine: searchMatchesByLine,
    state: searchState,
  } = useWorkspaceFileEditorSearch({
    clearEditorSelection,
    fileName,
    handleScroll,
    highlightedLines,
    lineStartOffsets,
    onChange,
    replaceInputRef,
    searchInputRef,
    textAreaRef,
    value,
  })
  const {
    isSearchOpen,
    setIsReplaceOpen,
    setIsSearchOpen,
  } = searchState
  const visibleSearchMatches = useMemo(
    () => searchMatchesByLine.slice(visibleStartIndex, visibleEndIndex),
    [searchMatchesByLine, visibleEndIndex, visibleStartIndex],
  )

  // Restores the textarea scroll to the saved position and syncs overlay transforms.
  // Used after DOM reflows (e.g. word-wrap height recalculation) to prevent scroll jumping.
  const restoreAndSyncScroll = useCallback(() => {
    const textAreaElement = textAreaRef.current
    if (!textAreaElement) {
      return
    }
    const { scrollLeft, scrollTop } = scrollPositionRef.current
    textAreaElement.scrollLeft = scrollLeft
    textAreaElement.scrollTop = scrollTop
    handleScroll()
  }, [handleScroll])

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

    const isDifferentFile = previousFileNameRef.current !== fileName
    const isValueUnchanged = previousValueRef.current === value
    
    previousFileNameRef.current = fileName
    previousValueRef.current = value

    if (isDifferentFile) {
      textAreaRef.current?.scrollTo({ left: 0, top: 0 })
      setWrappedLineCounts(wordWrapEnabled ? countLines(value) > 0 ? Array(countLines(value)).fill(1) : [] : [])
    }
    
    scrollPositionRef.current = {
      scrollLeft: textAreaElement.scrollLeft,
      scrollTop: textAreaElement.scrollTop,
    }

    if (isDifferentFile || isValueUnchanged) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      handleScroll()
      updateWrappedLineCountsFromRenderedLines()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [fileName, handleScroll, updateWrappedLineCountsFromRenderedLines, value, wordWrapEnabled])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        if (isSvgPreviewablePath(fileName)) {
          event.preventDefault()
          onOpenSvgPreview?.()
          return
        }

        if (isMarkdownPreviewablePath(fileName)) {
          event.preventDefault()
          onOpenMarkdownPreview?.()
        }
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
      fileName,
      isSearchOpen,
      moveSearchMatch,
      onChange,
      onOpenMarkdownPreview,
      onOpenSvgPreview,
      setIsReplaceOpen,
      setIsSearchOpen,
      value,
    ],
  )

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
        // Use restoreAndSyncScroll instead of handleScroll to prevent the browser
        // DOM reflow from shifting the scroll position after line heights change.
        restoreAndSyncScroll()
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
  }, [handleScroll, highlightedLines, restoreAndSyncScroll, updateWrappedLineCountsFromRenderedLines, wordWrapEnabled])

  return {
    actions: {
      closeSearchPanel,
      focusReplaceInput,
      focusSearchInput,
      handleKeyDown,
      handleEditorChange,
      handleEditorPointerDown,
      handleEditorSelect,
      handleReplaceAllMatches,
      handleReplaceCurrentMatch,
      handleScroll,
      moveSearchMatch,
      setHighlightedLineElement,
    },
    selection: {
      matchesByLine: selectionMatchesByLine,
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
      visibleSelectionMatches,
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
    search: searchState,
  }
}

export type WorkspaceFileEditorState = ReturnType<typeof useWorkspaceFileEditorState>
