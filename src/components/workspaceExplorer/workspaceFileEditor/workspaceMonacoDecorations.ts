import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { WorkspaceEditorLineStatus } from './workspaceEditorTypes'

export interface WorkspaceMonacoLineDecoration {
  lineNumber: number
  status: WorkspaceEditorLineStatus
}

export function createWorkspaceMonacoLineDecorations(
  lineStatusByLineNumber: ReadonlyMap<number, WorkspaceEditorLineStatus>,
): WorkspaceMonacoLineDecoration[] {
  return Array.from(lineStatusByLineNumber, ([lineNumber, status]) => ({ lineNumber, status }))
    .sort((left, right) => left.lineNumber - right.lineNumber)
}

export function toMonacoModelDecorations(
  monaco: Monaco,
  decorations: readonly WorkspaceMonacoLineDecoration[],
): editor.IModelDeltaDecoration[] {
  return decorations.map(({ lineNumber, status }) => ({
    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
    options: {
      isWholeLine: true,
      linesDecorationsClassName: status === 'added'
        ? 'workspace-monaco-line-added'
        : 'workspace-monaco-line-changed',
    },
  }))
}
