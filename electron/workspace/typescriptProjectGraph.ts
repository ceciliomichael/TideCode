import { promises as fs } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import type { WorkspaceTypeScriptProjectFile } from '../../src/types/chat'
import {
  addWorkspaceTypeScriptTextFile,
  isWorkspaceTypeScriptDeclarationFile,
  toWorkspaceTypeScriptRelativePath,
  type WorkspaceTypeScriptFileBudget,
} from './typescriptProjectFileStore'
import {
  extractWorkspaceTypeScriptModuleSpecifiers,
  splitWorkspacePackageSpecifier,
} from './typescriptModuleSpecifiers'
import { loadWorkspaceTypeScriptPackageDeclarations } from './typescriptPackageDeclarations'

const MAX_PROJECT_FILES = 520
const MAX_PROJECT_BYTES = 10 * 1024 * 1024
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const SOURCE_IGNORED_DIRECTORIES = new Set([
  '.git', '.tidecode', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', '.vite',
  'build', 'coverage', 'dist', 'dist-electron', 'node_modules', 'out', 'release', 'target',
])
const MODULE_FILE_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts', '.d.mts', '.d.cts', '.json',
]
const NODE_BUILTIN_MODULES = new Set(builtinModules.flatMap((moduleName) => [moduleName, 'node:' + moduleName]))
const MAX_AMBIENT_DECLARATION_FILES = 64

export {
  extractWorkspaceTypeScriptModuleSpecifiers,
  extractWorkspaceTypeScriptReferencePaths,
} from './typescriptModuleSpecifiers'

export interface WorkspaceTypeScriptGraphResult {
  files: WorkspaceTypeScriptProjectFile[]
  truncated: boolean
}

function isSourceFile(fileName: string) {
  const lowerName = fileName.toLowerCase()
  return isWorkspaceTypeScriptDeclarationFile(lowerName) || SOURCE_EXTENSIONS.has(path.extname(lowerName))
}

async function resolveModuleFileCandidate(workspaceRootPath: string, candidatePath: string) {
  const normalizedCandidate = path.resolve(candidatePath)
  const workspaceRelativePath = path.relative(workspaceRootPath, normalizedCandidate)
  if (
    workspaceRelativePath === '..' ||
    workspaceRelativePath.startsWith('..' + path.sep) ||
    path.isAbsolute(workspaceRelativePath)
  ) {
    return null
  }

  const extension = path.extname(normalizedCandidate).toLowerCase()
  const candidates: string[] = []
  if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') {
    const withoutExtension = normalizedCandidate.slice(0, -extension.length)
    if (extension === '.jsx') candidates.push(withoutExtension + '.tsx')
    if (extension === '.mjs') candidates.push(withoutExtension + '.mts')
    if (extension === '.cjs') candidates.push(withoutExtension + '.cts')
    candidates.push(withoutExtension + '.ts', withoutExtension + '.tsx', withoutExtension + '.d.ts', normalizedCandidate)
  } else if (extension) {
    candidates.push(normalizedCandidate)
  } else {
    for (const candidateExtension of MODULE_FILE_EXTENSIONS) {
      candidates.push(normalizedCandidate + candidateExtension)
    }
    for (const candidateExtension of MODULE_FILE_EXTENSIONS) {
      candidates.push(path.join(normalizedCandidate, 'index' + candidateExtension))
    }
  }

  for (const filePath of candidates) {
    const stats = await fs.stat(filePath).catch(() => null)
    if (stats?.isFile()) return filePath
  }
  return null
}

function matchPathAlias(pattern: string, specifier: string) {
  const wildcardIndex = pattern.indexOf('*')
  if (wildcardIndex < 0) {
    return pattern === specifier ? '' : null
  }
  const prefix = pattern.slice(0, wildcardIndex)
  const suffix = pattern.slice(wildcardIndex + 1)
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return null
  }
  return specifier.slice(prefix.length, specifier.length - suffix.length)
}

