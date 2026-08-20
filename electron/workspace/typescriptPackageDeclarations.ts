import { promises as fs } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import type { WorkspaceTypeScriptProjectFile } from '../../src/types/chat'
import {
  addWorkspaceTypeScriptTextFile,
  isPathInsideWorkspaceRoot,
  isWorkspaceTypeScriptDeclarationFile,
  toWorkspaceTypeScriptRelativePath,
  type WorkspaceTypeScriptFileBudget,
} from './typescriptProjectFileStore'
import {
  extractWorkspaceTypeScriptModuleSpecifiers,
  extractWorkspaceTypeScriptReferencePaths,
  splitWorkspacePackageSpecifier,
  toWorkspaceTypesPackageSpecifier,
} from './typescriptModuleSpecifiers'

const MAX_PACKAGE_FILES = 320
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024
const MAX_PACKAGE_REQUESTS = 512
const NODE_BUILTIN_MODULES = new Set(builtinModules.flatMap((moduleName) => [moduleName, 'node:' + moduleName]))

interface PackageJsonRecord {
  packageJsonPath: string
  value: Record<string, unknown>
}

interface PackageRequestResolution {
  entryCandidates: string[]
  resolved: boolean
}

export interface WorkspaceTypeScriptPackageDeclarationsResult {
  truncated: boolean
}

async function pathIsFile(candidatePath: string) {
  const stats = await fs.stat(candidatePath).catch(() => null)
  return stats?.isFile() ?? false
}

async function findWorkspaceNodeModulesDirectory(workspaceRootPath: string, startDirectory: string) {
  const normalizedWorkspaceRoot = path.resolve(workspaceRootPath)
  let currentDirectory = path.resolve(startDirectory)

  while (
    currentDirectory === normalizedWorkspaceRoot ||
    currentDirectory.startsWith(normalizedWorkspaceRoot + path.sep)
  ) {
    const candidate = path.join(currentDirectory, 'node_modules')
    const stats = await fs.stat(candidate).catch(() => null)
    if (stats?.isDirectory()) {
      return candidate
    }
    if (currentDirectory === normalizedWorkspaceRoot) {
      return null
    }
    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return null
    }
    const relativeParent = path.relative(normalizedWorkspaceRoot, parentDirectory)
    if (
      relativeParent === '..' ||
      relativeParent.startsWith('..' + path.sep) ||
      path.isAbsolute(relativeParent)
    ) {
      return null
    }
    currentDirectory = parentDirectory
  }
  return null
}

function packageDirectory(nodeModulesDirectory: string, packageName: string) {
  return path.join(nodeModulesDirectory, ...packageName.split('/'))
}

async function readPackageJson(packageRoot: string): Promise<PackageJsonRecord | null> {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  const content = await fs.readFile(packageJsonPath, 'utf8').catch(() => null)
  if (content === null) return null

  try {
    const value = JSON.parse(content) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }
    return { packageJsonPath, value: value as Record<string, unknown> }
  } catch {
    return null
  }
}

function matchWildcardPattern(pattern: string, value: string) {
  const wildcardIndex = pattern.indexOf('*')
  if (wildcardIndex < 0) {
    return pattern === value ? '' : null
  }
  const prefix = pattern.slice(0, wildcardIndex)
  const suffix = pattern.slice(wildcardIndex + 1)
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    return null
  }
  return value.slice(prefix.length, value.length - suffix.length)
}

function replaceWildcard(value: string, wildcardValue: string) {
  return value.includes('*') ? value.replace(/\*/gu, wildcardValue) : value
}

function collectTypeTargets(value: unknown, wildcardValue: string, typeContext = false, depth = 0): string[] {
  if (depth > 8) return []
  if (typeof value === 'string') {
    const target = replaceWildcard(value, wildcardValue)
    return typeContext || /\.d\.(?:ts|mts|cts)$/iu.test(target) ? [target] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTypeTargets(entry, wildcardValue, typeContext, depth + 1))
  }
  if (!value || typeof value !== 'object') {
    return []
  }

  const targets: string[] = []
  for (const [key, child] of Object.entries(value)) {
    targets.push(...collectTypeTargets(child, wildcardValue, typeContext || key === 'types' || key === 'typings', depth + 1))
  }
  return targets
}

