import { shikiToMonaco } from '@shikijs/monaco'
import githubDarkDefault from '@shikijs/themes/github-dark-default'
import githubLightDefault from '@shikijs/themes/github-light-default'
import type { ThemeRegistrationResolved } from '@shikijs/types'
import type { Monaco } from '@monaco-editor/react'
import { createHighlighter } from 'shiki/bundle/full'
import {
  WORKSPACE_MONACO_DARK_COLORS,
  WORKSPACE_MONACO_DARK_THEME,
  WORKSPACE_MONACO_LIGHT_COLORS,
  WORKSPACE_MONACO_LIGHT_THEME,
} from './workspaceMonacoTheme'

const SHIKI_MONACO_LANGUAGES = [
  'bash',
  'c',
  'clojure',
  'cpp',
  'csharp',
  'css',
  'dart',
  'docker',
  'fsharp',
  'go',
  'graphql',
  'handlebars',
  'hcl',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'jsx',
  'kotlin',
  'less',
  'lua',
  'markdown',
  'php',
  'powershell',
  'python',
  'ruby',
  'rust',
  'scss',
  'shellscript',
  'sql',
  'swift',
  'toml',
  'tsx',
  'typescript',
  'vb',
  'vue',
  'xml',
  'yaml',
] as const

function createTideCodeShikiTheme(
  baseTheme: typeof githubLightDefault | typeof githubDarkDefault,
  name: string,
  type: 'light' | 'dark',
  colors: Readonly<Record<string, string>>,
): ThemeRegistrationResolved {
  return {
    ...baseTheme,
    bg: colors['editor.background'] ?? baseTheme.bg ?? '#ffffff',
    colors: {
      ...baseTheme.colors,
      ...colors,
    },
    fg: colors['editor.foreground'] ?? baseTheme.fg ?? '#303033',
    name,
    settings: baseTheme.settings ?? baseTheme.tokenColors ?? [],
    type,
  }
}

const workspaceHighlighterPromise = createHighlighter({
  langs: [...SHIKI_MONACO_LANGUAGES],
  themes: [
    createTideCodeShikiTheme(
      githubLightDefault,
      WORKSPACE_MONACO_LIGHT_THEME,
      'light',
      WORKSPACE_MONACO_LIGHT_COLORS,
    ),
    createTideCodeShikiTheme(
      githubDarkDefault,
      WORKSPACE_MONACO_DARK_THEME,
      'dark',
      WORKSPACE_MONACO_DARK_COLORS,
    ),
  ],
})

let configuredMonaco: Monaco | null = null
let configurePromise: Promise<void> | null = null

export function configureWorkspaceMonacoShiki(monaco: Monaco) {
  if (configuredMonaco === monaco && configurePromise) {
    return configurePromise
  }

  configuredMonaco = monaco
  configurePromise = workspaceHighlighterPromise.then((highlighter) => {
    shikiToMonaco(highlighter, monaco, {
      tokenizeMaxLineLength: 20_000,
      tokenizeTimeLimit: 100,
    })
  }).catch(() => {
    // The lightweight TideCode theme remains active when Shiki cannot load.
  })
  return configurePromise
}
