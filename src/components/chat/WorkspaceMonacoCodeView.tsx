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

const CODE_LINE_HEIGHT_PX = 20
const CODE_VERTICAL_PADDING_PX = 8

function resolveCodeLineCount(code: string) {
  return Math.max(1, code.replace(/\r?\n+$/u, '').split(/\r?\n/u).length)
}

function resolveCodeContentHeight(code: string) {
  return resolveCodeLineCount(code) * CODE_LINE_HEIGHT_PX + CODE_VERTICAL_PADDING_PX * 2
}

function createCodeBlockModelPath(fileName: string | undefined, code: string) {
  let hash = 2166136261
  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return createWorkspaceMonacoModelPath(`__code_blocks__/${fileName || 'untitled.txt'}-${(hash >>> 0).toString(16)}`)
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
    () => createCodeBlockModelPath(fileName, code),
    [code, fileName],
  )
  const [height, setHeight] = useState(() => resolveCodeContentHeight(code))
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const maxHeight = maxBodyHeightClassName?.includes('max-h-80') ? 320 : null
  const theme = getWorkspaceMonacoTheme(resolvedTheme)

  const updateHeight = useCallback(() => {
    const editorInstance = editorRef.current
    const model = editorInstance?.getModel()
    if (!editorInstance || !model) return

    const contentHeight = Math.max(
      CODE_LINE_HEIGHT_PX + CODE_VERTICAL_PADDING_PX * 2,
      model.getLineCount() * CODE_LINE_HEIGHT_PX + CODE_VERTICAL_PADDING_PX * 2,
    )
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
      const contentHeight = resolveCodeContentHeight(code)
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
          padding: { bottom: CODE_VERTICAL_PADDING_PX, top: CODE_VERTICAL_PADDING_PX },
          readOnly: true,
          renderLineHighlight: 'none',
          lineHeight: 20,
          scrollBeyondLastColumn: 0,
          scrollBeyondLastLine: false,
          scrollbar: { alwaysConsumeMouseWheel: false, horizontal: 'hidden', horizontalScrollbarSize: 0, useShadows: false, vertical: maxHeight === null ? 'hidden' : 'auto', verticalScrollbarSize: maxHeight === null ? 0 : 8 },
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