function findMatchedExportValue(exportsValue: unknown, exportKey: string) {
  if (!exportsValue || typeof exportsValue !== 'object' || Array.isArray(exportsValue)) {
    return exportKey === '.' ? { value: exportsValue, wildcardValue: '' } : null
  }

  const exportsRecord = exportsValue as Record<string, unknown>
  const subpathKeys = Object.keys(exportsRecord).filter((key) => key.startsWith('.'))
  if (subpathKeys.length === 0) {
    return exportKey === '.' ? { value: exportsValue, wildcardValue: '' } : null
  }

  if (Object.prototype.hasOwnProperty.call(exportsRecord, exportKey)) {
    return { value: exportsRecord[exportKey], wildcardValue: '' }
  }

  let bestMatch: { pattern: string; value: unknown; wildcardValue: string } | null = null
  for (const pattern of subpathKeys) {
    const wildcardValue = matchWildcardPattern(pattern, exportKey)
    if (wildcardValue === null) continue
    if (!bestMatch || pattern.length > bestMatch.pattern.length) {
      bestMatch = { pattern, value: exportsRecord[pattern], wildcardValue }
    }
  }
  return bestMatch ? { value: bestMatch.value, wildcardValue: bestMatch.wildcardValue } : null
}

function collectTypesVersionTargets(
  packageJson: Record<string, unknown>,
  subpath: string,
) {
  const typesVersions = packageJson.typesVersions
  if (!typesVersions || typeof typesVersions !== 'object' || Array.isArray(typesVersions)) {
    return []
  }

  for (const versionRecord of Object.values(typesVersions)) {
    if (!versionRecord || typeof versionRecord !== 'object' || Array.isArray(versionRecord)) continue
    const mappings = versionRecord as Record<string, unknown>
    for (const [pattern, targets] of Object.entries(mappings)) {
      const wildcardValue = matchWildcardPattern(pattern, subpath)
      if (wildcardValue === null || !Array.isArray(targets)) continue
      return targets.flatMap((target) =>
        typeof target === 'string' ? [replaceWildcard(target, wildcardValue)] : [],
      )
    }
  }
  return []
}

function addDirectDeclarationCandidates(candidates: Set<string>, candidatePath: string) {
  const extension = path.extname(candidatePath).toLowerCase()
  if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') {
    const withoutExtension = candidatePath.slice(0, -extension.length)
    if (extension === '.mjs') candidates.add(withoutExtension + '.d.mts')
    if (extension === '.cjs') candidates.add(withoutExtension + '.d.cts')
    candidates.add(withoutExtension + '.d.ts')
    return
  }
  if (/\.d\.(?:ts|mts|cts)$/iu.test(candidatePath)) {
    candidates.add(candidatePath)
    return
  }
  if (extension) {
    candidates.add(candidatePath)
    return
  }
  candidates.add(candidatePath + '.d.ts')
  candidates.add(candidatePath + '.d.mts')
  candidates.add(candidatePath + '.d.cts')
  candidates.add(path.join(candidatePath, 'index.d.ts'))
  candidates.add(path.join(candidatePath, 'index.d.mts'))
  candidates.add(path.join(candidatePath, 'index.d.cts'))
}

async function resolvePackageRequest(
  packageRoot: string,
  packageJson: Record<string, unknown> | null,
  packageName: string,
  specifier: string,
): Promise<PackageRequestResolution> {
  const parts = splitWorkspacePackageSpecifier(specifier)
  if (!parts || parts.packageName !== packageName) {
    return { entryCandidates: [], resolved: false }
  }

  const candidatePaths = new Set<string>()
  if (!parts.subpath) {
    const typesPath = typeof packageJson?.types === 'string'
      ? packageJson.types
      : typeof packageJson?.typings === 'string'
        ? packageJson.typings
        : null
    if (typesPath) {
      addDirectDeclarationCandidates(candidatePaths, path.resolve(packageRoot, typesPath))
    }
  }

  const exportKey = parts.subpath ? './' + parts.subpath : '.'
  const matchedExport = findMatchedExportValue(packageJson?.exports, exportKey)
  if (matchedExport) {
    for (const target of collectTypeTargets(matchedExport.value, matchedExport.wildcardValue)) {
      addDirectDeclarationCandidates(candidatePaths, path.resolve(packageRoot, target))
    }
  }

  if (parts.subpath && packageJson) {
    for (const target of collectTypesVersionTargets(packageJson, parts.subpath)) {
      addDirectDeclarationCandidates(candidatePaths, path.resolve(packageRoot, target))
    }
  }

  if (parts.subpath) {
    addDirectDeclarationCandidates(candidatePaths, path.resolve(packageRoot, parts.subpath))
  } else {
    candidatePaths.add(path.join(packageRoot, 'index.d.ts'))
    candidatePaths.add(path.join(packageRoot, 'index.d.mts'))
    candidatePaths.add(path.join(packageRoot, 'index.d.cts'))
  }

  const existingCandidates: string[] = []
  for (const candidatePath of candidatePaths) {
    if (!isPathInsideWorkspaceRoot(packageRoot, candidatePath)) continue
    if (await pathIsFile(candidatePath) && isWorkspaceTypeScriptDeclarationFile(candidatePath)) {
      existingCandidates.push(candidatePath)
    }
  }

  return {
    entryCandidates: existingCandidates,
    resolved: existingCandidates.length > 0,
  }
}

