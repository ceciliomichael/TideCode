import type { editor, Position } from 'monaco-editor'
import { findWorkspaceMonacoModuleSpecifierRange } from './workspaceMonacoModuleDefinition'

export interface WorkspaceMonacoHoverAnchorRect {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

export interface WorkspaceMonacoHoverAnchor {
  key: string
  rect: WorkspaceMonacoHoverAnchorRect
}

function getHoverColumnRange(model: editor.ITextModel, position: Position) {
  const moduleRange = findWorkspaceMonacoModuleSpecifierRange(
    model.getLineContent(position.lineNumber),
    position.column,
  )
  if (moduleRange) return moduleRange

  const word = model.getWordAtPosition(position)
  if (word) return { startColumn: word.startColumn, endColumn: word.endColumn }
  return { startColumn: position.column, endColumn: position.column + 1 }
}

export function createWorkspaceMonacoHoverAnchor(
  editorInstance: editor.IStandaloneCodeEditor,
  position: Position,
): WorkspaceMonacoHoverAnchor | null {
  const model = editorInstance.getModel()
  const editorNode = editorInstance.getDomNode()
  if (!model || !editorNode) return null

  const columnRange = getHoverColumnRange(model, position)
  const start = editorInstance.getScrolledVisiblePosition({
    lineNumber: position.lineNumber,
    column: columnRange.startColumn,
  })
  const end = editorInstance.getScrolledVisiblePosition({
    lineNumber: position.lineNumber,
    column: columnRange.endColumn,
  })
  if (!start || !end) return null

  const editorRect = editorNode.getBoundingClientRect()
  if (editorRect.width <= 0 || editorRect.height <= 0) return null

  const left = Math.max(editorRect.left, editorRect.left + start.left)
  const right = Math.min(editorRect.right, editorRect.left + end.left)
  const top = editorRect.top + Math.min(start.top, end.top)
  const height = Math.max(start.height, end.height)
  const bottom = top + height
  const width = right - left
  const values = [left, right, top, bottom, width, height]
  if (!values.every(Number.isFinite) || width <= 0 || height <= 0) return null
  if (right <= editorRect.left || left >= editorRect.right || bottom <= editorRect.top || top >= editorRect.bottom) {
    return null
  }

  return {
    key: model.uri.toString() + ':' + position.lineNumber + ':' + columnRange.startColumn + ':' + columnRange.endColumn,
    rect: { bottom, height, left, right, top, width },
  }
}
