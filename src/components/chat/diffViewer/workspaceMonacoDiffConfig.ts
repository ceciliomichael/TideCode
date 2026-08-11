import type { editor } from 'monaco-editor'
import { createWorkspaceMonacoOptions } from '../../workspaceExplorer/workspaceFileEditor/workspaceMonacoConfig'

interface CreateWorkspaceMonacoDiffOptionsParams {
  contextLines: number
  isStreaming: boolean
  startLineNumber: number
}

const DEFAULT_EMBEDDED_DIFF_MAX_HEIGHT_PX = 320
const MINIMUM_DIFF_HEIGHT_PX = 80

export function resolveWorkspaceMonacoDiffMaxHeight(maxBodyHeightClassName?: string) {
  if (!maxBodyHeightClassName) {
    return null
  }

  if (maxBodyHeightClassName.split(/\s+/u).includes('max-h-80')) {
    return DEFAULT_EMBEDDED_DIFF_MAX_HEIGHT_PX
  }

  return DEFAULT_EMBEDDED_DIFF_MAX_HEIGHT_PX
}

export function clampWorkspaceMonacoDiffHeight(contentHeight: number, maxHeight: number | null) {
  const safeContentHeight = Math.max(MINIMUM_DIFF_HEIGHT_PX, Math.ceil(contentHeight))
  return maxHeight === null ? safeContentHeight : Math.min(maxHeight, safeContentHeight)
}

export function createWorkspaceMonacoDiffOptions({
  contextLines,
  isStreaming,
  startLineNumber,
}: CreateWorkspaceMonacoDiffOptionsParams): editor.IDiffEditorConstructionOptions {
  const sharedOptions = createWorkspaceMonacoOptions(true)

  return {
    ...sharedOptions,
    accessibilityVerbose: false,
    compactMode: true,
    diffAlgorithm: 'advanced',
    diffCodeLens: false,
    diffWordWrap: 'on',
    domReadOnly: true,
    enableSplitViewResizing: true,
    experimental: {
      showEmptyDecorations: true,
      showMoves: false,
      useTrueInlineView: true,
    },
    folding: false,
    foldingHighlight: false,
    hideUnchangedRegions: {
      contextLineCount: Math.max(0, Math.trunc(contextLines)),
      enabled: true,
      minimumLineCount: 3,
      revealLineCount: Math.max(1, Math.min(20, Math.trunc(contextLines) || 1)),
    },
    ignoreTrimWhitespace: false,
    lineDecorationsWidth: 14,
    lineNumbers: (lineNumber) => String(lineNumber + Math.max(1, Math.trunc(startLineNumber)) - 1),
    lineNumbersMinChars: 5,
    maxComputationTime: isStreaming ? 1_500 : 5_000,
    minimap: { enabled: false },
    originalEditable: false,
    readOnly: true,
    renderGutterMenu: false,
    renderIndicators: false,
    renderMarginRevertIcon: false,
    renderOverviewRuler: false,
    renderSideBySide: true,
    renderSideBySideInlineBreakpoint: 820,
    scrollbar: {
      alwaysConsumeMouseWheel: false,
      horizontal: 'auto',
      horizontalScrollbarSize: 8,
      useShadows: false,
      vertical: 'auto',
      verticalScrollbarSize: 8,
    },
    splitViewDefaultRatio: 0.5,
    showFoldingControls: 'never',
    useInlineViewWhenSpaceIsLimited: true,
    wordWrap: 'on',
    wrappingIndent: 'same',
    wrappingStrategy: 'advanced',
  }
}

export function createWorkspaceMonacoViewOptions(
  startLineNumber: number,
): editor.IStandaloneEditorConstructionOptions {
  return {
    ...createWorkspaceMonacoOptions(true),
    domReadOnly: true,
    lineNumbers: (lineNumber) => String(lineNumber + Math.max(1, Math.trunc(startLineNumber)) - 1),
    readOnly: true,
    renderValidationDecorations: 'off',
  }
}
