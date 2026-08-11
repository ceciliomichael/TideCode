import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { editor } from 'monaco-editor'
import {
  getWorkspaceMonacoDiffOriginalLineCount,
  getWorkspaceMonacoDiffOriginalLineText,
  getWorkspaceMonacoDiffOriginalText,
  type WorkspaceMonacoDiffCopyMenuState,
} from './workspaceMonacoDiffCopy'

interface UseWorkspaceMonacoDiffCopyMenuOptions {
  containerRef: RefObject<HTMLDivElement>
  diffEditorRef: RefObject<editor.IStandaloneDiffEditor | null>
  startLineNumber: number
}

const INLINE_DELETED_MARGIN_SELECTOR = '.inline-deleted-margin-view-zone'
const INLINE_DIFF_ACTION_SELECTOR = '.lightbulb-glyph'

function resolveChangedOriginalLineOffset(
  control: HTMLElement,
  originalEditor: editor.IStandaloneCodeEditor,
  change: editor.ILineChange,
) {
  const requestedTop = Number.parseFloat(control.style.top)
  if (!Number.isFinite(requestedTop) || requestedTop <= 0) {
    return 0
  }

  const originalLineCount = getWorkspaceMonacoDiffOriginalLineCount(change)
  const modelLineCount = originalEditor.getModel()?.getLineCount() ?? change.originalEndLineNumber
  const fallbackLineHeight = control.getBoundingClientRect().height || 20
  let renderedTop = 0

  for (let offset = 0; offset < originalLineCount; offset += 1) {
    const lineNumber = change.originalStartLineNumber + offset
    const renderedHeight = lineNumber < modelLineCount
      ? Math.max(
          fallbackLineHeight,
          originalEditor.getTopForLineNumber(lineNumber + 1) - originalEditor.getTopForLineNumber(lineNumber),
        )
      : fallbackLineHeight

    if (requestedTop < renderedTop + renderedHeight) {
      return offset
    }
    renderedTop += renderedHeight
  }

  return Math.max(0, originalLineCount - 1)
}

function resolveLineChangeForControl(
  container: HTMLDivElement,
  control: HTMLElement,
  diffEditor: editor.IStandaloneDiffEditor,
) {
  const margin = control.closest<HTMLElement>(INLINE_DELETED_MARGIN_SELECTOR)
  if (!margin) {
    return null
  }

  const margins = Array.from(container.querySelectorAll<HTMLElement>(INLINE_DELETED_MARGIN_SELECTOR))
  const marginIndex = margins.indexOf(margin)
  if (marginIndex < 0) {
    return null
  }

  const changesWithOriginalContent = (diffEditor.getLineChanges() ?? []).filter(
    (change) => getWorkspaceMonacoDiffOriginalLineCount(change) > 0,
  )
  return changesWithOriginalContent[marginIndex] ?? null
}

export function useWorkspaceMonacoDiffCopyMenu({
  containerRef,
  diffEditorRef,
  startLineNumber,
}: UseWorkspaceMonacoDiffCopyMenuOptions) {
  const [menuState, setMenuState] = useState<WorkspaceMonacoDiffCopyMenuState | null>(null)
  const closeMenu = useCallback(() => setMenuState(null), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) {
        return
      }

      const control = event.target.closest<HTMLElement>(INLINE_DIFF_ACTION_SELECTOR)
      const diffEditor = diffEditorRef.current
      if (!control || !diffEditor || !container.contains(control)) {
        return
      }

      const change = resolveLineChangeForControl(container, control, diffEditor)
      const originalEditor = diffEditor.getOriginalEditor()
      const originalModel = originalEditor.getModel()
      if (!change || !originalModel) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()

      const lineOffset = resolveChangedOriginalLineOffset(control, originalEditor, change)
      const sourceLineNumber = change.originalStartLineNumber + lineOffset
      const visibleLineNumber = sourceLineNumber + Math.max(1, Math.trunc(startLineNumber)) - 1
      const controlRect = control.getBoundingClientRect()
      const originalLineCount = getWorkspaceMonacoDiffOriginalLineCount(change)
      const isDeletion = change.modifiedEndLineNumber < change.modifiedStartLineNumber

      setMenuState({
        hunkText: getWorkspaceMonacoDiffOriginalText(originalModel, change),
        isDeletion,
        lineNumber: visibleLineNumber,
        lineText: getWorkspaceMonacoDiffOriginalLineText(originalModel, sourceLineNumber),
        originalLineCount,
        position: {
          x: event.clientX,
          y: controlRect.bottom + Math.floor(controlRect.height / 3),
        },
      })
    }

    container.addEventListener('mousedown', handleMouseDown, true)
    return () => container.removeEventListener('mousedown', handleMouseDown, true)
  }, [containerRef, diffEditorRef, startLineNumber])

  useEffect(() => {
    if (!menuState) {
      return
    }

    const handleDismissPointer = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-workspace-diff-copy-menu="true"]')) {
        return
      }
      closeMenu()
    }
    const handleDismissKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }
    const handleDismissViewportChange = () => closeMenu()

    document.addEventListener('mousedown', handleDismissPointer)
    document.addEventListener('keydown', handleDismissKey)
    window.addEventListener('blur', handleDismissViewportChange)
    window.addEventListener('resize', handleDismissViewportChange)
    window.addEventListener('scroll', handleDismissViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', handleDismissPointer)
      document.removeEventListener('keydown', handleDismissKey)
      window.removeEventListener('blur', handleDismissViewportChange)
      window.removeEventListener('resize', handleDismissViewportChange)
      window.removeEventListener('scroll', handleDismissViewportChange, true)
    }
  }, [closeMenu, menuState])

  const copyText = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(closeMenu).catch((error: unknown) => {
      console.error('Failed to copy diff text.', error)
    })
  }, [closeMenu])

  return {
    closeMenu,
    copyText,
    menuState,
  }
}
