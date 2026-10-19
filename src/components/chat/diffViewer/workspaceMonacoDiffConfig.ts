import type { editor } from 'monaco-editor'
import { createWorkspaceMonacoOptions } from '../../workspaceExplorer/workspaceFileEditor/workspaceMonacoConfig'

interface CreateWorkspaceMonacoDiffOptionsParams {
  contextLines: number
  isStreaming: boolean
  startLineNumber: number
}

const DEFAULT_EMBEDDED_DIFF_MAX_HEIGHT_PX = 320
const MINIMUM_DIFF_HEIGHT_PX = 20
const ESTIMATED_LINE_HEIGHT_PX = 20

export function estimateWorkspaceMonacoDiffHeight(
  oldContent: string | null | undefined,
  newContent: string,
  contextLines: number,
  maxHeight: number | null,
  viewOnly = false,
) {
  const modified = newContent.split(/\r?\n/u)
  if (viewOnly || oldContent == null) {
    return clampWorkspaceMonacoDiffHeight(modified.length * ESTIMATED_LINE_HEIGHT_PX, maxHeight)
  }

  const original = oldContent.split(/\r?\n/u)
  let prefix = 0
  while (prefix < Math.min(original.length, modified.length) && original[prefix] === modified[prefix]) prefix++
  let suffix = 0
  while (suffix < Math.min(original.length, modified.length) - prefix
    && original[original.length - suffix - 1] === modified[modified.length - suffix - 1]) suffix++

  const surrounding = Math.max(0, Math.trunc(contextLines))
  const visibleLines = prefix === original.length && prefix === modified.length
    ? Math.min(modified.length, surrounding * 2 + 1)
    : Math.max(original.length, modified.length) - prefix - suffix
      + Math.min(prefix, surrounding) + Math.min(suffix, surrounding)
  return clampWorkspaceMonacoDiffHeight(Math.max(1, visibleLines) * ESTIMATED_LINE_HEIGHT_PX, maxHeight)
}

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
    padding: { bottom: 0, top: 0 },
    readOnly: true,
    renderGutterMenu: false,
    renderIndicators: false,
    renderMarginRevertIcon: false,
    renderOverviewRuler: false,
    renderSideBySide: true,
    renderSideBySideInlineBreakpoint: 820,
    scrollbar: {
      alwaysConsumeMouseWheel: false,
      horizontal: 'hidden',
      horizontalScrollbarSize: 0,
      useShadows: false,
      vertical: 'hidden',
      verticalScrollbarSize: 0,
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
    padding: { bottom: 0, top: 0 },
    readOnly: true,
    renderValidationDecorations: 'off',
  }
}
