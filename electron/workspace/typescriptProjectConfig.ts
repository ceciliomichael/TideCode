import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  WorkspaceTypeScriptCompilerOptionValue,
} from '../../src/types/chat'
import { getSafeWorkspaceTargetPath, normalizeWorkspacePath } from './paths'

const MAX_CONFIG_EXTENDS_DEPTH = 8

const PATH_ARRAY_COMPILER_OPTIONS = new Set(['rootDirs', 'typeRoots'])
const PATH_STRING_COMPILER_OPTIONS = new Set(['baseUrl', 'rootDir'])

export interface ResolvedWorkspaceTypeScriptConfig {
  compilerOptions: Record<string, WorkspaceTypeScriptCompilerOptionValue>
  configPath: string | null
  projectDirectory: string
  projectKey: string
  workspaceRootPath: string
}

function stripJsonComments(source: string) {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const nextCharacter = source[index + 1]

    if (inString) {
      result += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
      result += character
      continue
    }

    if (character === '/' && nextCharacter === '/') {
      index += 1
      while (index + 1 < source.length && source[index + 1] !== '\n') {
        index += 1
      }
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      index += 1
      while (index + 1 < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          index += 1
          break
        }
        if (source[index] === '\n') {
          result += '\n'
        }
        index += 1
      }
      continue
    }

    result += character
  }

  return result
}

function stripTrailingCommas(source: string) {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (inString) {
      result += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
      result += character
      continue
    }

    if (character === ',') {
      let lookahead = index + 1
      while (lookahead < source.length && /\s/u.test(source[lookahead])) {
        lookahead += 1
      }
      if (source[lookahead] === '}' || source[lookahead] === ']') {
        continue
      }
    }

    result += character
  }

  return result
}

function parseJsonConfig(content: string) {
  const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(content))) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TypeScript project configuration must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function toWorkspaceRelativePath(workspaceRootPath: string, absolutePath: string) {
  const relativePath = path.relative(workspaceRootPath, absolutePath)
  if (relativePath === '') {
    return '.'
  }
  if (relativePath.startsWith('..' + path.sep) || relativePath === '..' || path.isAbsolute(relativePath)) {
    return null
  }
  return relativePath.split(path.sep).join('/')
}

function normalizePathCompilerOption(
  workspaceRootPath: string,
  configDirectory: string,
  value: string,
) {
  if (path.isAbsolute(value)) {
    return toWorkspaceRelativePath(workspaceRootPath, path.resolve(value)) ?? value
  }
  return toWorkspaceRelativePath(workspaceRootPath, path.resolve(configDirectory, value)) ?? value
}

function sanitizeCompilerOptionValue(
  optionName: string,
  value: unknown,
  workspaceRootPath: string,
  configDirectory: string,
): WorkspaceTypeScriptCompilerOptionValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    if (PATH_STRING_COMPILER_OPTIONS.has(optionName)) {
      return normalizePathCompilerOption(workspaceRootPath, configDirectory, value)
    }
    return value
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    const entries = value as string[]
    if (PATH_ARRAY_COMPILER_OPTIONS.has(optionName)) {
      return entries.map((entry) => normalizePathCompilerOption(workspaceRootPath, configDirectory, entry))
    }
    return entries
  }

  if (optionName === 'paths' && value && typeof value === 'object' && !Array.isArray(value)) {
    const normalizedPaths: Record<string, string[]> = {}
    for (const [key, candidates] of Object.entries(value)) {
      if (Array.isArray(candidates) && candidates.every((candidate) => typeof candidate === 'string')) {
        normalizedPaths[key] = candidates as string[]
      }
    }
    return normalizedPaths
  }

  return undefined
}

