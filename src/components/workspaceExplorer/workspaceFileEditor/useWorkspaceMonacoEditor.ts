import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { BeforeMount, Monaco, OnMount } from '@monaco-editor/react'
import type { editor, IDisposable, Uri } from 'monaco-editor'
import type { GitFileDiff } from '../../../types/chat'
import { useResolvedDocumentTheme } from '../../../hooks/useResolvedDocumentTheme'
import { isMarkdownPreviewablePath } from '../../../lib/markdown-preview'
import { isSvgPreviewablePath } from '../../../lib/svg-preview'
import { buildWorkspaceEditorLineStatusMap } from './workspaceEditorGitStatus'
import type { TextSelectionRange } from './workspaceEditorTypes'
import {
  createWorkspaceMonacoModelPath,
  createWorkspaceMonacoOptions,
  defineWorkspaceMonacoThemes,
  getWorkspaceMonacoTheme,
  getWorkspaceRelativePathFromMonacoUri,
  resolveWorkspaceMonacoLanguage,
} from './workspaceMonacoConfig'
import {
  createWorkspaceMonacoLineDecorations,
  toMonacoModelDecorations,
} from './workspaceMonacoDecorations'
import { useWorkspaceMonacoSearch } from './useWorkspaceMonacoSearch'
import { useWorkspaceMonacoTypeScriptProject } from './useWorkspaceMonacoTypeScriptProject'
import { releaseWorkspaceMonacoModel, retainWorkspaceMonacoModel } from './workspaceMonacoModelCache'
import {
  getWorkspaceMonacoScriptLanguage,
  suspendWorkspaceMonacoTypeScriptDiagnostics,
} from './workspaceMonacoTypeScriptProject'

interface UseWorkspaceMonacoEditorOptions {
  fileName: string
  filePath: string
  gitFileDiff: GitFileDiff | null
  hasRepository: boolean
  initialSelection?: TextSelectionRange | null
  onChange: (nextValue: string) => void
  onOpenFile: (relativePath: string) => void
  onOpenMarkdownPreview?: () => void
  onOpenSvgPreview?: () => void
  onSelectionChange?: (selection: TextSelectionRange | null) => void
  originalContent: string | null
  value: string
  wordWrapEnabled: boolean
  workspaceRootPath?: string | null
}

interface LatestCallbacks {
  onChange: (nextValue: string) => void
  onOpenFile?: (relativePath: string) => void
  onOpenMarkdownPreview?: () => void
  onOpenSvgPreview?: () => void
  onSelectionChange?: (selection: TextSelectionRange | null) => void
}

function getEditorSelectionOffsets(
  editorInstance: editor.IStandaloneCodeEditor,
): TextSelectionRange | null {
  const model = editorInstance.getModel()
  const selection = editorInstance.getSelection()
  if (!model || !selection || selection.isEmpty()) {
    return null
  }

  const anchorOffset = model.getOffsetAt(selection.getStartPosition())
  const activeOffset = model.getOffsetAt(selection.getEndPosition())
  return {
    end: Math.max(anchorOffset, activeOffset),
    start: Math.min(anchorOffset, activeOffset),
  }
}

function applyEditorSelection(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: Monaco,
  selection: TextSelectionRange,
) {
  const model = editorInstance.getModel()
  if (!model) {
    return
  }

  const textLength = model.getValueLength()
  const startOffset = Math.min(textLength, Math.max(0, Math.trunc(selection.start)))
  const endOffset = Math.min(textLength, Math.max(0, Math.trunc(selection.end)))
  const startPosition = model.getPositionAt(Math.min(startOffset, endOffset))
  const endPosition = model.getPositionAt(Math.max(startOffset, endOffset))

  editorInstance.setSelection(new monaco.Selection(
    startPosition.lineNumber,
    startPosition.column,
    endPosition.lineNumber,
    endPosition.column,
  ))
  editorInstance.revealRangeInCenterIfOutsideViewport(new monaco.Range(
    startPosition.lineNumber,
    startPosition.column,
    endPosition.lineNumber,
    endPosition.column,
  ))
}