async function resolveRelativeDeclarationSpecifier(
  packageRoot: string,
  importerPath: string,
  specifier: string,
) {
  if (!specifier.startsWith('.')) return null
  const candidatePath = path.resolve(path.dirname(importerPath), specifier)
  if (!isPathInsideWorkspaceRoot(packageRoot, candidatePath)) return null

  const candidates = new Set<string>()
  addDirectDeclarationCandidates(candidates, candidatePath)
  for (const declarationPath of candidates) {
    if (await pathIsFile(declarationPath) && isWorkspaceTypeScriptDeclarationFile(declarationPath)) {
      return declarationPath
    }
  }
  return null
}

async function collectPackageDeclarationGraph(input: {
  budget: WorkspaceTypeScriptFileBudget
  entryCandidates: readonly string[]
  filesByPath: Map<string, WorkspaceTypeScriptProjectFile>
  packageRoot: string
  requestedSpecifiers: Set<string>
  workspaceRootPath: string
}) {
  const queue = [...input.entryCandidates]
  const visited = new Set<string>()

  while (queue.length > 0) {
    if (input.budget.count >= MAX_PACKAGE_FILES || input.budget.bytes >= MAX_PACKAGE_BYTES) {
      input.budget.truncated = true
      return
    }

    const absolutePath = path.resolve(queue.shift()!)
    if (visited.has(absolutePath) || !isPathInsideWorkspaceRoot(input.packageRoot, absolutePath)) continue
    visited.add(absolutePath)
    if (!await pathIsFile(absolutePath) || !isWorkspaceTypeScriptDeclarationFile(absolutePath)) continue

    await addWorkspaceTypeScriptTextFile({
      absolutePath,
      budget: input.budget,
      filesByPath: input.filesByPath,
      maxBytes: MAX_PACKAGE_BYTES,
      maxFiles: MAX_PACKAGE_FILES,
      workspaceRootPath: input.workspaceRootPath,
    })
    const relativePath = toWorkspaceTypeScriptRelativePath(input.workspaceRootPath, absolutePath)
    const content = relativePath ? input.filesByPath.get(relativePath)?.content : null
    if (!content) continue

    for (const referencePath of extractWorkspaceTypeScriptReferencePaths(content)) {
      const absoluteReferencePath = path.resolve(path.dirname(absolutePath), referencePath)
      if (
        isPathInsideWorkspaceRoot(input.packageRoot, absoluteReferencePath) &&
        await pathIsFile(absoluteReferencePath) &&
        isWorkspaceTypeScriptDeclarationFile(absoluteReferencePath)
      ) {
        queue.push(absoluteReferencePath)
      }
    }

    for (const specifier of extractWorkspaceTypeScriptModuleSpecifiers(content)) {
      if (NODE_BUILTIN_MODULES.has(specifier)) {
        input.requestedSpecifiers.add('@types/node')
        continue
      }
      const relativeDeclaration = await resolveRelativeDeclarationSpecifier(input.packageRoot, absolutePath, specifier)
      if (relativeDeclaration) {
        queue.push(relativeDeclaration)
        continue
      }
      if (splitWorkspacePackageSpecifier(specifier)) {
        input.requestedSpecifiers.add(specifier)
      }
    }
  }
}

