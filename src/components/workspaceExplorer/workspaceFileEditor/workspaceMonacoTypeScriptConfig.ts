import type { Monaco } from '@monaco-editor/react'
import type {
  WorkspaceTypeScriptCompilerOptionValue,
  WorkspaceTypeScriptProjectSnapshot,
} from '../../../types/chat'
import { createWorkspaceMonacoTypeScriptFilePath } from './workspaceMonacoConfig'

type MonacoCompilerOptions = ReturnType<
  Monaco['languages']['typescript']['typescriptDefaults']['getCompilerOptions']
>

const SCRIPT_TARGETS: Readonly<Record<string, number>> = {
  es3: 0,
  es5: 1,
  es6: 2,
  es2015: 2,
  es2016: 3,
  es2017: 4,
  es2018: 5,
  es2019: 6,
  es2020: 7,
  es2021: 8,
  es2022: 9,
  es2023: 10,
  es2024: 11,
  esnext: 99,
  latest: 99,
}

const MODULE_KINDS: Readonly<Record<string, number>> = {
  none: 0,
  commonjs: 1,
  amd: 2,
  umd: 3,
  system: 4,
  es6: 5,
  es2015: 5,
  es2020: 6,
  es2022: 7,
  esnext: 99,
  node16: 100,
  node18: 101,
  node20: 102,
  nodenext: 199,
  preserve: 200,
}

const MODULE_RESOLUTION_KINDS: Readonly<Record<string, number>> = {
  classic: 1,
  node: 2,
  node10: 2,
  nodejs: 2,
  node16: 3,
  nodenext: 99,
  bundler: 100,
}

const JSX_EMITS: Readonly<Record<string, number>> = {
  preserve: 1,
  react: 2,
  'react-native': 3,
  'react-jsx': 4,
  'react-jsxdev': 5,
}

const MODULE_DETECTION_KINDS: Readonly<Record<string, number>> = {
  legacy: 1,
  auto: 2,
  force: 3,
}

const NEW_LINE_KINDS: Readonly<Record<string, number>> = {
  crlf: 0,
  lf: 1,
}

const PATH_OPTIONS = new Set(['baseUrl', 'rootDir'])
const PATH_ARRAY_OPTIONS = new Set(['rootDirs', 'typeRoots'])
const OMITTED_COMPILER_OPTIONS = new Set([
  'declaration', 'declarationDir', 'declarationMap', 'emitDeclarationOnly', 'incremental',
  'out', 'outDir', 'outFile', 'sourceMap', 'tsBuildInfoFile',
])

function normalizeEnumKey(value: string) {
  return value.trim().toLowerCase().replace(/[_.-]/gu, '')
}

function getEnumValue(map: Readonly<Record<string, number>>, value: string) {
  const normalized = normalizeEnumKey(value)
  for (const [key, enumValue] of Object.entries(map)) {
    if (normalizeEnumKey(key) === normalized) {
      return enumValue
    }
  }
  return undefined
}

export function createWorkspaceMonacoVirtualDirectoryPath(relativePath: string) {
  const normalizedPath = relativePath.trim().replace(/\\/gu, '/').replace(/^\.\/+/u, '').replace(/\/+$/u, '')
  if (!normalizedPath || normalizedPath === '.') {
return 'file:///workspace'
  }
const fileUri = createWorkspaceMonacoTypeScriptFilePath(normalizedPath + '/__tidecode_path__')
  return fileUri.slice(0, fileUri.lastIndexOf('/'))
}

function convertCompilerOption(
  optionName: string,
  value: WorkspaceTypeScriptCompilerOptionValue,
) {
  if (typeof value === 'string') {
    if (optionName === 'target') return getEnumValue(SCRIPT_TARGETS, value) ?? value
    if (optionName === 'module') return getEnumValue(MODULE_KINDS, value) ?? value
    if (optionName === 'moduleResolution') return getEnumValue(MODULE_RESOLUTION_KINDS, value) ?? value
    if (optionName === 'jsx') return getEnumValue(JSX_EMITS, value) ?? value
    if (optionName === 'moduleDetection') return getEnumValue(MODULE_DETECTION_KINDS, value) ?? value
    if (optionName === 'newLine') return getEnumValue(NEW_LINE_KINDS, value) ?? value
    if (PATH_OPTIONS.has(optionName)) return createWorkspaceMonacoVirtualDirectoryPath(value)
    return value
  }

  if (Array.isArray(value) && PATH_ARRAY_OPTIONS.has(optionName)) {
    return value.map((entry) => createWorkspaceMonacoVirtualDirectoryPath(entry))
  }

  return value
}

export function createWorkspaceMonacoTypeScriptCompilerOptions(
  snapshot: Pick<WorkspaceTypeScriptProjectSnapshot, 'compilerOptions'>,
): MonacoCompilerOptions {
  const options: Record<string, unknown> = {
    allowNonTsExtensions: true,
    noEmit: true,
  }

  for (const [optionName, value] of Object.entries(snapshot.compilerOptions)) {
    if (OMITTED_COMPILER_OPTIONS.has(optionName) || value === null) {
      continue
    }
    options[optionName] = convertCompilerOption(optionName, value)
  }

  if (typeof options.target !== 'number') {
    options.target = 99
  }
  if (typeof options.moduleResolution !== 'number') {
    options.moduleResolution = 100
  }

  return options as MonacoCompilerOptions
}