export function useWorkspaceMonacoEditor({
  fileName,
  filePath,
  gitFileDiff,
  hasRepository,
  initialSelection = null,
  onChange,
  onOpenFile,
  onOpenMarkdownPreview,
  onOpenSvgPreview,
  onSelectionChange,
  originalContent,
  value,
  wordWrapEnabled,
  workspaceRootPath,
}: UseWorkspaceMonacoEditorOptions) {
  const resolvedTheme = useResolvedDocumentTheme()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const retainedModelRef = useRef<editor.ITextModel | null>(null)
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const disposablesRef = useRef<IDisposable[]>([])
  const callbacksRef = useRef<LatestCallbacks>({ onChange })
  callbacksRef.current = {
    onChange,
    onOpenFile,
    onOpenMarkdownPreview,
    onOpenSvgPreview,
    onSelectionChange,
  }
  const search = useWorkspaceMonacoSearch({
    editorRef,
    fileName,
    monacoRef,
    value,
  })
  const searchCommandsRef = useRef(search.commands)
  searchCommandsRef.current = search.commands

  const language = useMemo(
    () => resolveWorkspaceMonacoLanguage(filePath || fileName),
    [fileName, filePath],
  )
  const modelPath = useMemo(
    () => createWorkspaceMonacoModelPath(filePath || fileName),
    [fileName, filePath],
  )
  const options = useMemo(
    () => createWorkspaceMonacoOptions(wordWrapEnabled),
    [wordWrapEnabled],
  )
  useWorkspaceMonacoTypeScriptProject({
    filePath: filePath || fileName,
    language,
    monacoRef,
    workspaceRootPath,
  })
  const theme = getWorkspaceMonacoTheme(resolvedTheme)
  const lineDecorations = useMemo(() => {
    if (!hasRepository) {
      return []
    }

    const baselineContent = gitFileDiff ? gitFileDiff.oldContent : originalContent
    return createWorkspaceMonacoLineDecorations(
      buildWorkspaceEditorLineStatusMap(baselineContent, value),
    )
  }, [gitFileDiff, hasRepository, originalContent, value])

  const applyLineDecorations = useCallback(() => {
    const editorInstance = editorRef.current
    const monacoInstance = monacoRef.current
    if (!editorInstance || !monacoInstance) {
      return
    }

    const nextDecorations = toMonacoModelDecorations(monacoInstance, lineDecorations)
    if (!decorationsRef.current) {
      decorationsRef.current = editorInstance.createDecorationsCollection(nextDecorations)
      return
    }

    decorationsRef.current.set(nextDecorations)
  }, [lineDecorations])

  const beforeMount = useCallback<BeforeMount>((monacoInstance) => {
    defineWorkspaceMonacoThemes(monacoInstance)
    const scriptLanguage = getWorkspaceMonacoScriptLanguage(language)
    if (scriptLanguage && workspaceRootPath?.trim()) {
suspendWorkspaceMonacoTypeScriptDiagnostics(monacoInstance, scriptLanguage, workspaceRootPath)
    }
  }, [language, workspaceRootPath])

  const onMount = useCallback<OnMount>((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance
    monacoRef.current = monacoInstance
    const mountedModel = editorInstance.getModel()
    if (mountedModel) {
      retainedModelRef.current = mountedModel
      retainWorkspaceMonacoModel(mountedModel)
    }

    disposablesRef.current.push(
      monacoInstance.editor.registerEditorOpener({
openCodeEditor: (_source: editor.ICodeEditor, resource: Uri) => {
          const relativePath = getWorkspaceRelativePathFromMonacoUri(resource.toString())
          if (!relativePath || relativePath.startsWith('__code_blocks__/')) {
            return false
          }

          callbacksRef.current.onOpenFile?.(relativePath)
          return true
        },
      }),
      editorInstance.onDidChangeCursorSelection(() => {
        callbacksRef.current.onSelectionChange?.(getEditorSelectionOffsets(editorInstance))
      }),
      editorInstance.onKeyDown((event) => {
        if (event.keyCode === monacoInstance.KeyCode.Escape && searchCommandsRef.current.isOpenRef.current) {
          event.preventDefault()
          event.stopPropagation()
          searchCommandsRef.current.closeSearchPanel()
        }
      }),
    )

    editorInstance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyF,
      () => searchCommandsRef.current.openSearchPanel(false),
    )
    editorInstance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyH,
      () => searchCommandsRef.current.openSearchPanel(true),
    )
    editorInstance.addCommand(
      monacoInstance.KeyCode.F3,
      () => searchCommandsRef.current.moveSearchMatch(1),
    )
    editorInstance.addCommand(
      monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.F3,
      () => searchCommandsRef.current.moveSearchMatch(-1),
    )

    if (isSvgPreviewablePath(fileName) && callbacksRef.current.onOpenSvgPreview) {
      editorInstance.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyV,
        () => callbacksRef.current.onOpenSvgPreview?.(),
      )
    } else if (isMarkdownPreviewablePath(fileName) && callbacksRef.current.onOpenMarkdownPreview) {
      editorInstance.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyV,
        () => callbacksRef.current.onOpenMarkdownPreview?.(),
      )
    }

    if (initialSelection) {
      applyEditorSelection(editorInstance, monacoInstance, initialSelection)
    }

    const nextDecorations = toMonacoModelDecorations(monacoInstance, lineDecorations)
    decorationsRef.current = editorInstance.createDecorationsCollection(nextDecorations)
}, [fileName, initialSelection, lineDecorations])

  const handleChange = useCallback((nextValue: string | undefined) => {
    if (nextValue !== undefined && nextValue !== value) {
      callbacksRef.current.onChange(nextValue)
    }
  }, [value])

  useEffect(() => {
    applyLineDecorations()
  }, [applyLineDecorations])

  useEffect(() => {
    const editorInstance = editorRef.current
    const monacoInstance = monacoRef.current
    if (!editorInstance || !monacoInstance || !initialSelection) {
      return
    }

    const currentSelection = getEditorSelectionOffsets(editorInstance)
    if (
      currentSelection?.start === initialSelection.start &&
      currentSelection.end === initialSelection.end
    ) {
      return
    }

    applyEditorSelection(editorInstance, monacoInstance, initialSelection)
  }, [initialSelection])

  useEffect(() => () => {
    for (const disposable of disposablesRef.current) {
      disposable.dispose()
    }
    disposablesRef.current = []
    decorationsRef.current?.clear()
    decorationsRef.current = null
    if (retainedModelRef.current) {
      releaseWorkspaceMonacoModel(retainedModelRef.current)
      retainedModelRef.current = null
    }
    editorRef.current = null
    monacoRef.current = null
  }, [])

  return {
    beforeMount,
    handleChange,
    language,
    modelPath,
    onMount,
    options,
    searchPanel: search.panel,
    theme,
  }
}