function readOwnCompilerOptions(
  config: Record<string, unknown>,
  workspaceRootPath: string,
  configDirectory: string,
) {
  const compilerOptions = config.compilerOptions
  if (!compilerOptions || typeof compilerOptions !== 'object' || Array.isArray(compilerOptions)) {
    return {}
  }

  const result: Record<string, WorkspaceTypeScriptCompilerOptionValue> = {}
  for (const [optionName, value] of Object.entries(compilerOptions)) {
    const normalizedValue = sanitizeCompilerOptionValue(
      optionName,
      value,
      workspaceRootPath,
      configDirectory,
    )
    if (normalizedValue !== undefined) {
      result[optionName] = normalizedValue
    }
  }
  return result
}

async function pathExists(candidatePath: string) {
  return fs.stat(candidatePath).then(() => true).catch(() => false)
}

async function resolveConfigFileCandidate(candidatePath: string) {
  const candidates = path.extname(candidatePath).toLowerCase() === '.json'
    ? [candidatePath]
    : [candidatePath, candidatePath + '.json', path.join(candidatePath, 'tsconfig.json')]

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      const stats = await fs.stat(candidate).catch(() => null)
      if (stats?.isFile()) {
        return path.resolve(candidate)
      }
    }
  }
  return null
}

function splitPackageSpecifier(specifier: string) {
  const segments = specifier.split('/').filter(Boolean)
  if (segments.length === 0) {
    return { packageName: '', subpath: '' }
  }
  if (specifier.startsWith('@')) {
    return {
      packageName: segments.slice(0, 2).join('/'),
      subpath: segments.slice(2).join('/'),
    }
  }
  return {
    packageName: segments[0],
    subpath: segments.slice(1).join('/'),
  }
}

async function findNearestNodeModulesDirectory(workspaceRootPath: string, startDirectory: string) {
  let currentDirectory = path.resolve(startDirectory)
  const normalizedWorkspaceRoot = path.resolve(workspaceRootPath)

  while (
    currentDirectory === normalizedWorkspaceRoot ||
    currentDirectory.startsWith(normalizedWorkspaceRoot + path.sep)
  ) {
    const candidate = path.join(currentDirectory, 'node_modules')
    if (await pathExists(candidate)) {
      return candidate
    }
    if (currentDirectory === normalizedWorkspaceRoot) {
      return null
    }
    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return null
    }
    const relativePath = path.relative(normalizedWorkspaceRoot, parentDirectory)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null
    }
    currentDirectory = parentDirectory
  }
  return null
}

async function resolvePackageExtendedConfig(
  workspaceRootPath: string,
  configDirectory: string,
  specifier: string,
) {
  const nodeModulesDirectory = await findNearestNodeModulesDirectory(workspaceRootPath, configDirectory)
  if (!nodeModulesDirectory) {
    return null
  }

  const { packageName, subpath } = splitPackageSpecifier(specifier)
  if (!packageName) {
    return null
  }

  const packageRoot = path.join(nodeModulesDirectory, ...packageName.split('/'))
  if (subpath) {
    return resolveConfigFileCandidate(path.join(packageRoot, ...subpath.split('/')))
  }

  const packageJsonPath = path.join(packageRoot, 'package.json')
  const packageJson = await fs.readFile(packageJsonPath, 'utf8').then(parseJsonConfig).catch(() => null)
  if (packageJson && typeof packageJson.tsconfig === 'string') {
    const packageConfig = await resolveConfigFileCandidate(path.join(packageRoot, packageJson.tsconfig))
    if (packageConfig) {
      return packageConfig
    }
  }

  return resolveConfigFileCandidate(path.join(packageRoot, 'tsconfig.json'))
}

async function resolveExtendedConfigPath(
  workspaceRootPath: string,
  configDirectory: string,
  specifier: string,
) {
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    const candidate = path.isAbsolute(specifier)
      ? path.resolve(specifier)
      : path.resolve(configDirectory, specifier)
    return resolveConfigFileCandidate(candidate)
  }

  return resolvePackageExtendedConfig(workspaceRootPath, configDirectory, specifier)
}

