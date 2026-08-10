import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface SandboxPathRoots {
  globalAgentsDirectory: string
  workspaceRootPath: string
}

export function getGlobalAgentsDirectory() {
  return path.resolve(os.homedir(), '.agents')
}

export function getSandboxPathRoots(workspaceRootPath: string): SandboxPathRoots {
  return {
    globalAgentsDirectory: getGlobalAgentsDirectory(),
    workspaceRootPath: path.resolve(workspaceRootPath),
  }
}

export function isPathInsideRoot(rootPath: string, targetPath: string) {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export function isPathAllowedInSandbox(targetPath: string, roots: SandboxPathRoots) {
  return (
    isPathInsideRoot(roots.workspaceRootPath, targetPath) ||
    isPathInsideRoot(roots.globalAgentsDirectory, targetPath)
  )
}

function createSandboxPathError(targetPath: string, roots: SandboxPathRoots) {
  return new Error(
    [
      `Path is outside the sandbox roots: ${targetPath}.`,
      `Allowed roots are the workspace (${roots.workspaceRootPath})`,
      'and directories explicitly provided by a loaded skill.',
    ].join(' '),
  )
}

export function resolveSandboxPath(
  workspaceRootPath: string,
  candidatePath: string | undefined,
) {
  const roots = getSandboxPathRoots(workspaceRootPath)
  const normalizedCandidate = candidatePath?.trim() ?? ''
  const absolutePath =
    normalizedCandidate.length === 0
      ? roots.workspaceRootPath
      : path.isAbsolute(normalizedCandidate)
        ? path.resolve(normalizedCandidate)
        : path.resolve(roots.workspaceRootPath, normalizedCandidate)

  if (!isPathAllowedInSandbox(absolutePath, roots)) {
    throw createSandboxPathError(absolutePath, roots)
  }

  const workspaceRelativePath = path.relative(roots.workspaceRootPath, absolutePath)
  return {
    absolutePath,
    displayPath:
      isPathInsideRoot(roots.workspaceRootPath, absolutePath)
        ? workspaceRelativePath === ''
          ? '.'
          : workspaceRelativePath
        : absolutePath,
    roots,
  }
}

async function resolveExistingRealPath(targetPath: string) {
  try {
    return await fs.realpath(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export async function assertSandboxPathDoesNotEscapeThroughSymlink(
  targetPath: string,
  roots: SandboxPathRoots,
) {
  const realTargetPath = await resolveExistingRealPath(targetPath)
  if (!realTargetPath) {
    return
  }

  const [realWorkspaceRootPath, realGlobalAgentsDirectory] = await Promise.all([
    resolveExistingRealPath(roots.workspaceRootPath),
    resolveExistingRealPath(roots.globalAgentsDirectory),
  ])
  const canonicalRoots: SandboxPathRoots = {
    globalAgentsDirectory: realGlobalAgentsDirectory ?? roots.globalAgentsDirectory,
    workspaceRootPath: realWorkspaceRootPath ?? roots.workspaceRootPath,
  }

  if (!isPathAllowedInSandbox(realTargetPath, canonicalRoots)) {
    throw new Error(
      `Path escapes the sandbox roots through a symbolic link: ${targetPath}.`,
    )
  }
}

function containsDynamicShellPathSyntax(targetPath: string) {
  return (
    targetPath.startsWith('~') ||
    /[$%`*?[\]]/u.test(targetPath)
  )
}

export function assertSandboxCommandWorkingDirectories(
  command: string,
  workspaceRootPath: string,
  initialWorkingDirectory: string,
) {
  const roots = getSandboxPathRoots(workspaceRootPath)
  const resolvedWorkingDirectories: string[] = []
  const changeDirectoryPattern =
    /(?:^|[;&|]\s*)(?:cd|chdir|pushd|set-location|sl)\s+(?:(?:-literalpath|-path)\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/giu
  let currentWorkingDirectory = path.resolve(initialWorkingDirectory)
  let match: RegExpExecArray | null

  while ((match = changeDirectoryPattern.exec(command)) !== null) {
    const targetPath = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (targetPath.length === 0) {
      continue
    }

    if (containsDynamicShellPathSyntax(targetPath)) {
      throw new Error(
        `Sandboxed directory changes must use a literal path inside the workspace or ${roots.globalAgentsDirectory}.`,
      )
    }

    const resolvedTargetPath = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(currentWorkingDirectory, targetPath)
    if (!isPathAllowedInSandbox(resolvedTargetPath, roots)) {
      throw createSandboxPathError(resolvedTargetPath, roots)
    }

    currentWorkingDirectory = resolvedTargetPath
    resolvedWorkingDirectories.push(resolvedTargetPath)
  }

  return resolvedWorkingDirectories
}
