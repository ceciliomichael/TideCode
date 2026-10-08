import type {
  WorkspaceTypeScriptProjectInput,
  WorkspaceTypeScriptProjectSnapshot,
} from '../../src/types/chat'
import { assertWorkspaceDirectory, getSafeWorkspaceTargetPath, normalizeWorkspacePath } from './paths'
import { resolveWorkspaceTypeScriptConfig } from './typescriptProjectConfig'
import { buildWorkspaceTypeScriptGraph, hydrateWorkspaceTypeScriptGraph } from './typescriptProjectGraph'

const MAX_CACHED_PROJECT_SNAPSHOTS = 6
const projectSnapshotCache = new Map<string, Promise<WorkspaceTypeScriptProjectSnapshot>>()

const MAX_CACHED_PROJECT_BYTES = 32 * 1024 * 1024
const snapshotBytes = new Map<string, number>()

function normalizeCacheRelativePath(relativePath: string) {
  return relativePath.trim().replace(/\\/gu, '/').replace(/^\.\/+/u, '')
}

function createCacheKey(
  workspaceRootPath: string,
  relativePath: string,
  includeDependencyDeclarations: boolean,
) {
  return workspaceRootPath
    + '\0'
    + normalizeCacheRelativePath(relativePath)
    + '\0'
    + (includeDependencyDeclarations ? 'full' : 'source')
}

function pruneSnapshotCache() {
  let totalBytes = [...snapshotBytes.values()].reduce((total, bytes) => total + bytes, 0)
  while (projectSnapshotCache.size > MAX_CACHED_PROJECT_SNAPSHOTS || totalBytes > MAX_CACHED_PROJECT_BYTES) {
    const oldestKey = projectSnapshotCache.keys().next().value as string | undefined
    if (!oldestKey) return
    totalBytes -= snapshotBytes.get(oldestKey) ?? 0
    snapshotBytes.delete(oldestKey)
    projectSnapshotCache.delete(oldestKey)
  }
}

async function buildProjectSnapshot(
  input: WorkspaceTypeScriptProjectInput,
): Promise<WorkspaceTypeScriptProjectSnapshot> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const activeTarget = getSafeWorkspaceTargetPath(workspaceRootPath, input.relativePath)
  const activeStats = await import('node:fs/promises')
    .then((fs) => fs.stat(activeTarget.absolutePath))
    .catch(() => null)
  if (!activeStats?.isFile()) {
    throw new Error('TypeScript project file does not exist: ' + activeTarget.relativePath)
  }

  const config = await resolveWorkspaceTypeScriptConfig(workspaceRootPath, activeTarget.relativePath)
  const includeDependencyDeclarations = input.includeDependencyDeclarations !== false
  const sourceSnapshot = includeDependencyDeclarations
    ? await projectSnapshotCache
        .get(createCacheKey(workspaceRootPath, activeTarget.relativePath, false))
        ?.catch(() => null)
    : null
  const graph = sourceSnapshot?.projectKey === config.projectKey
    ? await hydrateWorkspaceTypeScriptGraph({
        activeAbsolutePath: activeTarget.absolutePath,
        compilerOptions: config.compilerOptions,
        files: sourceSnapshot.files,
        projectDirectory: config.projectDirectory,
        sourceTruncated: sourceSnapshot.truncated,
        workspaceRootPath,
      })
    : await buildWorkspaceTypeScriptGraph({
        activeAbsolutePath: activeTarget.absolutePath,
        compilerOptions: config.compilerOptions,
        includeDependencyDeclarations,
        includeProjectSourceIndex: includeDependencyDeclarations,
        projectDirectory: config.projectDirectory,
        workspaceRootPath,
      })

  return {
    compilerOptions: config.compilerOptions,
    configPath: config.configPath,
    files: graph.files,
    projectKey: config.projectKey,
    truncated: graph.truncated,
  }
}

export function invalidateWorkspaceTypeScriptProjectCache(workspaceRootPathInput: string) {
  let workspaceRootPath: string
  try {
    workspaceRootPath = normalizeWorkspacePath(workspaceRootPathInput)
  } catch {
    return
  }
  const prefix = workspaceRootPath + '\0'
  for (const key of Array.from(projectSnapshotCache.keys())) {
    if (key.startsWith(prefix)) {
      projectSnapshotCache.delete(key)
      snapshotBytes.delete(key)
    }
  }
}

export function clearWorkspaceTypeScriptProjectCache() {
  projectSnapshotCache.clear()
  snapshotBytes.clear()
}

export function getWorkspaceTypeScriptProject(
  input: WorkspaceTypeScriptProjectInput,
): Promise<WorkspaceTypeScriptProjectSnapshot> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  const includeDependencyDeclarations = input.includeDependencyDeclarations !== false
  const cacheKey = createCacheKey(workspaceRootPath, input.relativePath, includeDependencyDeclarations)
  const cached = projectSnapshotCache.get(cacheKey)
  if (cached) {
    projectSnapshotCache.delete(cacheKey)
    projectSnapshotCache.set(cacheKey, cached)
    return cached
  }

  const snapshotPromise = buildProjectSnapshot({
    ...input,
    workspaceRootPath,
  }).then((snapshot) => {
    if (projectSnapshotCache.get(cacheKey) === snapshotPromise) {
      const bytes = snapshot.files.reduce((total, file) => total + file.content.length * 2, 0)
      snapshotBytes.set(cacheKey, bytes)
      pruneSnapshotCache()
    }
    return snapshot
  }).catch((error: unknown) => {
    if (projectSnapshotCache.get(cacheKey) === snapshotPromise) {
      projectSnapshotCache.delete(cacheKey)
      snapshotBytes.delete(cacheKey)
    }
    throw error
  })
  projectSnapshotCache.set(cacheKey, snapshotPromise)
  pruneSnapshotCache()
  return snapshotPromise
}
