import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import {
  findWorkspaceSearchMatches,
  replaceAllWorkspaceSearchMatches,
  resolveWorkspaceSearchReplacement,
  type WorkspaceSearchOptions,
} from './workspaceMonacoSearch'

interface UseWorkspaceMonacoSearchOptions {
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>
  fileName: string
  monacoRef: MutableRefObject<Monaco | null>
  value: string
}

function createSearchOptions(matchCase: boolean, regex: boolean, wholeWord: boolean): WorkspaceSearchOptions {
  return { matchCase, regex, wholeWord }
}

export function useWorkspaceMonacoSearch({
  editorRef,
  fileName,
  monacoRef,
  value,
}: UseWorkspaceMonacoSearchOptions) {
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const isOpenRef = useRef(false)
  const [searchValue, setSearchValueState] = useState('')
  const [replaceValue, setReplaceValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [isReplaceOpen, setIsReplaceOpen] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [regex, setRegex] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1)
  isOpenRef.current = isOpen

  const searchOptions = useMemo(
    () => createSearchOptions(matchCase, regex, wholeWord),
    [matchCase, regex, wholeWord],
  )
  const matches = useMemo(
    () => findWorkspaceSearchMatches(value, searchValue, searchOptions),
    [searchOptions, searchValue, value],
  )

  const setSearchValue = useCallback((nextValue: string) => {
    setSearchValueState(nextValue)
    setActiveMatchIndex(nextValue.length > 0 ? 0 : -1)
  }, [])

  const focusInput = useCallback((replace: boolean) => {
    window.requestAnimationFrame(() => {
      const input = replace ? replaceInputRef.current : searchInputRef.current
      input?.focus()
      input?.select()
    })
  }, [])

  const openSearchPanel = useCallback((replace = false) => {
    const editorInstance = editorRef.current
    const model = editorInstance?.getModel()
    const selection = editorInstance?.getSelection()
    if (model && selection && !selection.isEmpty()) {
      const selectedText = model.getValueInRange(selection)
      if (selectedText.length > 0 && !selectedText.includes('\n')) {
        setSearchValue(selectedText)
      }
      editorInstance?.setPosition(selection.getStartPosition())
    }

    setIsOpen(true)
    setIsReplaceOpen(replace)
    focusInput(replace)
  }, [editorRef, focusInput, setSearchValue])

  const closeSearchPanel = useCallback(() => {
    setIsOpen(false)
    setIsReplaceOpen(false)
    decorationsRef.current?.clear()
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }, [editorRef])

  const moveSearchMatch = useCallback((direction: 1 | -1) => {
    if (matches.length === 0) {
      return
    }

    setActiveMatchIndex((currentIndex) => {
      const baseIndex = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex
      return (baseIndex + direction + matches.length) % matches.length
    })
  }, [matches.length])

  const replaceCurrentMatch = useCallback(() => {
    const editorInstance = editorRef.current
    const model = editorInstance?.getModel()
    const monaco = monacoRef.current
    if (!editorInstance || !model || !monaco || activeMatchIndex < 0 || activeMatchIndex >= matches.length) {
      return
    }

    const match = matches[activeMatchIndex]
    const start = model.getPositionAt(match.start)
    const end = model.getPositionAt(match.end)
    const replacement = resolveWorkspaceSearchReplacement(match, searchValue, replaceValue, searchOptions)
    editorInstance.pushUndoStop()
    editorInstance.executeEdits('tidecode.find.replace', [{
      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      text: replacement,
    }])
    editorInstance.pushUndoStop()
  }, [activeMatchIndex, editorRef, matches, monacoRef, replaceValue, searchOptions, searchValue])

  const replaceAllMatches = useCallback(() => {
    const editorInstance = editorRef.current
    const model = editorInstance?.getModel()
    if (!editorInstance || !model || matches.length === 0) {
      return
    }

    const nextValue = replaceAllWorkspaceSearchMatches(value, searchValue, replaceValue, searchOptions)
    if (nextValue === value) {
      return
    }

    editorInstance.pushUndoStop()
    editorInstance.executeEdits('tidecode.find.replaceAll', [{
      range: model.getFullModelRange(),
      text: nextValue,
    }])
    editorInstance.pushUndoStop()
  }, [editorRef, matches.length, replaceValue, searchOptions, searchValue, value])

  useEffect(() => {
    setSearchValueState('')
    setReplaceValue('')
    setIsOpen(false)
    setIsReplaceOpen(false)
    setMatchCase(false)
    setRegex(false)
    setWholeWord(false)
    setActiveMatchIndex(-1)
    decorationsRef.current?.clear()
  }, [fileName])

  useEffect(() => {
    setActiveMatchIndex((currentIndex) => {
      if (matches.length === 0) {
        return -1
      }
      return currentIndex < 0 || currentIndex >= matches.length ? 0 : currentIndex
    })
  }, [matches.length])

  useEffect(() => {
    const editorInstance = editorRef.current
    const model = editorInstance?.getModel()
    const monaco = monacoRef.current
    if (!editorInstance || !model || !monaco) {
      return
    }

    const nextDecorations = isOpen
      ? matches.map((match, index) => {
          const start = model.getPositionAt(match.start)
          const end = model.getPositionAt(match.end)
          return {
            range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
            options: {
              inlineClassName: index === activeMatchIndex
                ? 'workspace-monaco-search-highlight-active'
                : 'workspace-monaco-search-highlight',
              stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            },
          }
        })
      : []

    if (!decorationsRef.current) {
      decorationsRef.current = editorInstance.createDecorationsCollection(nextDecorations)
    } else {
      decorationsRef.current.set(nextDecorations)
    }

    const activeMatch = matches[activeMatchIndex]
    if (isOpen && activeMatch) {
      const start = model.getPositionAt(activeMatch.start)
      const end = model.getPositionAt(activeMatch.end)
      editorInstance.revealRangeInCenterIfOutsideViewport(
        new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      )
    }
  }, [activeMatchIndex, editorRef, isOpen, matches, monacoRef])

  useEffect(() => () => {
    decorationsRef.current?.clear()
    decorationsRef.current = null
  }, [])

  return {
    commands: {
      closeSearchPanel,
      isOpenRef,
      moveSearchMatch,
      openSearchPanel,
    },
    panel: {
      activeMatchIndex,
      closeSearchPanel,
      isMatchCaseEnabled: matchCase,
      isOpen,
      isRegexEnabled: regex,
      isReplaceOpen,
      isWholeWordEnabled: wholeWord,
      moveSearchMatch,
      replaceAllMatches,
      replaceCurrentMatch,
      replaceInputRef,
      replaceValue,
      searchInputRef,
      searchValue,
      setIsMatchCaseEnabled: setMatchCase,
      setIsRegexEnabled: setRegex,
      setIsReplaceOpen,
      setIsWholeWordEnabled: setWholeWord,
      setReplaceValue,
      setSearchValue,
      totalMatchCount: matches.length,
    },
  }
}
