import { getSingletonHighlighter, type BundledLanguage, type ThemedToken } from 'shiki/bundle/full'
import type { ResolvedTheme } from './theme'

export type HighlightedToken = Pick<ThemedToken, 'content' | 'color' | 'fontStyle'>

export interface HighlightedCodeLine {
  text: string
  tokens: HighlightedToken[]
}

interface ResolveHighlightLanguageOptions {
  fileName?: string
  language?: string
}

interface HighlightCodeOptions extends ResolveHighlightLanguageOptions {
  code: string
  stripTrailingNewline?: boolean
  theme: ResolvedTheme
}

type HighlightLanguage = BundledLanguage | 'text'

const SHIKI_LIGHT_THEME = 'github-light-default'
const SHIKI_DARK_THEME = 'github-dark-default'
const MARKDOWN_LIST_LANGUAGES = new Set(['markdown', 'mdx'])
const MARKDOWN_ORDERED_LIST_MARKER_PATTERN = /^\s*\d+\.(?=\s)/u

const HIGHLIGHT_LANGUAGE_ALIASES: Record<string, string> = {
  apache: 'apache',
  c: 'c',
  cc: 'cpp',
  bash: 'shellscript',
  clojure: 'clojure',
  cjs: 'javascript',
  clj: 'clojure',
  cmake: 'cmake',
  conf: 'ini',
  config: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  csx: 'csharp',
  csv: 'csv',
  cxx: 'cpp',
  cython: 'python',
  dart: 'dart',
  dockerfile: 'docker',
  dotenv: 'dotenv',
  env: 'dotenv',
  erb: 'ruby',
  elixir: 'elixir',
  erl: 'erlang',
  fish: 'shellscript',
  go: 'go',
  fs: 'fsharp',
  fsx: 'fsharp',
  groovy: 'groovy',
  gql: 'graphql',
  gomod: 'go',
  gosum: 'go',
  gowork: 'go',
  h: 'cpp',
  hpp: 'cpp',
  htaccess: 'apache',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  javascriptreact: 'jsx',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  kotlin: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  makefile: 'make',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'mdx',
  log: 'text',
  mjs: 'javascript',
  nginx: 'nginx',
  php: 'php',
  py: 'python',
  python: 'python',
  r: 'r',
  psm1: 'powershell',
  psd1: 'powershell',
  ps1: 'powershell',
  rb: 'ruby',
  pyi: 'python',
  rust: 'rust',
  rs: 'rust',
  sass: 'sass',
  scala: 'scala',
  scss: 'scss',
  sql: 'sql',
  swift: 'swift',
  terraform: 'terraform',
  tf: 'terraform',
  tfvars: 'terraform',
  text: 'text',
  rmd: 'markdown',
  toml: 'toml',
  ts: 'typescript',
  typescriptreact: 'tsx',
  tsx: 'tsx',
  txt: 'text',
  vb: 'vb',
  sh: 'shellscript',
  shell: 'shellscript',
  svelte: 'svelte',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shellscript',
}

const highlighterPromise = getSingletonHighlighter({
  langs: [],
  themes: [SHIKI_LIGHT_THEME, SHIKI_DARK_THEME],
  warnings: false,
})

const highlightCache = new Map<string, HighlightedCodeLine[]>()

function normalizeLanguageId(value: string) {
  return value.trim().toLowerCase()
}

function getFileExtension(fileName: string) {
  const trimmedName = fileName.trim()
  if (trimmedName.length === 0) {
    return ''
  }

  const normalizedName = trimmedName.toLowerCase()
  if (normalizedName === 'dockerfile' || normalizedName === 'makefile') {
    return normalizedName
  }

  if (normalizedName.startsWith('.')) {
    return normalizedName.slice(1)
  }

  const lastDotIndex = normalizedName.lastIndexOf('.')
  if (lastDotIndex < 0) {
    return normalizedName
  }

  return normalizedName.slice(lastDotIndex + 1)
}

function normalizeCodeForRendering(code: string, stripTrailingNewline: boolean) {
  let normalizedCode = code.replace(/\r\n?/g, '\n')
  if (stripTrailingNewline && normalizedCode.endsWith('\n')) {
    normalizedCode = normalizedCode.slice(0, -1)
  }

  return normalizedCode
}

