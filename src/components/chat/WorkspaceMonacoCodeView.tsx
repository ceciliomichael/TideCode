import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { useResolvedDocumentTheme } from '../../hooks/useResolvedDocumentTheme'
import {
  createWorkspaceMonacoModelPath,
  defineWorkspaceMonacoThemes,
  getWorkspaceMonacoTheme,
  resolveWorkspaceMonacoLanguage,
} from '../workspaceExplorer/workspaceFileEditor/workspaceMonacoConfig'
import '../workspaceExplorer/workspaceFileEditor/workspaceMonacoEnvironment'
import { WorkspaceMonacoDiffLoadingView } from './diffViewer/WorkspaceMonacoDiffLoadingView'

interface WorkspaceMonacoCodeViewProps {
  code: string
  fileName?: string
  language?: string
  startLineNumber: number
  maxBodyHeightClassName?: string
  onCopy?: () => void
}

function resolveLanguage(fileName: string | undefined, language: string | undefined) {
  return language?.trim() || resolveWorkspaceMonacoLanguage(fileName || 'untitled.txt')
}

function resolveCodeLineCount(code: string) {
  return Math.max(1, code.replace(/\r?\n+$/u, '').split(/\r?\n/u).length)
}

export function WorkspaceMonacoCodeView({
  code,
  fileName,
  language,
  startLineNumber,
  maxBodyHeightClassName,
}: WorkspaceMonacoCodeViewProps) {
  const resolvedTheme = useResolvedDocumentTheme()
  const resolvedLanguage = useMemo(() => resolveLanguage(fileName, language), [fileName, language])
  const modelPath = useMemo(
    () => createWorkspaceMonacoModelPath(fileName || 'code-block.txt'),
    [fileName],
  )
  const [height, setHeight] = useState(() => Math.max(20, resolveCodeLineCount(code) * 20 - 8))
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const maxHeight = maxBodyHeightClassName?.includes('max-h-80') ? 320 : null
  const theme = getWorkspaceMonacoTheme(resolvedTheme)

  const updateHeight = useCallback(() => {
    const editorInstance = editorRef.current
    const model = editorInstance?.getModel()
    if (!editorInstance || !model) return

    const lineHeight = 20
    const contentHeight = Math.max(20, model.getLineCount() * lineHeight - 8)
    setHeight(maxHeight === null ? contentHeight : Math.min(maxHeight, contentHeight))
  }, [maxHeight])

  const beforeMount = useCallback<BeforeMount>((monaco) => {
    defineWorkspaceMonacoThemes(monaco)
  }, [])

  const onMount = useCallback<OnMount>((editorInstance) => {
    editorRef.current = editorInstance
    updateHeight()
    const disposable = editorInstance.onDidContentSizeChange(updateHeight)
    return () => disposable.dispose()
  }, [updateHeight])

  useEffect(() => {
    setHeight(() => {
      const contentHeight = Math.max(20, resolveCodeLineCount(code) * 20 - 8)
      return maxHeight === null ? contentHeight : Math.min(maxHeight, contentHeight)
    })
  }, [code, maxHeight])

  useEffect(() => () => {
    editorRef.current = null
  }, [])

  return (
    <div className="workspace-monaco-code relative w-full min-w-0 bg-surface" style={{ height: height || 160 }}>
      <Editor
        beforeMount={beforeMount}
        height="100%"
        keepCurrentModel
        language={resolvedLanguage}
        loading={<WorkspaceMonacoDiffLoadingView height={height || 160} />}
        onMount={onMount}
        options={{
          automaticLayout: true,
          contextmenu: true,
          domReadOnly: true,
          folding: false,
          glyphMargin: false,
          lineDecorationsWidth: 14,
          lineNumbers: (lineNumber) => String(lineNumber + Math.max(1, Math.trunc(startLineNumber)) - 1),
          lineNumbersMinChars: 5,
          minimap: { enabled: false },
          padding: { bottom: 0, top: 0 },
          readOnly: true,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          scrollbar: { horizontal: 'auto', horizontalScrollbarSize: 8, useShadows: false, vertical: 'hidden', verticalScrollbarSize: 0 },
          stickyScroll: { enabled: false },
          wordWrap: 'on',
          wrappingIndent: 'same',
        }}
        path={modelPath}
        theme={theme}
        value={code}
        width="100%"
      />
    </div>
  )
}
