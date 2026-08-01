import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react'
import {
  buildSelectionRangesByLine,
  normalizeEditorLineText,
  normalizeTextSelectionRange,
  type TextSelectionRange,
} from './workspaceFileEditorUtils'

interface UseWorkspaceFileEditorSelectionOptions {
  onChange: (nextValue: string) => void
  textAreaRef: RefObject<HTMLTextAreaElement>
  value: string
}

export function useWorkspaceFileEditorSelection({
  onChange,
  textAreaRef,
  value,
}: UseWorkspaceFileEditorSelectionOptions) {
  const [selection, setSelection] = useState<TextSelectionRange | null>(null)
  const normalizedEditorValue = useMemo(() => normalizeEditorLineText(value), [value])

  const syncSelection = useCallback((textarea: HTMLTextAreaElement) => {
    const nextSelection = normalizeTextSelectionRange(
      textarea.selectionStart,
      textarea.selectionEnd,
      textarea.value.length,
    )
    setSelection((currentSelection) =>
      currentSelection?.start === nextSelection?.start && currentSelection?.end === nextSelection?.end
        ? currentSelection
        : nextSelection,
    )
  }, [])

  const handleEditorChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    syncSelection(event.currentTarget)
    onChange(event.currentTarget.value)
  }, [onChange, syncSelection])

  const handleEditorSelect = useCallback((event: SyntheticEvent<HTMLTextAreaElement>) => {
    syncSelection(event.currentTarget)
  }, [syncSelection])

  const clearEditorSelection = useCallback(() => {
    const textarea = textAreaRef.current
    if (textarea) {
      const caretOffset = textarea.selectionEnd
      textarea.setSelectionRange(caretOffset, caretOffset)
    }
    setSelection(null)
  }, [textAreaRef])

  useEffect(() => {
    let frameId: number | null = null

    function handleDocumentSelectionChange() {
      const textarea = textAreaRef.current
      if (!textarea || document.activeElement !== textarea || frameId !== null) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        const activeTextarea = textAreaRef.current
        if (activeTextarea && document.activeElement === activeTextarea) {
          syncSelection(activeTextarea)
        }
      })
    }

    document.addEventListener('selectionchange', handleDocumentSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleDocumentSelectionChange)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [syncSelection, textAreaRef])

  const matchesByLine = useMemo(
    () => buildSelectionRangesByLine(normalizedEditorValue, selection),
    [normalizedEditorValue, selection],
  )

  return {
    clearEditorSelection,
    handleEditorChange,
    handleEditorSelect,
    matchesByLine,
  }
}