function createPlainLines(code: string): HighlightedCodeLine[] {
  const lines = code.length === 0 ? [''] : code.split('\n')
  return lines.map((line) => ({
    text: line,
    tokens: line.length > 0 ? [{ content: line }] : [],
  }))
}

function convertTokensToLines(tokens: readonly ThemedToken[][]): HighlightedCodeLine[] {
  return tokens.map((lineTokens) => {
    const text = lineTokens.map((token) => token.content).join('')
    return {
      text,
      tokens: lineTokens.map((token) => ({
        content: token.content,
        color: token.color,
        fontStyle: token.fontStyle,
      })),
    }
  })
}

function neutralizeMarkdownOrderedListMarkers(
  lines: readonly HighlightedCodeLine[],
  language: string,
): HighlightedCodeLine[] {
  if (!MARKDOWN_LIST_LANGUAGES.has(language)) {
    return [...lines]
  }

  return lines.map((line) => {
    const markerMatch = MARKDOWN_ORDERED_LIST_MARKER_PATTERN.exec(line.text)
    if (!markerMatch) {
      return line
    }

    const markerEnd = markerMatch[0].length
    let tokenStart = 0
    let didChange = false
    const tokens: HighlightedToken[] = []

    for (const token of line.tokens) {
      const tokenEnd = tokenStart + token.content.length
      if (tokenStart >= markerEnd || tokenEnd <= 0) {
        tokens.push(token)
        tokenStart = tokenEnd
        continue
      }

      const markerLength = Math.min(tokenEnd, markerEnd) - tokenStart
      if (markerLength <= 0) {
        tokens.push(token)
        tokenStart = tokenEnd
        continue
      }

      const markerContent = token.content.slice(0, markerLength)
      tokens.push({ ...token, content: markerContent, color: undefined })
      didChange = didChange || token.color !== undefined

      if (markerLength < token.content.length) {
        tokens.push({ ...token, content: token.content.slice(markerLength) })
      }

      tokenStart = tokenEnd
    }

    return didChange ? { ...line, tokens } : line
  })
}

function resolveFileNameLanguage(fileName: string) {
  const extension = getFileExtension(fileName)
  if (extension.length === 0) {
    return undefined
  }

  return HIGHLIGHT_LANGUAGE_ALIASES[extension] ?? extension
}

export function resolveHighlightLanguage({ fileName, language }: ResolveHighlightLanguageOptions) {
  const normalizedLanguage = language ? normalizeLanguageId(language) : ''
  if (normalizedLanguage.length > 0) {
    return HIGHLIGHT_LANGUAGE_ALIASES[normalizedLanguage] ?? normalizedLanguage
  }

  if (!fileName) {
    return undefined
  }

  return resolveFileNameLanguage(fileName)
}

async function getHighlighter() {
  return highlighterPromise
}

async function ensureLanguageLoaded(language: HighlightLanguage) {
  const highlighter = await getHighlighter()
  if (!highlighter.getLoadedLanguages().includes(language)) {
    await highlighter.loadLanguage(language)
  }

  return highlighter
}

export async function highlightCodeLines({
  code,
  fileName,
  language,
  stripTrailingNewline = true,
  theme,
}: HighlightCodeOptions) {
  const normalizedCode = normalizeCodeForRendering(code, stripTrailingNewline)
  const resolvedLanguage = resolveHighlightLanguage({ fileName, language })

  if (!resolvedLanguage) {
    return createPlainLines(normalizedCode)
  }

  const cacheKey = `${theme}:${resolvedLanguage}:${normalizedCode}`
  const cachedLines = highlightCache.get(cacheKey)
  if (cachedLines) {
    return cachedLines
  }

  try {
    const languageToLoad = resolvedLanguage as HighlightLanguage
    const highlighter = await ensureLanguageLoaded(languageToLoad)
    const tokens = await highlighter.codeToTokensBase(normalizedCode, {
      lang: languageToLoad,
      theme: theme === 'dark' ? SHIKI_DARK_THEME : SHIKI_LIGHT_THEME,
    })
    const highlightedLines = neutralizeMarkdownOrderedListMarkers(
      convertTokensToLines(tokens),
      resolvedLanguage,
    )
    highlightCache.set(cacheKey, highlightedLines)
    return highlightedLines
  } catch {
    const plainLines = createPlainLines(normalizedCode)
    highlightCache.set(cacheKey, plainLines)
    return plainLines
  }
}
