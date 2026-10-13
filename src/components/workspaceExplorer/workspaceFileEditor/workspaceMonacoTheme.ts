import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { ResolvedTheme } from '../../../lib/theme'

export const WORKSPACE_MONACO_LIGHT_THEME = 'tidecode-light'
export const WORKSPACE_MONACO_DARK_THEME = 'tidecode-dark'

export const WORKSPACE_MONACO_LIGHT_COLORS = {
  'diffEditor.diagonalFill': '#d4d9d5',
  'diffEditor.insertedLineBackground': '#10b9812e',
  'diffEditor.insertedTextBackground': '#00000000',
  'diffEditor.removedLineBackground': '#ef44442e',
  'diffEditor.removedTextBackground': '#00000000',
  'diffEditorGutter.insertedLineBackground': '#00000000',
  'diffEditorGutter.removedLineBackground': '#00000000',
  'editor.background': '#ffffff',
  'editorCursor.foreground': '#202221',
  'editor.findMatchBackground': '#1267b2',
  'editor.findMatchForeground': '#ffffff',
  'editor.findMatchHighlightBackground': '#b8d8f4',
  'editor.foreground': '#202221',
  'editor.inactiveSelectionBackground': '#1e76ceb8',
  'editor.lineHighlightBackground': '#00000000',
  'editor.selectionBackground': '#1e76ce',
  'editor.selectionForeground': '#ffffff',
  'editorGutter.background': '#ffffff',
  'editorIndentGuide.activeBackground1': '#a4aaa6',
  'editorIndentGuide.background1': '#e1e5e2',
  'editorLineNumber.activeForeground': '#8a908c',
  'editorLineNumber.foreground': '#8a908c',
  'editorSuggestWidget.background': '#ffffff',
  'editorSuggestWidget.border': '#d4d9d5',
  'editorSuggestWidget.selectedBackground': '#d9e9e6',
  'editorWidget.background': '#ffffff',
  'editorWidget.border': '#d4d9d5',
  'scrollbarSlider.activeBackground': '#727278a8',
  'scrollbarSlider.background': '#a8a8ad70',
  'scrollbarSlider.hoverBackground': '#8b8b918f',
} as const

export const WORKSPACE_MONACO_DARK_COLORS = {
  'diffEditor.diagonalFill': '#38383d',
  'diffEditor.insertedLineBackground': '#10b9813d',
  'diffEditor.insertedTextBackground': '#00000000',
  'diffEditor.removedLineBackground': '#ef44443d',
  'diffEditor.removedTextBackground': '#00000000',
  'diffEditorGutter.insertedLineBackground': '#00000000',
  'diffEditorGutter.removedLineBackground': '#00000000',
  'editor.background': '#171718',
  'editorCursor.foreground': '#e9e9ea',
  'editor.findMatchBackground': '#1976c8',
  'editor.findMatchForeground': '#ffffff',
  'editor.findMatchHighlightBackground': '#294c6b',
  'editor.foreground': '#e9e9ea',
  'editor.inactiveSelectionBackground': '#246fb0cc',
  'editor.lineHighlightBackground': '#00000000',
  'editor.selectionBackground': '#246fb0',
  'editor.selectionForeground': '#ffffff',
  'editorGutter.background': '#171718',
  'editorIndentGuide.activeBackground1': '#5e5e65',
  'editorIndentGuide.background1': '#2c2c30',
  'editorLineNumber.activeForeground': '#8f8f95',
  'editorLineNumber.foreground': '#8f8f95',
  'editorSuggestWidget.background': '#242426',
  'editorSuggestWidget.border': '#38383d',
  'editorSuggestWidget.selectedBackground': '#223630',
  'editorWidget.background': '#242426',
  'editorWidget.border': '#38383d',
  'scrollbarSlider.activeBackground': '#a2a2aaa8',
  'scrollbarSlider.background': '#7c7c8170',
  'scrollbarSlider.hoverBackground': '#9292998f',
} as const

export const WORKSPACE_MONACO_LIGHT_THEME_DATA: editor.IStandaloneThemeData = {
  base: 'vs',
  colors: WORKSPACE_MONACO_LIGHT_COLORS,
  inherit: true,
  rules: [],
}

export const WORKSPACE_MONACO_DARK_THEME_DATA: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  colors: WORKSPACE_MONACO_DARK_COLORS,
  inherit: true,
  rules: [],
}

const workspaceMonacoThemeInstances = new WeakSet<object>()

export function getWorkspaceMonacoTheme(theme: ResolvedTheme) {
  return theme === 'dark' ? WORKSPACE_MONACO_DARK_THEME : WORKSPACE_MONACO_LIGHT_THEME
}

export function defineWorkspaceMonacoThemes(monaco: Monaco) {
  if (workspaceMonacoThemeInstances.has(monaco)) {
    return
  }

  monaco.editor.defineTheme(WORKSPACE_MONACO_LIGHT_THEME, WORKSPACE_MONACO_LIGHT_THEME_DATA)
  monaco.editor.defineTheme(WORKSPACE_MONACO_DARK_THEME, WORKSPACE_MONACO_DARK_THEME_DATA)
  workspaceMonacoThemeInstances.add(monaco)
}

export async function configureWorkspaceMonacoHighlighting(monaco: Monaco) {
  const { configureWorkspaceMonacoShiki } = await import('./workspaceMonacoShiki')
  await configureWorkspaceMonacoShiki(monaco)
}
