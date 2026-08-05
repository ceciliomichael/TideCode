import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent as ReactFocusEvent,
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
  getPointerLineBoundaryOffset?: (clientY: number, useLineEnd: boolean) => number | null
  initialSelection?: TextSelectionRange | null
  onChange: (nextValue: string) => void
  onSelectionChange?: (selection: TextSelectionRange | null) => void
  textAreaRef: RefObject<HTMLTextAreaElement>
  value: string
}

type SelectionDirection = 'backward' | 'forward'

interface ActiveSelectionDrag {
  anchorOffset: number
  focusOffset: number
  lastBoundaryOffset: number | null
  lastClientX: number
  lastClientY: number
  pointerType: string
  pointerId: number
  selectionReady: boolean
}

function getSelectionAnchor(textarea: HTMLTextAreaElement) {
  return textarea.selectionDirection === 'backward' ? textarea.selectionEnd : textarea.selectionStart
}

function getSelectionFocus(textarea: HTMLTextAreaElement, anchorOffset?: number) {
  if (anchorOffset !== undefined && textarea.selectionStart !== textarea.selectionEnd) {
    if (textarea.selectionStart === anchorOffset) {
      return textarea.selectionEnd
    }

    if (textarea.selectionEnd === anchorOffset) {
      return textarea.selectionStart
    }
  }

  return textarea.selectionDirection === 'backward' ? textarea.selectionStart : textarea.selectionEnd
}

function getSelectionDirection(anchorOffset: number, focusOffset: number): SelectionDirection {
  return anchorOffset > focusOffset ? 'backward' : 'forward'
}

function selectionsMatch(first: TextSelectionRange | null, second: TextSelectionRange | null) {
  return first?.start === second?.start && first?.end === second?.end
}

function isWorkspaceTabSwitchTarget(eventTarget: EventTarget | null) {
  return eventTarget instanceof Element && eventTarget.closest('[data-workspace-tab-switch]') !== null
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

function isPointerInsideRect(rect: DOMRect, clientX: number, clientY: number) {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  )
}

function getPointerBoundaryOffset(
  textarea: HTMLTextAreaElement,
  clientX: number,
  clientY: number,
  activeOffset: number,
  getPointerLineBoundaryOffset?: (clientY: number, useLineEnd: boolean) => number | null,
) {
  const rect = textarea.getBoundingClientRect()
  if (isPointerInsideRect(rect, clientX, clientY)) {
    return null
  }

  if (clientY < rect.top) {
    return 0
  }

  if (clientY > rect.bottom) {
    return textarea.value.length
  }

  const useLineEnd = clientX > rect.right
  const renderedLineBoundaryOffset = getPointerLineBoundaryOffset?.(clientY, useLineEnd)
  if (renderedLineBoundaryOffset !== null && renderedLineBoundaryOffset !== undefined) {
    return renderedLineBoundaryOffset
  }

  return getLineBoundaryOffset(textarea.value, activeOffset, useLineEnd)
}

