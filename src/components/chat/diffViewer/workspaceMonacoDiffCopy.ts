import type { editor } from 'monaco-editor'

export interface WorkspaceMonacoDiffCopyMenuState {
  hunkText: string
  isDeletion: boolean
  lineNumber: number
  lineText: string
  originalLineCount: number
  position: {
    x: number
    y: number
  }
}

export interface WorkspaceMonacoDiffCopyMenuDimensions {
  height: number
  width: number
}

export interface WorkspaceMonacoDiffCopyMenuViewport {
  height: number
  width: number
}

const MENU_VIEWPORT_GAP_PX = 8
const DEFAULT_MENU_WIDTH_PX = 240
const DEFAULT_MENU_HEIGHT_PX = 88

export function resolveWorkspaceMonacoDiffCopyMenuPosition(
  requestedPosition: WorkspaceMonacoDiffCopyMenuState['position'],
  viewport: WorkspaceMonacoDiffCopyMenuViewport,
  dimensions?: WorkspaceMonacoDiffCopyMenuDimensions | null,
) {
  const width = dimensions?.width ?? DEFAULT_MENU_WIDTH_PX
  const height = dimensions?.height ?? DEFAULT_MENU_HEIGHT_PX

  return {
    left: Math.max(
      MENU_VIEWPORT_GAP_PX,
      Math.min(requestedPosition.x, viewport.width - width - MENU_VIEWPORT_GAP_PX),
    ),
    top: Math.max(
      MENU_VIEWPORT_GAP_PX,
      Math.min(requestedPosition.y, viewport.height - height - MENU_VIEWPORT_GAP_PX),
    ),
  }
}

export function getWorkspaceMonacoDiffOriginalLineCount(change: editor.ILineChange) {
  if (change.originalEndLineNumber < change.originalStartLineNumber) {
    return 0
  }

  return change.originalEndLineNumber - change.originalStartLineNumber + 1
}

export function getWorkspaceMonacoDiffOriginalText(
  model: editor.ITextModel,
  change: editor.ILineChange,
) {
  const lineCount = getWorkspaceMonacoDiffOriginalLineCount(change)
  if (lineCount === 0) {
    return ''
  }

  const lines = Array.from({ length: lineCount }, (_, index) => (
    model.getLineContent(change.originalStartLineNumber + index)
  ))
  const trailingEndOfLine = change.originalEndLineNumber < model.getLineCount() ? model.getEOL() : ''
  return `${lines.join(model.getEOL())}${trailingEndOfLine}`
}

export function getWorkspaceMonacoDiffOriginalLineText(model: editor.ITextModel, lineNumber: number) {
  const lineText = model.getLineContent(lineNumber)
  return lineText.length > 0 ? lineText : model.getEOL()
}
