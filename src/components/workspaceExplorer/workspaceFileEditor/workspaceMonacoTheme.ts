import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { ResolvedTheme } from '../../../lib/theme'

export const WORKSPACE_MONACO_LIGHT_THEME = 'tidecode-light'
export const WORKSPACE_MONACO_DARK_THEME = 'tidecode-dark'

export const WORKSPACE_MONACO_LIGHT_COLORS = {
  'diffEditor.diagonalFill': '#d7d7da',
  'diffEditor.insertedLineBackground': '#10b9812e',
  'diffEditor.insertedTextBackground': '#00000000',
  'diffEditor.removedLineBackground': '#ef44442e',
  'diffEditor.removedTextBackground': '#00000000',
  'diffEditorGutter.insertedLineBackground': '#00000000',
  'diffEditorGutter.removedLineBackground': '#00000000',
  'editor.background': '#ffffff',
  'editor.findMatchBackground': '#1267b2',
  'editor.findMatchForeground': '#ffffff',
  'editor.findMatchHighlightBackground': '#b8d8f4',
  'editor.foreground': '#303033',
  'editor.inactiveSelectionBackground': '#1e76ceb8',
  'editor.lineHighlightBackground': '#00000000',
  'editor.selectionBackground': '#1e76ce',
  'editor.selectionForeground': '#ffffff',
  'editorGutter.background': '#ffffff',
  'editorIndentGuide.activeBackground1': '#a0a0a5',
  'editorIndentGuide.background1': '#d9d9dc',
  'editorLineNumber.activeForeground': '#8b8b91',
  'editorLineNumber.foreground': '#8b8b91',
  'editorSuggestWidget.background': '#ffffff',
  'editorSuggestWidget.border': '#d7d7da',
  'editorSuggestWidget.selectedBackground': '#e8efed',
  'editorWidget.background': '#ffffff',
  'editorWidget.border': '#d7d7da',
  'scrollbarSlider.activeBackground': '#727278a8',
  'scrollbarSlider.background': '#a8a8ad70',
  'scrollbarSlider.hoverBackground': '#8b8b918f',
} as const

export const WORKSPACE_MONACO_DARK_COLORS = {
  'diffEditor.diagonalFill': '#36363a',
  'diffEditor.insertedLineBackground': '#10b9813d',
  'diffEditor.insertedTextBackground': '#00000000',
  'diffEditor.removedLineBackground': '#ef44443d',
  'diffEditor.removedTextBackground': '#00000000',
  'diffEditorGutter.insertedLineBackground': '#00000000',
  'diffEditorGutter.removedLineBackground': '#00000000',
  'editor.background': '#171718',
  'editor.findMatchBackground': '#1976c8',
  'editor.findMatchForeground': '#ffffff',
  'editor.findMatchHighlightBackground': '#294c6b',
  'editor.foreground': '#e7e7e7',
  'editor.inactiveSelectionBackground': '#246fb0cc',
  'editor.lineHighlightBackground': '#00000000',
  'editor.selectionBackground': '#246fb0',
  'editor.selectionForeground': '#ffffff',
  'editorGutter.background': '#171718',
  'editorIndentGuide.activeBackground1': '#68686e',
  'editorIndentGuide.background1': '#343438',
  'editorLineNumber.activeForeground': '#8f8f94',
  'editorLineNumber.foreground': '#8f8f94',
  'editorSuggestWidget.background': '#1f1f21',
  'editorSuggestWidget.border': '#3a3a3e',
  'editorSuggestWidget.selectedBackground': '#29413b',
  'editorWidget.background': '#1f1f21',
  'editorWidget.border': '#3a3a3e',
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
