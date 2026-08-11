import { lazy, memo, Suspense } from 'react'
import type { GitFileDiff } from '../../types/chat'
import { WorkspaceMonacoLoadingView } from './workspaceFileEditor/WorkspaceMonacoLoadingView'
import { useWorkspaceMonacoEditor } from './workspaceFileEditor/useWorkspaceMonacoEditor'
import type { TextSelectionRange } from './workspaceFileEditor/workspaceEditorTypes'
import { preloadWorkspaceMonacoEditorView } from '../../lib/workspaceMonacoPreload'

const WorkspaceMonacoEditorView = lazy(async () => {
  const editorModule = await preloadWorkspaceMonacoEditorView()
  return { default: editorModule.WorkspaceMonacoEditorView }
})

interface WorkspaceFileEditorProps {
  fileName: string
  filePath: string
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
  filePath,
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
  const editorState = useWorkspaceMonacoEditor({
    fileName,
    filePath,
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
    <Suspense fallback={<WorkspaceMonacoLoadingView />}>
      <WorkspaceMonacoEditorView
        {...editorState}
        value={value}
      />
    </Suspense>
  )
})