export function useWorkspaceFileEditorSelection({
  getPointerLineBoundaryOffset,
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
  const lastNonEmptySelectionRef = useRef<TextSelectionRange | null>(normalizedInitialSelection)
  const preserveSelectionOnFocusLeaveRef = useRef<TextSelectionRange | null>(null)
  const pendingCollapsedSelectionClearFrameRef = useRef<number | null>(null)
  const outsideReleasePendingRef = useRef(false)
  const [selection, setSelection] = useState<TextSelectionRange | null>(normalizedInitialSelection)
  const activeSelectionDragRef = useRef<ActiveSelectionDrag | null>(null)
  const normalizedEditorValue = useMemo(() => normalizeEditorLineText(value), [value])

  const cancelPendingCollapsedSelectionClear = useCallback(() => {
    const frameId = pendingCollapsedSelectionClearFrameRef.current
    if (frameId === null) {
      return
    }

    window.cancelAnimationFrame(frameId)
    pendingCollapsedSelectionClearFrameRef.current = null
  }, [])

  const scheduleCollapsedSelectionClear = useCallback(() => {
    if (pendingCollapsedSelectionClearFrameRef.current !== null) {
      return
    }

    pendingCollapsedSelectionClearFrameRef.current = window.requestAnimationFrame(() => {
      pendingCollapsedSelectionClearFrameRef.current = null
      if (
        selectionRef.current === null &&
        preserveSelectionOnFocusLeaveRef.current === null &&
        document.activeElement === textAreaRef.current
      ) {
        lastNonEmptySelectionRef.current = null
      }
    })
  }, [textAreaRef])

  const updateSelection = useCallback((nextSelection: TextSelectionRange | null) => {
    const preservedSelection = nextSelection === null ? preserveSelectionOnFocusLeaveRef.current : null
    const effectiveSelection = preservedSelection ?? nextSelection

    if (effectiveSelection) {
      cancelPendingCollapsedSelectionClear()
      lastNonEmptySelectionRef.current = effectiveSelection
    }

    if (selectionsMatch(selectionRef.current, effectiveSelection)) {
      if (effectiveSelection === null) {
        scheduleCollapsedSelectionClear()
      }
      return
    }

    selectionRef.current = effectiveSelection
    setSelection(effectiveSelection)
    onSelectionChange?.(effectiveSelection)

    if (effectiveSelection === null) {
      scheduleCollapsedSelectionClear()
    }
  }, [cancelPendingCollapsedSelectionClear, onSelectionChange, scheduleCollapsedSelectionClear])

  const syncSelection = useCallback((textarea: HTMLTextAreaElement) => {
    const nextSelection = normalizeTextSelectionRange(
      textarea.selectionStart,
      textarea.selectionEnd,
      textarea.value.length,
    )

    if (nextSelection === null && activeSelectionDragRef.current !== null) {
      return
    }

    updateSelection(nextSelection)
  }, [updateSelection])

  const handleEditorChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    syncSelection(event.currentTarget)
    onChange(event.currentTarget.value)
  }, [onChange, syncSelection])

  const handleEditorSelect = useCallback((event: SyntheticEvent<HTMLTextAreaElement>) => {
    syncSelection(event.currentTarget)
  }, [syncSelection])

  const resetSelectionHighlight = useCallback(() => {
    preserveSelectionOnFocusLeaveRef.current = null
    lastNonEmptySelectionRef.current = null
    cancelPendingCollapsedSelectionClear()
    updateSelection(null)
  }, [cancelPendingCollapsedSelectionClear, updateSelection])

  const updateSelectionForPointer = useCallback((clientX: number, clientY: number, pointerId?: number) => {
    const textarea = textAreaRef.current
    const dragState = activeSelectionDragRef.current
    if (!textarea || !dragState || (pointerId !== undefined && dragState.pointerId !== pointerId)) {
      return
    }

    dragState.lastClientX = clientX
    dragState.lastClientY = clientY
    if (!dragState.selectionReady) {
      return
    }

    const boundaryOffset = getPointerBoundaryOffset(
      textarea,
      clientX,
      clientY,
      dragState.focusOffset,
      getPointerLineBoundaryOffset,
    )
    if (boundaryOffset === null || boundaryOffset === dragState.lastBoundaryOffset) {
      if (boundaryOffset === null) {
        dragState.lastBoundaryOffset = null
        dragState.focusOffset = getSelectionFocus(textarea, dragState.anchorOffset)
        syncSelection(textarea)
      }
      return
    }

    dragState.lastBoundaryOffset = boundaryOffset
    dragState.focusOffset = boundaryOffset
    textarea.setSelectionRange(
      dragState.anchorOffset,
      boundaryOffset,
      getSelectionDirection(dragState.anchorOffset, boundaryOffset),
    )
    updateSelection(normalizeTextSelectionRange(
      dragState.anchorOffset,
      boundaryOffset,
      textarea.value.length,
    ))
  }, [getPointerLineBoundaryOffset, syncSelection, textAreaRef, updateSelection])

  const handleEditorPointerDown = useCallback((event: ReactPointerEvent<HTMLTextAreaElement>) => {
    if (event.button !== 0 || event.pointerType === 'touch') {
      return
    }

    const textarea = event.currentTarget
    const pointerId = event.pointerId
    activeSelectionDragRef.current = {
      anchorOffset: getSelectionAnchor(textarea),
      focusOffset: getSelectionFocus(textarea),
      lastBoundaryOffset: null,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      pointerType: event.pointerType || 'mouse',
      pointerId,
      selectionReady: false,
    }
    textarea.setPointerCapture(pointerId)
    resetSelectionHighlight()

    window.requestAnimationFrame(() => {
      const dragState = activeSelectionDragRef.current
      if (!dragState || dragState.pointerId !== pointerId) {
        return
      }

      dragState.anchorOffset = getSelectionAnchor(textarea)
      dragState.focusOffset = getSelectionFocus(textarea)
      dragState.selectionReady = true
      updateSelectionForPointer(dragState.lastClientX, dragState.lastClientY, pointerId)
    })
  }, [resetSelectionHighlight, updateSelectionForPointer])

  const handleEditorBlur = useCallback((event: ReactFocusEvent<HTMLTextAreaElement>) => {
    if (
      preserveSelectionOnFocusLeaveRef.current !== null ||
      activeSelectionDragRef.current !== null ||
      isWorkspaceTabSwitchTarget(event.relatedTarget)
    ) {
      return
    }

    resetSelectionHighlight()
  }, [resetSelectionHighlight])

  const clearEditorSelection = useCallback(() => {
    activeSelectionDragRef.current = null
    preserveSelectionOnFocusLeaveRef.current = null
    lastNonEmptySelectionRef.current = null
    cancelPendingCollapsedSelectionClear()
    const textarea = textAreaRef.current
    if (textarea) {
      const caretOffset = textarea.selectionEnd
      textarea.setSelectionRange(caretOffset, caretOffset)
    }
    updateSelection(null)
  }, [cancelPendingCollapsedSelectionClear, textAreaRef, updateSelection])

  useLayoutEffect(() => {
    const textarea = textAreaRef.current
    if (!textarea || !initialSelection || activeSelectionDragRef.current !== null) {
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
    textarea.focus({ preventScroll: true })
    updateSelection(restoredSelection)
  }, [initialSelection, textAreaRef, updateSelection])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      updateSelectionForPointer(event.clientX, event.clientY, event.pointerId)
    }

    function finishSelectionDrag(clientX: number, clientY: number, pointerId?: number) {
      const dragState = activeSelectionDragRef.current
      if (!dragState || (pointerId !== undefined && dragState.pointerId !== pointerId)) {
        return
      }

      const textarea = textAreaRef.current
      if (textarea && !dragState.selectionReady) {
        dragState.anchorOffset = getSelectionAnchor(textarea)
        dragState.focusOffset = getSelectionFocus(textarea)
        dragState.selectionReady = true
      }
      updateSelectionForPointer(clientX, clientY, pointerId)
      const releasedOutsideEditor =
        textarea !== null && !isPointerInsideRect(textarea.getBoundingClientRect(), clientX, clientY)
      if (releasedOutsideEditor) {
        preserveSelectionOnFocusLeaveRef.current = selectionRef.current
        outsideReleasePendingRef.current = true
      } else {
        outsideReleasePendingRef.current = false
      }
      if (textarea && pointerId !== undefined && textarea.hasPointerCapture(pointerId)) {
        textarea.releasePointerCapture(pointerId)
      }
      activeSelectionDragRef.current = null
    }

    function handlePointerUp(event: PointerEvent) {
      finishSelectionDrag(event.clientX, event.clientY, event.pointerId)
    }

    function handleMouseMove(event: MouseEvent) {
      if (activeSelectionDragRef.current?.pointerType !== 'mouse') {
        return
      }

      updateSelectionForPointer(event.clientX, event.clientY)
    }

    function handleMouseUp(event: MouseEvent) {
      if (event.button !== 0 || activeSelectionDragRef.current?.pointerType !== 'mouse') {
        return
      }

      finishSelectionDrag(event.clientX, event.clientY)
    }

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('mousemove', handleMouseMove, true)
    window.addEventListener('mouseup', handleMouseUp, true)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('mousemove', handleMouseMove, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
    }
  }, [textAreaRef, updateSelectionForPointer])

  useEffect(() => {
    function clearStaleDragOnPointerDown(event: PointerEvent) {
      const dragState = activeSelectionDragRef.current
      if (!dragState || dragState.pointerId === event.pointerId) {
        return
      }

      activeSelectionDragRef.current = null
      outsideReleasePendingRef.current = false
      preserveSelectionOnFocusLeaveRef.current = selectionRef.current
    }

    window.addEventListener('pointerdown', clearStaleDragOnPointerDown, true)

    return () => {
      window.removeEventListener('pointerdown', clearStaleDragOnPointerDown, true)
    }
  }, [])

  useEffect(() => {
    function handleDocumentPointerDown(event: PointerEvent) {
      const textarea = textAreaRef.current
      if (!textarea || event.button !== 0) {
        return
      }

      outsideReleasePendingRef.current = false
      if (isWorkspaceTabSwitchTarget(event.target)) {
        preserveSelectionOnFocusLeaveRef.current = selectionRef.current
        return
      }

      preserveSelectionOnFocusLeaveRef.current = null
      const eventTarget = event.target
      if (eventTarget instanceof Node && textarea.contains(eventTarget)) {
        return
      }

      if (activeSelectionDragRef.current === null) {
        resetSelectionHighlight()
      }
    }

    window.addEventListener('pointerdown', handleDocumentPointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', handleDocumentPointerDown, true)
    }
  }, [resetSelectionHighlight, textAreaRef])

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const textarea = textAreaRef.current
      if (!textarea) {
        return
      }

      if (outsideReleasePendingRef.current) {
        outsideReleasePendingRef.current = false
        return
      }

      if (activeSelectionDragRef.current !== null) {
        return
      }

      if (isWorkspaceTabSwitchTarget(event.target)) {
        return
      }

      const eventTarget = event.target
      if (eventTarget instanceof Node && textarea.contains(eventTarget)) {
        return
      }

      resetSelectionHighlight()
    }

    document.addEventListener('click', handleDocumentClick, true)
    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [resetSelectionHighlight, textAreaRef])

  useEffect(() => {
    let frameId: number | null = null

    function handleDocumentSelectionChange() {
      const textarea = textAreaRef.current
      if (
        !textarea ||
        document.activeElement !== textarea ||
        frameId !== null
      ) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        const activeTextarea = textAreaRef.current
        if (
          activeTextarea &&
          document.activeElement === activeTextarea
        ) {
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
      cancelPendingCollapsedSelectionClear()
    }
  }, [cancelPendingCollapsedSelectionClear, syncSelection, textAreaRef])

  const matchesByLine = useMemo(
    () => buildSelectionRangesByLine(normalizedEditorValue, selection),
    [normalizedEditorValue, selection],
  )

  return {
    clearEditorSelection,
    handleEditorBlur,
    handleEditorChange,
    handleEditorPointerDown,
    handleEditorSelect,
    matchesByLine,
  }
}