async function resolveWorkspaceModuleSpecifier(input: {
  compilerOptions: Record<string, unknown>
  importerPath: string
  projectDirectory: string
  specifier: string
  workspaceRootPath: string
}) {
  if (input.specifier.startsWith('.')) {
    return resolveModuleFileCandidate(
      input.workspaceRootPath,
      path.resolve(path.dirname(input.importerPath), input.specifier),
    )
  }
  if (input.specifier.startsWith('/') || /^[a-z]+:/iu.test(input.specifier)) {
    return null
  }

  const configuredBaseUrl = typeof input.compilerOptions.baseUrl === 'string'
    ? input.compilerOptions.baseUrl.trim()
    : ''
  const baseUrlPath = configuredBaseUrl
    ? path.resolve(input.workspaceRootPath, configuredBaseUrl)
    : input.projectDirectory
  const paths = input.compilerOptions.paths
  if (paths && typeof paths === 'object' && !Array.isArray(paths)) {
    for (const [pattern, substitutions] of Object.entries(paths)) {
      if (!Array.isArray(substitutions)) continue
      const wildcardValue = matchPathAlias(pattern, input.specifier)
      if (wildcardValue === null) continue
      for (const substitution of substitutions) {
        if (typeof substitution !== 'string') continue
        const candidate = substitution.includes('*')
          ? substitution.replace(/\*/gu, wildcardValue)
          : substitution
        const resolved = await resolveModuleFileCandidate(
          input.workspaceRootPath,
          path.resolve(baseUrlPath, candidate),
        )
        if (resolved) return resolved
      }
    }
  }

  if (configuredBaseUrl) {
    return resolveModuleFileCandidate(
      input.workspaceRootPath,
      path.resolve(baseUrlPath, input.specifier),
    )
  }
  return null
}

async function addSourceFile(input: {
  absolutePath: string
  budget: WorkspaceTypeScriptFileBudget
  filesByPath: Map<string, WorkspaceTypeScriptProjectFile>
  workspaceRootPath: string
}) {
  return addWorkspaceTypeScriptTextFile({
    absolutePath: input.absolutePath,
    budget: input.budget,
    filesByPath: input.filesByPath,
    maxBytes: MAX_PROJECT_BYTES,
    maxFiles: MAX_PROJECT_FILES,
    workspaceRootPath: input.workspaceRootPath,
  })
}

async function collectImportedSourceGraph(input: {
  activeAbsolutePath: string
  budget: WorkspaceTypeScriptFileBudget
  compilerOptions: Record<string, unknown>
  filesByPath: Map<string, WorkspaceTypeScriptProjectFile>
  packageSpecifiers: Set<string>
  projectDirectory: string
  workspaceRootPath: string
}) {
  const dependencyQueue = [input.activeAbsolutePath]
  const visitedDependencies = new Set<string>()

  while (dependencyQueue.length > 0) {
    const absolutePath = path.resolve(dependencyQueue.shift()!)
    if (visitedDependencies.has(absolutePath)) continue
    visitedDependencies.add(absolutePath)

    const added = await addSourceFile({
      absolutePath,
      budget: input.budget,
      filesByPath: input.filesByPath,
      workspaceRootPath: input.workspaceRootPath,
    })
    const relativePath = toWorkspaceTypeScriptRelativePath(input.workspaceRootPath, absolutePath)
    const content = relativePath ? input.filesByPath.get(relativePath)?.content : null
    if (!added && !content) {
      if (input.budget.truncated) break
      continue
    }
    if (!content || absolutePath.toLowerCase().endsWith('.json')) continue

    const shouldLoadPackageTypes =
      absolutePath === path.resolve(input.activeAbsolutePath) || isWorkspaceTypeScriptDeclarationFile(absolutePath)

    for (const specifier of extractWorkspaceTypeScriptModuleSpecifiers(content)) {
      if (NODE_BUILTIN_MODULES.has(specifier)) {
        if (shouldLoadPackageTypes) input.packageSpecifiers.add('@types/node')
        continue
      }
      const resolvedLocalFile = await resolveWorkspaceModuleSpecifier({
        compilerOptions: input.compilerOptions,
        importerPath: absolutePath,
        projectDirectory: input.projectDirectory,
        specifier,
        workspaceRootPath: input.workspaceRootPath,
      })
      if (resolvedLocalFile) {
        dependencyQueue.push(resolvedLocalFile)
        continue
      }
      if (shouldLoadPackageTypes && splitWorkspacePackageSpecifier(specifier)) {
        input.packageSpecifiers.add(specifier)
      }
    }
  }
}
async function collectProjectAmbientDeclarations(input: {
  budget: WorkspaceTypeScriptFileBudget
  filesByPath: Map<string, WorkspaceTypeScriptProjectFile>
  packageSpecifiers: Set<string>
  projectDirectory: string
  workspaceRootPath: string
}) {
  let declarationCount = 0

  const visitDirectory = async (directoryPath: string): Promise<void> => {
    if (declarationCount >= MAX_AMBIENT_DECLARATION_FILES || input.budget.truncated) return
    const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (declarationCount >= MAX_AMBIENT_DECLARATION_FILES || input.budget.truncated) return
      if (entry.isSymbolicLink()) continue
      const absolutePath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        if (!SOURCE_IGNORED_DIRECTORIES.has(entry.name)) {
          await visitDirectory(absolutePath)
        }
        continue
      }
      if (!entry.isFile() || !isWorkspaceTypeScriptDeclarationFile(entry.name)) continue

      const relativePath = toWorkspaceTypeScriptRelativePath(input.workspaceRootPath, absolutePath)
      const alreadyIndexed = relativePath ? input.filesByPath.has(relativePath) : false
      await addSourceFile({
        absolutePath,
        budget: input.budget,
        filesByPath: input.filesByPath,
        workspaceRootPath: input.workspaceRootPath,
      })
      if (!alreadyIndexed) declarationCount += 1

      const content = relativePath ? input.filesByPath.get(relativePath)?.content : null
      if (!content) continue
      for (const specifier of extractWorkspaceTypeScriptModuleSpecifiers(content)) {
        if (NODE_BUILTIN_MODULES.has(specifier)) {
          input.packageSpecifiers.add('@types/node')
        } else if (splitWorkspacePackageSpecifier(specifier)) {
          input.packageSpecifiers.add(specifier)
        }
      }
    }
  }

  await visitDirectory(input.projectDirectory)
}

