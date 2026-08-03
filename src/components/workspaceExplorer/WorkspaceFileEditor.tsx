import { memo } from 'react'
import type { GitFileDiff } from '../../types/chat'
import { WorkspaceFileEditorView } from './workspaceFileEditor/WorkspaceFileEditorView'
import { useWorkspaceFileEditorState } from './workspaceFileEditor/useWorkspaceFileEditorState'
import type { TextSelectionRange } from './workspaceFileEditor/workspaceFileEditorUtils'

interface WorkspaceFileEditorProps {
  fileName: string
  gitFileDiff: GitFileDiff | null
  hasRepository: boolean
  initialSelection?: TextSelectionRange | null
  onOpenMarkdownPreview?: () => void
  onOpenSvgPreview?: () => void
  originalContent: string | null
  onSelectionChange?: (selection: TextSelectionRange | null) => void
  value: string
  wordWrapEnabled: boolean
  onChange: (nextValue: string) => void
}

export const WorkspaceFileEditor = memo(function WorkspaceFileEditor({
  fileName,
  gitFileDiff,
  hasRepository,
  initialSelection,
  onOpenMarkdownPreview,
  onOpenSvgPreview,
  originalContent,
  onSelectionChange,
  value,
  wordWrapEnabled,
  onChange,
}: WorkspaceFileEditorProps) {
  const editorState = useWorkspaceFileEditorState({
    fileName,
    gitFileDiff,
    hasRepository,
    initialSelection,
    onOpenMarkdownPreview,
    onOpenSvgPreview,
    originalContent,
    onSelectionChange,
    onChange,
    value,
    wordWrapEnabled,
  })

  return (
    <WorkspaceFileEditorView
      editorState={editorState}
      fileName={fileName}
      value={value}
      wordWrapEnabled={wordWrapEnabled}
    />
  )
})
