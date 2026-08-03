import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
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
  initialSelection?: TextSelectionRange | null
  onChange: (nextValue: string) => void
  onSelectionChange?: (selection: TextSelectionRange | null) => void
  textAreaRef: RefObject<HTMLTextAreaElement>
  value: string
}

type SelectionDirection = 'backward' | 'forward'

interface ActiveSelectionDrag {
  anchorOffset: number
  lastBoundaryOffset: number | null
  pointerId: number
}

function getSelectionAnchor(textarea: HTMLTextAreaElement) {
  return textarea.selectionDirection === 'backward' ? textarea.selectionEnd : textarea.selectionStart
}

function getSelectionDirection(anchorOffset: number, focusOffset: number): SelectionDirection {
  return anchorOffset > focusOffset ? 'backward' : 'forward'
}

function selectionsMatch(first: TextSelectionRange | null, second: TextSelectionRange | null) {
  return first?.start === second?.start && first?.end === second?.end
}

function getLineBoundaryOffset(text: string, offset: number, useLineEnd: boolean) {
  const safeOffset = Math.max(0, Math.min(text.length, offset))
  const lineStart = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1
  if (!useLineEnd) {
    return lineStart
  }

  const lineEnd = text.indexOf('\n', safeOffset)
  return lineEnd === -1 ? text.length : lineEnd
}

function getPointerBoundaryOffset(
  textarea: HTMLTextAreaElement,
  event: PointerEvent,
  activeOffset: number,
) {
  const rect = textarea.getBoundingClientRect()
  const isInsideTextarea =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom

  if (isInsideTextarea) {
    return null
  }

  if (event.clientY < rect.top) {
    return 0
  }

  if (event.clientY > rect.bottom) {
    return textarea.value.length
  }

  return getLineBoundaryOffset(textarea.value, activeOffset, event.clientX > rect.right)
}

export function useWorkspaceFileEditorSelection({
  initialSelection = null,
  onChange,
  onSelectionChange,
  textAreaRef,
  value,
}: UseWorkspaceFileEditorSelectionOptions) {
  const normalizedInitialSelection = normalizeTextSelectionRange(
    initialSelection?.start ?? 0,
    initialSelection?.end ?? 0,
    value.length,
  )
  const selectionRef = useRef<TextSelectionRange | null>(normalizedInitialSelection)
  const [selection, setSelection] = useState<TextSelectionRange | null>(normalizedInitialSelection)
  const activeSelectionDragRef = useRef<ActiveSelectionDrag | null>(null)
  const normalizedEditorValue = useMemo(() => normalizeEditorLineText(value), [value])

  const updateSelection = useCallback((nextSelection: TextSelectionRange | null) => {
    if (selectionsMatch(selectionRef.current, nextSelection)) {
      return
    }

    selectionRef.current = nextSelection
    setSelection(nextSelection)
    onSelectionChange?.(nextSelection)
  }, [onSelectionChange])

  const syncSelection = useCallback((textarea: HTMLTextAreaElement) => {
    const nextSelection = normalizeTextSelectionRange(
      textarea.selectionStart,
      textarea.selectionEnd,
      textarea.value.length,
    )
    updateSelection(nextSelection)
  }, [updateSelection])

  const handleEditorChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    syncSelection(event.currentTarget)
    onChange(event.currentTarget.value)
  }, [onChange, syncSelection])

  const handleEditorSelect = useCallback((event: SyntheticEvent<HTMLTextAreaElement>) => {
    syncSelection(event.currentTarget)
  }, [syncSelection])

  const updateSelectionForPointer = useCallback((event: PointerEvent) => {
    const textarea = textAreaRef.current
    const dragState = activeSelectionDragRef.current
    if (!textarea || !dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const activeOffset = textarea.selectionDirection === 'backward' ? textarea.selectionStart : textarea.selectionEnd
    const boundaryOffset = getPointerBoundaryOffset(textarea, event, activeOffset)
    if (boundaryOffset === null || boundaryOffset === dragState.lastBoundaryOffset) {
      if (boundaryOffset === null) {
        dragState.lastBoundaryOffset = null
      }
      return
    }

    dragState.lastBoundaryOffset = boundaryOffset
    textarea.setSelectionRange(
      dragState.anchorOffset,
      boundaryOffset,
      getSelectionDirection(dragState.anchorOffset, boundaryOffset),
    )
    syncSelection(textarea)
  }, [syncSelection, textAreaRef])

  const handleEditorPointerDown = useCallback((event: ReactPointerEvent<HTMLTextAreaElement>) => {
    if (event.button !== 0 || event.pointerType !== 'mouse') {
      return
    }

    const textarea = event.currentTarget
    const pointerId = event.pointerId
    activeSelectionDragRef.current = {
      anchorOffset: getSelectionAnchor(textarea),
      lastBoundaryOffset: null,
      pointerId,
    }

    try {
      textarea.setPointerCapture(pointerId)
    } catch {
      // Pointer capture is unavailable in a few embedded browser contexts. The window listeners still cover the drag.
    }

    window.requestAnimationFrame(() => {
      const dragState = activeSelectionDragRef.current
      if (!dragState || dragState.pointerId !== pointerId) {
        return
      }

      dragState.anchorOffset = getSelectionAnchor(textarea)
    })
  }, [])

  const clearEditorSelection = useCallback(() => {
    activeSelectionDragRef.current = null
    const textarea = textAreaRef.current
    if (textarea) {
      const caretOffset = textarea.selectionEnd
      textarea.setSelectionRange(caretOffset, caretOffset)
    }
    updateSelection(null)
  }, [textAreaRef, updateSelection])

  useLayoutEffect(() => {
    const textarea = textAreaRef.current
    if (!textarea || !initialSelection) {
      return
    }

    const restoredSelection = normalizeTextSelectionRange(
      initialSelection.start,
      initialSelection.end,
      textarea.value.length,
    )
    if (!restoredSelection) {
      return
    }

    textarea.setSelectionRange(restoredSelection.start, restoredSelection.end)
    updateSelection(restoredSelection)
  }, [initialSelection, textAreaRef, updateSelection])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      updateSelectionForPointer(event)
    }

    function finishSelectionDrag(event: PointerEvent) {
      const dragState = activeSelectionDragRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }

      updateSelectionForPointer(event)
      activeSelectionDragRef.current = null

      const textarea = textAreaRef.current
      if (textarea?.hasPointerCapture(event.pointerId)) {
        textarea.releasePointerCapture(event.pointerId)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishSelectionDrag)
    window.addEventListener('pointercancel', finishSelectionDrag)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishSelectionDrag)
      window.removeEventListener('pointercancel', finishSelectionDrag)
      activeSelectionDragRef.current = null
    }
  }, [textAreaRef, updateSelectionForPointer])

  useEffect(() => {
    let frameId: number | null = null

    function handleDocumentSelectionChange() {
      const textarea = textAreaRef.current
      const isActiveSelectionDrag = activeSelectionDragRef.current !== null
      if (!textarea || (!isActiveSelectionDrag && document.activeElement !== textarea) || frameId !== null) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        const activeTextarea = textAreaRef.current
        if (activeTextarea && (activeSelectionDragRef.current !== null || document.activeElement === activeTextarea)) {
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
    handleEditorPointerDown,
    handleEditorSelect,
    matchesByLine,
  }
}
