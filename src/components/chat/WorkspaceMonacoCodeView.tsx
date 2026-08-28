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
import {
  clampRenderedCodeContentHeight,
  CODE_VERTICAL_PADDING_PX,
  resolveInitialCodeContentHeight,
} from './workspaceMonacoCodeSizing'

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
  const [height, setHeight] = useState(() => resolveInitialCodeContentHeight(code))
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const contentSizeDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const maxHeight = maxBodyHeightClassName?.includes('max-h-80') ? 320 : null
  const maxHeightRef = useRef<number | null>(maxHeight)
  maxHeightRef.current = maxHeight
  const theme = getWorkspaceMonacoTheme(resolvedTheme)

  const updateHeight = useCallback(() => {
    const editorInstance = editorRef.current
    if (!editorInstance) return

    const currentMaxHeight = maxHeightRef.current
    setHeight(clampRenderedCodeContentHeight(editorInstance.getContentHeight(), currentMaxHeight))
  }, [])

  const beforeMount = useCallback<BeforeMount>((monaco) => {
    defineWorkspaceMonacoThemes(monaco)
  }, [])

  const onMount = useCallback<OnMount>((editorInstance) => {
    editorRef.current = editorInstance
    contentSizeDisposableRef.current?.dispose()
    contentSizeDisposableRef.current = editorInstance.onDidContentSizeChange(updateHeight)
    updateHeight()
  }, [updateHeight])

  useEffect(() => {
    if (editorRef.current) {
      updateHeight()
      return
    }
    setHeight(() => {
      const contentHeight = resolveInitialCodeContentHeight(code)
      return maxHeight === null ? contentHeight : Math.min(maxHeight, contentHeight)
    })
  }, [code, maxHeight, updateHeight])

  useEffect(() => () => {
    contentSizeDisposableRef.current?.dispose()
    contentSizeDisposableRef.current = null
    editorRef.current = null
  }, [])

  return (
    <div className="workspace-monaco-code relative w-full min-w-0 bg-surface" style={{ height: height || 160 }}>
        <Editor
        beforeMount={beforeMount}
          className="selectable-ui"
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
