import Editor, { DiffEditor, type DiffOnMount, type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor, IDisposable } from 'monaco-editor'
import { useResolvedDocumentTheme } from '../../../hooks/useResolvedDocumentTheme'
import {
  defineWorkspaceMonacoThemes,
  getWorkspaceMonacoTheme,
  resolveWorkspaceMonacoLanguage,
} from '../../workspaceExplorer/workspaceFileEditor/workspaceMonacoConfig'
import '../../workspaceExplorer/workspaceFileEditor/workspaceMonacoEnvironment'
import {
  clampWorkspaceMonacoDiffHeight,
  createWorkspaceMonacoDiffOptions,
  createWorkspaceMonacoViewOptions,
  resolveWorkspaceMonacoDiffMaxHeight,
} from './workspaceMonacoDiffConfig'
import { WorkspaceMonacoDiffLoadingView } from './WorkspaceMonacoDiffLoadingView'
import { WorkspaceMonacoDiffCopyMenu } from './WorkspaceMonacoDiffCopyMenu'
import { useWorkspaceMonacoDiffCopyMenu } from './useWorkspaceMonacoDiffCopyMenu'

interface WorkspaceMonacoDiffViewProps {
  contextLines: number
  filePath: string
  isStreaming: boolean
  maxBodyHeightClassName?: string
  newContent: string
  oldContent: string | null | undefined
  startLineNumber: number
  viewOnly: boolean
}

const INITIAL_DIFF_HEIGHT_PX = 160

export function WorkspaceMonacoDiffView({
  contextLines,
  filePath,
  isStreaming,
  maxBodyHeightClassName,
  newContent,
  oldContent,
  startLineNumber,
  viewOnly,
}: WorkspaceMonacoDiffViewProps) {
  const resolvedTheme = useResolvedDocumentTheme()
  const maxHeight = resolveWorkspaceMonacoDiffMaxHeight(maxBodyHeightClassName)
  const [height, setHeight] = useState(() => clampWorkspaceMonacoDiffHeight(INITIAL_DIFF_HEIGHT_PX, maxHeight))
  const containerRef = useRef<HTMLDivElement | null>(null)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const disposablesRef = useRef<IDisposable[]>([])
  const language = useMemo(() => resolveWorkspaceMonacoLanguage(filePath), [filePath])
  const theme = getWorkspaceMonacoTheme(resolvedTheme)
  const diffOptions = useMemo(
    () => createWorkspaceMonacoDiffOptions({ contextLines, isStreaming, startLineNumber }),
    [contextLines, isStreaming, startLineNumber],
  )
  const viewOptions = useMemo(
    () => createWorkspaceMonacoViewOptions(startLineNumber),
    [startLineNumber],
  )
  const {
    closeMenu: closeDiffCopyMenu,
    copyText: copyDiffText,
    menuState: diffCopyMenuState,
  } = useWorkspaceMonacoDiffCopyMenu({
    containerRef,
    diffEditorRef,
    startLineNumber,
  })

  const clearDisposables = useCallback(() => {
    for (const disposable of disposablesRef.current) {
      disposable.dispose()
    }
    disposablesRef.current = []
  }, [])

  const handleDiffMount = useCallback<DiffOnMount>((diffEditor) => {
    clearDisposables()
    diffEditorRef.current = diffEditor
    const originalEditor = diffEditor.getOriginalEditor()
    const modifiedEditor = diffEditor.getModifiedEditor()
    const updateHeight = () => {
      const contentHeight = Math.max(originalEditor.getContentHeight(), modifiedEditor.getContentHeight())
      setHeight(clampWorkspaceMonacoDiffHeight(contentHeight, maxHeight))
    }

    disposablesRef.current.push(
      originalEditor.onDidContentSizeChange(updateHeight),
      modifiedEditor.onDidContentSizeChange(updateHeight),
      diffEditor.onDidUpdateDiff(() => {
        closeDiffCopyMenu()
        updateHeight()
      }),
    )
    updateHeight()
  }, [clearDisposables, closeDiffCopyMenu, maxHeight])

  const handleViewMount = useCallback<OnMount>((editorInstance) => {
    clearDisposables()
    diffEditorRef.current = null
    closeDiffCopyMenu()
    const updateHeight = () => {
      setHeight(clampWorkspaceMonacoDiffHeight(editorInstance.getContentHeight(), maxHeight))
    }

    disposablesRef.current.push(editorInstance.onDidContentSizeChange(updateHeight))
    updateHeight()
  }, [clearDisposables, closeDiffCopyMenu, maxHeight])

  useEffect(() => () => {
    clearDisposables()
    diffEditorRef.current = null
  }, [clearDisposables])

  const beforeMount = useCallback((monacoInstance: Parameters<NonNullable<React.ComponentProps<typeof Editor>['beforeMount']>>[0]) => {
    defineWorkspaceMonacoThemes(monacoInstance)
  }, [])

  return (
    <div
      ref={containerRef}
      className="workspace-monaco-diff relative w-full min-w-0 bg-surface"
      style={{ height: `${height}px` }}
    >
      {viewOnly ? (
        <Editor
          beforeMount={beforeMount}
          height="100%"
          keepCurrentModel={false}
          language={language}
          loading={<WorkspaceMonacoDiffLoadingView height={height} />}
          onMount={handleViewMount}
          options={viewOptions}
          theme={theme}
          value={newContent}
          width="100%"
        />
      ) : (
        <DiffEditor
          beforeMount={beforeMount}
          height="100%"
          keepCurrentModifiedModel={false}
          keepCurrentOriginalModel={false}
          language={language}
          loading={<WorkspaceMonacoDiffLoadingView height={height} />}
          modified={newContent}
          onMount={handleDiffMount}
          options={diffOptions}
          original={oldContent ?? ''}
          theme={theme}
          width="100%"
        />
      )}
      <WorkspaceMonacoDiffCopyMenu
        menuState={diffCopyMenuState}
        onClose={closeDiffCopyMenu}
        onCopy={copyDiffText}
      />
    </div>
  )
}
