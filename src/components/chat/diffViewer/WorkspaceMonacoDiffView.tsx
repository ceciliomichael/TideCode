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
import {
  createWorkspaceMonacoDiffModelPaths,
  ensureWorkspaceMonacoDiffModels,
  releaseWorkspaceMonacoDiffModels,
  retainWorkspaceMonacoDiffModels,
} from './workspaceMonacoDiffModelCache'

interface WorkspaceMonacoDiffViewProps {
  contextLines: number
  contentSignature?: string
  filePath: string
  isStreaming: boolean
  maxBodyHeightClassName?: string
  newContent: string
  onReady?: () => void
  oldContent: string | null | undefined
  startLineNumber: number
  viewOnly: boolean
}

const INITIAL_DIFF_HEIGHT_PX = 160

export function WorkspaceMonacoDiffView({
  contextLines,
  contentSignature,
  filePath,
  isStreaming,
  maxBodyHeightClassName,
  newContent,
  onReady,
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
  const onReadyRef = useRef(onReady)
  const readyReportedRef = useRef(false)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])
  const language = useMemo(() => resolveWorkspaceMonacoLanguage(filePath), [filePath])
  const modelRequest = useMemo(
    () => ({
      contentSignature,
      filePath,
      language,
      newContent,
      oldContent,
    }),
    [contentSignature, filePath, language, newContent, oldContent],
  )
  const modelPaths = useMemo(
    () => createWorkspaceMonacoDiffModelPaths(modelRequest),
    [modelRequest],
  )
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
    readyReportedRef.current = false
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
        if (!readyReportedRef.current && diffEditor.getLineChanges() !== null) {
          readyReportedRef.current = true
          onReadyRef.current?.()
        }
      }),
    )
    updateHeight()
  }, [clearDisposables, closeDiffCopyMenu, maxHeight])

  const handleViewMount = useCallback<OnMount>((editorInstance) => {
    clearDisposables()
    diffEditorRef.current = null
    readyReportedRef.current = true
    closeDiffCopyMenu()
    const updateHeight = () => {
      setHeight(clampWorkspaceMonacoDiffHeight(editorInstance.getContentHeight(), maxHeight))
    }

    disposablesRef.current.push(editorInstance.onDidContentSizeChange(updateHeight))
    updateHeight()
    onReadyRef.current?.()
  }, [clearDisposables, closeDiffCopyMenu, maxHeight])

  useEffect(() => () => {
    clearDisposables()
    diffEditorRef.current = null
  }, [clearDisposables])

  useEffect(() => {
    retainWorkspaceMonacoDiffModels(modelPaths)
    return () => releaseWorkspaceMonacoDiffModels(modelPaths)
  }, [modelPaths])

  const beforeMount = useCallback((monacoInstance: Parameters<NonNullable<React.ComponentProps<typeof Editor>['beforeMount']>>[0]) => {
    defineWorkspaceMonacoThemes(monacoInstance)
    ensureWorkspaceMonacoDiffModels(monacoInstance, modelRequest)
  }, [modelRequest])

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
          keepCurrentModel
          language={language}
          loading={<WorkspaceMonacoDiffLoadingView height={height} />}
          onMount={handleViewMount}
          options={viewOptions}
          path={modelPaths.modifiedModelPath}
          theme={theme}
          value={newContent}
          width="100%"
        />
      ) : (
        <DiffEditor
          beforeMount={beforeMount}
          height="100%"
          keepCurrentModifiedModel
          keepCurrentOriginalModel
          language={language}
          loading={<WorkspaceMonacoDiffLoadingView height={height} />}
          modified={newContent}
          modifiedModelPath={modelPaths.modifiedModelPath}
          onMount={handleDiffMount}
          options={diffOptions}
          original={oldContent ?? ''}
          originalModelPath={modelPaths.originalModelPath}
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
