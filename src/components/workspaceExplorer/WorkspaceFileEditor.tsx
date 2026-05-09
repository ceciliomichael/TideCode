import { memo } from 'react'
import type { GitFileDiff } from '../../types/chat'
import { WorkspaceFileEditorView } from './workspaceFileEditor/WorkspaceFileEditorView'
import { useWorkspaceFileEditorState } from './workspaceFileEditor/useWorkspaceFileEditorState'

interface WorkspaceFileEditorProps {
  fileName: string
  gitFileDiff: GitFileDiff | null
  onOpenMarkdownPreview?: () => void
  originalContent: string | null
  value: string
  wordWrapEnabled: boolean
  onChange: (nextValue: string) => void
}

export const WorkspaceFileEditor = memo(function WorkspaceFileEditor({
  fileName,
  gitFileDiff,
  onOpenMarkdownPreview,
  originalContent,
  value,
  wordWrapEnabled,
  onChange,
}: WorkspaceFileEditorProps) {
  const editorState = useWorkspaceFileEditorState({
    fileName,
    gitFileDiff,
    onOpenMarkdownPreview,
    originalContent,
    onChange,
    value,
    wordWrapEnabled,
  })

  return (
    <WorkspaceFileEditorView
      editorState={editorState}
      fileName={fileName}
      onChange={onChange}
      value={value}
      wordWrapEnabled={wordWrapEnabled}
    />
  )
})