async function collectBoundedProjectSourceIndex(input: {
  activeAbsolutePath: string
  budget: WorkspaceTypeScriptFileBudget
  filesByPath: Map<string, WorkspaceTypeScriptProjectFile>
  projectDirectory: string
  workspaceRootPath: string
}) {
  const criticalGraphTruncated = input.budget.truncated
  input.budget.truncated = false
  const activeRelativePath = path.relative(input.projectDirectory, input.activeAbsolutePath)
  const preferredRootSegment = activeRelativePath.split(path.sep).filter(Boolean)[0] ?? ''

  const visitDirectory = async (directoryPath: string): Promise<void> => {
    if (input.budget.count >= MAX_PROJECT_FILES || input.budget.bytes >= MAX_PROJECT_BYTES) return
    const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])
    entries.sort((left, right) => {
      const score = (name: string) => name === preferredRootSegment ? 0 : name === 'src' ? 1 : 2
      return score(left.name) - score(right.name) || left.name.localeCompare(right.name)
    })

    for (const entry of entries) {
      if (input.budget.count >= MAX_PROJECT_FILES || input.budget.bytes >= MAX_PROJECT_BYTES) return
      if (entry.isSymbolicLink()) continue
      const absolutePath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        if (!SOURCE_IGNORED_DIRECTORIES.has(entry.name)) {
          await visitDirectory(absolutePath)
        }
        continue
      }
      if (!entry.isFile() || !isSourceFile(entry.name)) continue
      await addSourceFile({
        absolutePath,
        budget: input.budget,
        filesByPath: input.filesByPath,
        workspaceRootPath: input.workspaceRootPath,
      })
    }
  }

  await visitDirectory(input.projectDirectory)
  input.budget.truncated = criticalGraphTruncated
}


async function collectIndexedPackageSpecifiers(input: {
  activeAbsolutePath: string
  compilerOptions: Record<string, unknown>
  filesByPath: Map<string, WorkspaceTypeScriptProjectFile>
  projectDirectory: string
  workspaceRootPath: string
}) {
  const packageSpecifiers = new Set<string>()
  const activeRelativePath = toWorkspaceTypeScriptRelativePath(input.workspaceRootPath, input.activeAbsolutePath)

  for (const [filePath, file] of input.filesByPath) {
    if (filePath !== activeRelativePath && !isWorkspaceTypeScriptDeclarationFile(filePath)) {
      continue
    }
    if (filePath.startsWith('node_modules/')) continue

    const importerPath = path.resolve(input.workspaceRootPath, ...filePath.split('/'))
    for (const specifier of extractWorkspaceTypeScriptModuleSpecifiers(file.content)) {
      if (NODE_BUILTIN_MODULES.has(specifier)) {
        packageSpecifiers.add('@types/node')
        continue
      }
      const resolvedLocalFile = await resolveWorkspaceModuleSpecifier({
        compilerOptions: input.compilerOptions,
        importerPath,
        projectDirectory: input.projectDirectory,
        specifier,
        workspaceRootPath: input.workspaceRootPath,
      })
      if (!resolvedLocalFile && splitWorkspacePackageSpecifier(specifier)) {
        packageSpecifiers.add(specifier)
      }
    }
  }

  const configuredTypes = input.compilerOptions.types
  if (Array.isArray(configuredTypes)) {
    for (const typeName of configuredTypes) {
      if (typeof typeName === 'string' && typeName.trim()) {
        packageSpecifiers.add('@types/' + typeName.trim())
      }
    }
  }

  const jsxMode = typeof input.compilerOptions.jsx === 'string' ? input.compilerOptions.jsx.toLowerCase() : ''
  if (jsxMode === 'react-jsx' || jsxMode === 'react-jsxdev' || jsxMode === 'react') {
    packageSpecifiers.add('react')
  }
  if (jsxMode === 'react-jsx') {
    packageSpecifiers.add('react/jsx-runtime')
  } else if (jsxMode === 'react-jsxdev') {
    packageSpecifiers.add('react/jsx-dev-runtime')
  }

  return packageSpecifiers
}

