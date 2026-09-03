import type { editor } from 'monaco-editor'

export {
  configureWorkspaceMonacoHighlighting,
  defineWorkspaceMonacoThemes,
  getWorkspaceMonacoTheme,
  WORKSPACE_MONACO_DARK_THEME,
  WORKSPACE_MONACO_DARK_THEME_DATA,
  WORKSPACE_MONACO_LIGHT_THEME,
  WORKSPACE_MONACO_LIGHT_THEME_DATA,
} from './workspaceMonacoTheme'

const SPECIAL_FILE_LANGUAGES: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
}

const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  bash: 'shell',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  clj: 'clojure',
  cljs: 'clojure',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cxx: 'cpp',
  dart: 'dart',
  dockerfile: 'dockerfile',
  env: 'ini',
  fs: 'fsharp',
  fsx: 'fsharp',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  h: 'cpp',
  handlebars: 'handlebars',
  hbs: 'handlebars',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  php: 'php',
  ps1: 'powershell',
  psd1: 'powershell',
  psm1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sass: 'scss',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  swift: 'swift',
  tf: 'hcl',
  tfvars: 'hcl',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  vb: 'vb',
  vue: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell',
}

function getNormalizedFileName(filePath: string) {
  const normalizedPath = filePath.trim().replace(/\\/g, '/')
  return normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1).toLowerCase()
}

export function resolveWorkspaceMonacoLanguage(filePath: string) {
  const fileName = getNormalizedFileName(filePath)
  const specialLanguage = SPECIAL_FILE_LANGUAGES[fileName]
  if (specialLanguage) {
    return specialLanguage
  }

  const fileNameParts = fileName.split('.')
  for (let index = fileNameParts.length - 1; index > 0; index -= 1) {
    const extensionLanguage = EXTENSION_LANGUAGES[fileNameParts[index]]
    if (extensionLanguage) {
      return extensionLanguage
    }
  }

  return 'plaintext'
}

function normalizeWorkspaceMonacoRelativePath(filePath: string) {
  return filePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

export function createWorkspaceMonacoTypeScriptFilePath(filePath: string) {
  const normalizedPath = normalizeWorkspaceMonacoRelativePath(filePath)
return `file:///workspace/${normalizedPath || 'untitled'}`
}

export function createWorkspaceMonacoModelPath(filePath: string) {
  const normalizedPath = normalizeWorkspaceMonacoRelativePath(filePath)
  const encodedPath = normalizedPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

return `file:///workspace/${encodedPath || 'untitled'}`
}

export function getWorkspaceRelativePathFromMonacoUri(resourceUri: string) {
  const match = /^(?:file:\/\/workspace|file:\/\/\/workspace)\/+(.*)$/iu.exec(resourceUri.trim())
  if (!match) {
    return null
  }

  const encodedPath = match[1].split(/[?#]/u, 1)[0]
  if (!encodedPath) {
    return null
  }

  try {
    const relativePath = encodedPath
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment))
      .join('/')
    return relativePath || null
  } catch {
    return null
  }
}

export function createWorkspaceMonacoOptions(
  wordWrapEnabled: boolean,
): editor.IStandaloneEditorConstructionOptions {
  return {
    acceptSuggestionOnEnter: 'smart',
    accessibilitySupport: 'auto',
    automaticLayout: true,
    bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
    codeLens: false,
    colorDecorators: false,
    contextmenu: true,
    copyWithSyntaxHighlighting: true,
    cursorBlinking: 'blink',
    cursorSmoothCaretAnimation: 'off',
    cursorStyle: 'line',
    cursorWidth: 2,
    detectIndentation: true,
    dragAndDrop: true,
    emptySelectionClipboard: true,
    fixedOverflowWidgets: true,
    folding: true,
    foldingHighlight: true,
    foldingStrategy: 'auto',
    fontFamily: "Consolas, 'Courier New', monospace",
    fontLigatures: false,
    fontSize: 14,
    fontWeight: '400',
    formatOnPaste: false,
    formatOnType: false,
    glyphMargin: false,
hover: { enabled: false },
    guides: {
      bracketPairs: false,
      bracketPairsHorizontal: false,
      highlightActiveBracketPair: true,
      highlightActiveIndentation: true,
      indentation: true,
    },
    insertSpaces: true,
    letterSpacing: 0,
    lineDecorationsWidth: 10,
    lineHeight: 20,
    lineNumbers: 'on',
    lineNumbersMinChars: 6,
    links: false,
    matchBrackets: 'always',
    minimap: { enabled: false },
    mouseWheelZoom: true,
    multiCursorModifier: 'alt',
    occurrencesHighlight: 'singleFile',
    overviewRulerBorder: false,
    overviewRulerLanes: 0,
    padding: { bottom: 20, top: 6 },
    parameterHints: { enabled: true },
    quickSuggestions: true,
    renderControlCharacters: true,
    renderFinalNewline: 'on',
    renderLineHighlight: 'none',
    renderLineHighlightOnlyWhenFocus: false,
    renderValidationDecorations: 'editable',
    renderWhitespace: 'selection',
    roundedSelection: false,
    scrollBeyondLastColumn: 5,
    scrollBeyondLastLine: false,
    scrollbar: {
      alwaysConsumeMouseWheel: false,
      horizontal: 'auto',
      horizontalScrollbarSize: 8,
      useShadows: false,
      vertical: 'auto',
      verticalScrollbarSize: 8,
    },
    selectionHighlight: true,
    showFoldingControls: 'mouseover',
    smoothScrolling: false,
    stickyScroll: { enabled: false },
    suggestOnTriggerCharacters: true,
    tabCompletion: 'on',
    tabSize: 2,
    unicodeHighlight: {
      ambiguousCharacters: false,
      includeComments: true,
      includeStrings: true,
      invisibleCharacters: true,
      nonBasicASCII: false,
    },
    unusualLineTerminators: 'auto',
    wordWrap: wordWrapEnabled ? 'on' : 'off',
    wrappingIndent: 'same',
    wrappingStrategy: 'advanced',
  }
}