async function loadPackageRequests(input: {
  budget: WorkspaceTypeScriptFileBudget
  filesByPath: Map<string, WorkspaceTypeScriptProjectFile>
  nodeModulesDirectory: string
  packageName: string
  requestedSpecifiers: Set<string>
  requests: readonly string[]
  workspaceRootPath: string
}) {
  const packageRoot = packageDirectory(input.nodeModulesDirectory, input.packageName)
  const packageStats = await fs.stat(packageRoot).catch(() => null)
  if (!packageStats?.isDirectory()) {
    return new Set<string>()
  }

  const packageJson = await readPackageJson(packageRoot)
  if (packageJson) {
    await addWorkspaceTypeScriptTextFile({
      absolutePath: packageJson.packageJsonPath,
      budget: input.budget,
      filesByPath: input.filesByPath,
      maxBytes: MAX_PACKAGE_BYTES,
      maxFiles: MAX_PACKAGE_FILES,
      workspaceRootPath: input.workspaceRootPath,
    })
  }

  const resolvedRequests = new Set<string>()
  const entryCandidates = new Set<string>()
  for (const request of input.requests) {
    const resolution = await resolvePackageRequest(
      packageRoot,
      packageJson?.value ?? null,
      input.packageName,
      request,
    )
    if (resolution.resolved) {
      resolvedRequests.add(request)
      for (const entryCandidate of resolution.entryCandidates) {
        entryCandidates.add(entryCandidate)
      }
    }
  }

  await collectPackageDeclarationGraph({
    budget: input.budget,
    entryCandidates: Array.from(entryCandidates),
    filesByPath: input.filesByPath,
    packageRoot,
    requestedSpecifiers: input.requestedSpecifiers,
    workspaceRootPath: input.workspaceRootPath,
  })
  return resolvedRequests
}

function groupPendingPackageRequests(requestedSpecifiers: ReadonlySet<string>, attemptedSpecifiers: ReadonlySet<string>) {
  const grouped = new Map<string, string[]>()
  for (const specifier of requestedSpecifiers) {
    if (attemptedSpecifiers.has(specifier)) continue
    const parts = splitWorkspacePackageSpecifier(specifier)
    if (!parts) continue
    const group = grouped.get(parts.packageName) ?? []
    group.push(specifier)
    grouped.set(parts.packageName, group)
  }
  return grouped
}

export async function loadWorkspaceTypeScriptPackageDeclarations(input: {
  filesByPath: Map<string, WorkspaceTypeScriptProjectFile>
  projectDirectory: string
  requestedSpecifiers: Set<string>
  workspaceRootPath: string
}): Promise<WorkspaceTypeScriptPackageDeclarationsResult> {
  const nodeModulesDirectory = await findWorkspaceNodeModulesDirectory(
    input.workspaceRootPath,
    input.projectDirectory,
  )
  if (!nodeModulesDirectory || input.requestedSpecifiers.size === 0) {
    return { truncated: false }
  }

  const budget: WorkspaceTypeScriptFileBudget = { bytes: 0, count: 0, truncated: false }
  const attemptedSpecifiers = new Set<string>()
  let pendingGroups = groupPendingPackageRequests(input.requestedSpecifiers, attemptedSpecifiers)

  while (pendingGroups.size > 0) {
    if (attemptedSpecifiers.size >= MAX_PACKAGE_REQUESTS) {
      budget.truncated = true
      break
    }

    for (const [packageName, requests] of pendingGroups) {
      if (budget.count >= MAX_PACKAGE_FILES || budget.bytes >= MAX_PACKAGE_BYTES) {
        budget.truncated = true
        break
      }
      for (const request of requests) {
        if (attemptedSpecifiers.size >= MAX_PACKAGE_REQUESTS) {
          budget.truncated = true
          break
        }
        attemptedSpecifiers.add(request)
      }
      if (budget.truncated) break

      const resolvedRequests = await loadPackageRequests({
        budget,
        filesByPath: input.filesByPath,
        nodeModulesDirectory,
        packageName,
        requestedSpecifiers: input.requestedSpecifiers,
        requests,
        workspaceRootPath: input.workspaceRootPath,
      })

      for (const request of requests) {
        if (resolvedRequests.has(request)) continue
        const typesRequest = toWorkspaceTypesPackageSpecifier(request)
        if (typesRequest !== request && !attemptedSpecifiers.has(typesRequest)) {
          input.requestedSpecifiers.add(typesRequest)
        }
      }
    }

    if (budget.truncated) break
    pendingGroups = groupPendingPackageRequests(input.requestedSpecifiers, attemptedSpecifiers)
  }

  if (
    Array.from(input.requestedSpecifiers).some((specifier) =>
      splitWorkspacePackageSpecifier(specifier) && !attemptedSpecifiers.has(specifier),
    )
  ) {
    budget.truncated = true
  }

  return { truncated: budget.truncated }
}