export async function hydrateWorkspaceTypeScriptGraph(input: {
  activeAbsolutePath: string
  compilerOptions: Record<string, unknown>
  files: WorkspaceTypeScriptProjectFile[]
  projectDirectory: string
  sourceTruncated: boolean
  workspaceRootPath: string
}): Promise<WorkspaceTypeScriptGraphResult> {
  const filesByPath = new Map(input.files.map((file) => [file.filePath, file]))
  const sourceBudget: WorkspaceTypeScriptFileBudget = {
    bytes: input.files.reduce((total, file) => total + Buffer.byteLength(file.content), 0),
    count: input.files.length,
    truncated: input.sourceTruncated,
  }

  await collectBoundedProjectSourceIndex({
    activeAbsolutePath: input.activeAbsolutePath,
    budget: sourceBudget,
    filesByPath,
    projectDirectory: input.projectDirectory,
    workspaceRootPath: input.workspaceRootPath,
  })

  const packageSpecifiers = await collectIndexedPackageSpecifiers({
    activeAbsolutePath: input.activeAbsolutePath,
    compilerOptions: input.compilerOptions,
    filesByPath,
    projectDirectory: input.projectDirectory,
    workspaceRootPath: input.workspaceRootPath,
  })
  const packageResult = await loadWorkspaceTypeScriptPackageDeclarations({
    filesByPath,
    projectDirectory: input.projectDirectory,
    requestedSpecifiers: packageSpecifiers,
    workspaceRootPath: input.workspaceRootPath,
  })

  return {
    files: Array.from(filesByPath.values()).sort((left, right) => left.filePath.localeCompare(right.filePath)),
    truncated: sourceBudget.truncated || packageResult.truncated,
  }
}
export async function buildWorkspaceTypeScriptGraph(input: {
  activeAbsolutePath: string
  compilerOptions: Record<string, unknown>
  includeDependencyDeclarations?: boolean
  includeProjectSourceIndex?: boolean
  projectDirectory: string
  workspaceRootPath: string
}): Promise<WorkspaceTypeScriptGraphResult> {
  const filesByPath = new Map<string, WorkspaceTypeScriptProjectFile>()
  const sourceBudget: WorkspaceTypeScriptFileBudget = { bytes: 0, count: 0, truncated: false }
  const packageSpecifiers = new Set<string>()

  await collectImportedSourceGraph({
    activeAbsolutePath: input.activeAbsolutePath,
    budget: sourceBudget,
    compilerOptions: input.compilerOptions,
    filesByPath,
    packageSpecifiers,
    projectDirectory: input.projectDirectory,
    workspaceRootPath: input.workspaceRootPath,
  })

  await collectProjectAmbientDeclarations({
    budget: sourceBudget,
    filesByPath,
    packageSpecifiers,
    projectDirectory: input.projectDirectory,
    workspaceRootPath: input.workspaceRootPath,
  })

  if (input.includeProjectSourceIndex !== false) {
    await collectBoundedProjectSourceIndex({
      activeAbsolutePath: input.activeAbsolutePath,
      budget: sourceBudget,
      filesByPath,
      projectDirectory: input.projectDirectory,
      workspaceRootPath: input.workspaceRootPath,
    })
  }

  const configuredTypes = input.compilerOptions.types
  if (Array.isArray(configuredTypes)) {
    for (const typeName of configuredTypes) {
      if (typeof typeName === 'string' && typeName.trim()) {
        packageSpecifiers.add('@types/' + typeName.trim())
      }
    }
  }

  const jsxMode = typeof input.compilerOptions.jsx === 'string' ? input.compilerOptions.jsx.toLowerCase() : ''
  if (jsxMode === 'react-jsx' || jsxMode === 'react-jsxdev' || jsxMode === 'react') {
    packageSpecifiers.add('react')
  }
  if (jsxMode === 'react-jsx') {
    packageSpecifiers.add('react/jsx-runtime')
  } else if (jsxMode === 'react-jsxdev') {
    packageSpecifiers.add('react/jsx-dev-runtime')
  }

  let packageDeclarationsTruncated = false
  if (input.includeDependencyDeclarations !== false) {
    const packageResult = await loadWorkspaceTypeScriptPackageDeclarations({
      filesByPath,
      projectDirectory: input.projectDirectory,
      requestedSpecifiers: packageSpecifiers,
      workspaceRootPath: input.workspaceRootPath,
    })
    packageDeclarationsTruncated = packageResult.truncated
  }

  return {
    files: Array.from(filesByPath.values()).sort((left, right) => left.filePath.localeCompare(right.filePath)),
    truncated: sourceBudget.truncated || packageDeclarationsTruncated,
  }
}
