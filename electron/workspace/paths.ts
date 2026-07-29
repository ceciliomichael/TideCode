import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getAgentContextsDirectoryPath } from '../history/paths'

export const DEFAULT_WORKSPACE_RELATIVE_PATH = '.'

export function normalizeWorkspacePath(workspaceRootPath: string) {
  return path.resolve(workspaceRootPath.trim())
}

export function normalizeWorkspaceRelativePath(relativePath: string | undefined) {
  const normalized = (relativePath ?? DEFAULT_WORKSPACE_RELATIVE_PATH).trim()
  return normalized.length === 0 ? DEFAULT_WORKSPACE_RELATIVE_PATH : normalized
}

export function getSafeWorkspaceTargetPath(workspaceRootPath: string, relativePath: string | undefined) {
  const normalizedRelativePath = normalizeWorkspaceRelativePath(relativePath)
  const absolutePath = path.resolve(workspaceRootPath, normalizedRelativePath)
  const workspaceRelativePath = path.relative(workspaceRootPath, absolutePath)

  if (workspaceRelativePath.startsWith('..') || path.isAbsolute(workspaceRelativePath)) {
    throw new Error(`Path is outside the workspace root: ${relativePath ?? DEFAULT_WORKSPACE_RELATIVE_PATH}`)
  }

  return {
    absolutePath,
    relativePath: workspaceRelativePath === '' ? DEFAULT_WORKSPACE_RELATIVE_PATH : workspaceRelativePath,
  }
}

function isAgentContextPath(targetPath: string): boolean {
  try {
    const agentContextsDir = path.resolve(getAgentContextsDirectoryPath())
    const resolvedTargetPath = path.resolve(targetPath)
    return (
      resolvedTargetPath === agentContextsDir ||
      resolvedTargetPath.startsWith(agentContextsDir + path.sep)
    )
  } catch {
    return false
  }
}

export async function assertWorkspaceDirectory(workspaceRootPath: string) {
  const stats = await fs.stat(workspaceRootPath).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (isAgentContextPath(workspaceRootPath)) {
        await fs.mkdir(workspaceRootPath, { recursive: true })
        return fs.stat(workspaceRootPath)
      }
      throw new Error(`Workspace path does not exist: ${workspaceRootPath}`)
    }

    throw error
  })

  if (!stats.isDirectory()) {
    throw new Error(`Workspace root must be a directory: ${workspaceRootPath}`)
  }
}
