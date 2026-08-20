import type { editor, Position } from 'monaco-editor'
import {
  findWorkspaceMonacoModuleSpecifierRange,
  findWorkspaceMonacoModuleSpecifierRanges,
  type WorkspaceMonacoModuleSpecifierRange,
} from './workspaceMonacoModuleDefinition'

export interface WorkspaceMonacoModuleHitTarget {
  position: Position
  range: WorkspaceMonacoModuleSpecifierRange
}

function isPointInsideRenderedRange(
  editorInstance: editor.IStandaloneCodeEditor,
  lineNumber: number,
  range: WorkspaceMonacoModuleSpecifierRange,
  clientX: number,
  clientY: number,
) {
  const editorNode = editorInstance.getDomNode()
  if (!editorNode) return false

  const start = editorInstance.getScrolledVisiblePosition({
    lineNumber,
    column: range.startColumn,
  })
  const end = editorInstance.getScrolledVisiblePosition({
    lineNumber,
    column: range.endColumn,
  })
  if (!start || !end || start.top !== end.top) return false

  const editorRect = editorNode.getBoundingClientRect()
  const left = editorRect.left + Math.min(start.left, end.left)
  const right = editorRect.left + Math.max(start.left, end.left)
  const top = editorRect.top + start.top
  const bottom = top + Math.max(start.height, end.height)

  return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom
}

export function resolveWorkspaceMonacoModuleHitTarget(
  editorInstance: editor.IStandaloneCodeEditor,
  clientX: number,
  clientY: number,
  fallbackPosition: Position | null,
): WorkspaceMonacoModuleHitTarget | null {
  const model = editorInstance.getModel()
  if (!model) return null

  const livePosition = editorInstance.getTargetAtClientPoint(clientX, clientY)?.position ?? fallbackPosition
  if (!livePosition) return null

  const lineText = model.getLineContent(livePosition.lineNumber)
  const directRange = findWorkspaceMonacoModuleSpecifierRange(lineText, livePosition.column)
  if (directRange) return { position: livePosition, range: directRange }

  // Monaco reports insertion positions rather than character boxes. Around '.',
  // '/', and quote/token boundaries that position can momentarily fall just
  // outside the string even though the pointer is still visibly over the path.
  // Fall back to the rendered module range so the whole path is one hit target.
  const renderedRange = findWorkspaceMonacoModuleSpecifierRanges(lineText).find((range) => (
    isPointInsideRenderedRange(
      editorInstance,
      livePosition.lineNumber,
      range,
      clientX,
      clientY,
    )
  ))
  return renderedRange ? { position: livePosition, range: renderedRange } : null
}