async function loadMergedCompilerOptions(
  workspaceRootPath: string,
  configPath: string,
  visited: Set<string>,
  depth: number,
): Promise<Record<string, WorkspaceTypeScriptCompilerOptionValue>> {
  if (depth > MAX_CONFIG_EXTENDS_DEPTH) {
    throw new Error('TypeScript project configuration extends too deeply.')
  }

  const normalizedConfigPath = path.resolve(configPath)
  if (visited.has(normalizedConfigPath)) {
    throw new Error('Circular TypeScript project configuration extends chain.')
  }
  visited.add(normalizedConfigPath)

  try {
    const configDirectory = path.dirname(normalizedConfigPath)
    const config = parseJsonConfig(await fs.readFile(normalizedConfigPath, 'utf8'))
    const extendsValue = config.extends
    const extendsSpecifiers = typeof extendsValue === 'string'
      ? [extendsValue]
      : Array.isArray(extendsValue)
        ? extendsValue.filter((entry): entry is string => typeof entry === 'string')
        : []

    let inheritedOptions: Record<string, WorkspaceTypeScriptCompilerOptionValue> = {}
    for (const extendsSpecifier of extendsSpecifiers) {
      const parentConfigPath = await resolveExtendedConfigPath(
        workspaceRootPath,
        configDirectory,
        extendsSpecifier,
      )
      if (!parentConfigPath) {
        continue
      }
      const parentOptions = await loadMergedCompilerOptions(
        workspaceRootPath,
        parentConfigPath,
        visited,
        depth + 1,
      )
      inheritedOptions = { ...inheritedOptions, ...parentOptions }
    }

    return {
      ...inheritedOptions,
      ...readOwnCompilerOptions(config, workspaceRootPath, configDirectory),
    }
  } finally {
    visited.delete(normalizedConfigPath)
  }
}

async function findNearestProjectConfig(workspaceRootPath: string, activeAbsolutePath: string) {
  const normalizedWorkspaceRoot = path.resolve(workspaceRootPath)
  let currentDirectory = path.dirname(activeAbsolutePath)

  while (
    currentDirectory === normalizedWorkspaceRoot ||
    currentDirectory.startsWith(normalizedWorkspaceRoot + path.sep)
  ) {
    for (const configName of ['tsconfig.json', 'jsconfig.json']) {
      const candidatePath = path.join(currentDirectory, configName)
      if (await pathExists(candidatePath)) {
        return candidatePath
      }
    }

    if (currentDirectory === normalizedWorkspaceRoot) {
      return null
    }
    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return null
    }
    const relativePath = path.relative(normalizedWorkspaceRoot, parentDirectory)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null
    }
    currentDirectory = parentDirectory
  }
  return null
}

export async function resolveWorkspaceTypeScriptConfig(
  workspaceRootPathInput: string,
  relativePath: string,
): Promise<ResolvedWorkspaceTypeScriptConfig> {
  const workspaceRootPath = normalizeWorkspacePath(workspaceRootPathInput)
  const activeTarget = getSafeWorkspaceTargetPath(workspaceRootPath, relativePath)
  const configPath = await findNearestProjectConfig(workspaceRootPath, activeTarget.absolutePath)
  const projectDirectory = configPath ? path.dirname(configPath) : workspaceRootPath
  const compilerOptions = configPath
    ? await loadMergedCompilerOptions(workspaceRootPath, configPath, new Set(), 0)
    : {}
  const configRelativePath = configPath
    ? toWorkspaceRelativePath(workspaceRootPath, configPath)
    : null
  const projectDirectoryRelativePath = toWorkspaceRelativePath(workspaceRootPath, projectDirectory) ?? '.'

  return {
    compilerOptions,
    configPath: configRelativePath,
    projectDirectory,
    projectKey: configRelativePath ?? 'inferred:' + projectDirectoryRelativePath,
    workspaceRootPath,
  }
}
