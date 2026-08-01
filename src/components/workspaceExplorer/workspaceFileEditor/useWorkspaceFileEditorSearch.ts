import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import {
  buildSearchRegularExpression,
  EDITOR_LINE_HEIGHT_PX,
  findLineIndexForOffset,
  findSearchMatches,
  type SearchOptions,
  type TextRange,
} from './workspaceFileEditorUtils'

interface HighlightedLineText {
  text: string
}

interface UseWorkspaceFileEditorSearchOptions {
  fileName: string
  handleScroll: () => void
  highlightedLines: readonly HighlightedLineText[]
  lineStartOffsets: readonly number[]
  onChange: (nextValue: string) => void
  replaceInputRef: RefObject<HTMLInputElement>
  searchInputRef: RefObject<HTMLInputElement>
  textAreaRef: RefObject<HTMLTextAreaElement>
  value: string
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

export function useWorkspaceFileEditorSearch({
  fileName,
  handleScroll,
  highlightedLines,
  lineStartOffsets,
  onChange,
  replaceInputRef,
  searchInputRef,
  textAreaRef,
  value,
}: UseWorkspaceFileEditorSearchOptions) {
  const [searchValue, setSearchValue] = useState('')
  const [replaceValue, setReplaceValue] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isReplaceOpen, setIsReplaceOpen] = useState(false)
  const [isMatchCaseEnabled, setIsMatchCaseEnabled] = useState(false)
  const [isRegexEnabled, setIsRegexEnabled] = useState(false)
  const [isWholeWordEnabled, setIsWholeWordEnabled] = useState(false)
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(-1)

  const searchMatches = useMemo(
    () =>
      findSearchMatches(
        value,
        searchValue,
        makeSearchOptions(isMatchCaseEnabled, isRegexEnabled, isWholeWordEnabled),
      ),
    [isMatchCaseEnabled, isRegexEnabled, isWholeWordEnabled, searchValue, value],
  )

  const matchesByLine = useMemo(() => {
    const nextMatchesByLine = highlightedLines.map(() => [] as TextRange[])

    for (const match of searchMatches) {
      let currentMatchStart = match.start
      let remainingLength = match.end - match.start

      while (remainingLength > 0) {
        const lineIndex = findLineIndexForOffset(lineStartOffsets, currentMatchStart)
        if (lineIndex === -1) {
          break
        }

        const lineStartOffset = lineStartOffsets[lineIndex]
        const lineLength = highlightedLines[lineIndex].text.length
        const matchOffsetInLine = currentMatchStart - lineStartOffset
        const matchEndInLine = Math.min(matchOffsetInLine + remainingLength, lineLength)

        nextMatchesByLine[lineIndex].push({
          end: matchEndInLine,
          isActive: match === searchMatches[activeSearchMatchIndex],
          start: matchOffsetInLine,
        })

        const lengthMatchedInLine = Math.max(0, matchEndInLine - matchOffsetInLine)
        remainingLength -= lengthMatchedInLine
        currentMatchStart += lengthMatchedInLine

        if (remainingLength > 0) {
          currentMatchStart += 1
          remainingLength -= 1
        }
      }
    }

    return nextMatchesByLine
  }, [activeSearchMatchIndex, highlightedLines, lineStartOffsets, searchMatches])

  const closeSearchPanel = useCallback(() => {
    setIsSearchOpen(false)
    setIsReplaceOpen(false)
    window.requestAnimationFrame(() => {
      textAreaRef.current?.focus()
    })
  }, [textAreaRef])

  const focusSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [searchInputRef])

  const focusReplaceInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      replaceInputRef.current?.focus()
      replaceInputRef.current?.select()
    })
  }, [replaceInputRef])

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

  useEffect(() => {
    setSearchValue('')
    setReplaceValue('')
    setIsSearchOpen(false)
    setIsReplaceOpen(false)
    setIsMatchCaseEnabled(false)
    setIsRegexEnabled(false)
    setIsWholeWordEnabled(false)
    setActiveSearchMatchIndex(-1)
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
    if (!isSearchOpen) {
      return
    }

    const frameId = window.requestAnimationFrame(handleScroll)
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
      textAreaElement.scrollTop = Math.max(
        0,
        lineIndex * EDITOR_LINE_HEIGHT_PX - textAreaElement.clientHeight / 2 + EDITOR_LINE_HEIGHT_PX / 2,
      )
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
  }, [
    activeSearchMatchIndex,
    handleScroll,
    isSearchOpen,
    lineStartOffsets,
    replaceInputRef,
    searchInputRef,
    searchMatches,
    textAreaRef,
  ])

  return {
    actions: {
      closeSearchPanel,
      focusReplaceInput,
      focusSearchInput,
      handleReplaceAllMatches,
      handleReplaceCurrentMatch,
      moveSearchMatch,
    },
    matchesByLine,
    state: {
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
