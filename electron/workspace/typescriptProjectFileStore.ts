import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { WorkspaceTypeScriptProjectFile } from '../../src/types/chat'

// Some declaration bundles, especially icon libraries, intentionally publish one large .d.ts file.
// Keep the per-file ceiling above those bundles while the separate project/package byte budgets bound total memory use.
export const MAX_WORKSPACE_TYPESCRIPT_SINGLE_FILE_BYTES = 3 * 1024 * 1024

export interface WorkspaceTypeScriptFileBudget {
  bytes: number
  count: number
  truncated: boolean
}

const DECLARATION_EXTENSIONS = ['.d.ts', '.d.mts', '.d.cts']

export function isWorkspaceTypeScriptDeclarationFile(filePath: string) {
  const normalizedPath = filePath.toLowerCase()
  return DECLARATION_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension))
}

export function isPathInsideWorkspaceRoot(rootPath: string, absolutePath: string) {
  const relativePath = path.relative(rootPath, absolutePath)
  return relativePath !== '..' && !relativePath.startsWith('..' + path.sep) && !path.isAbsolute(relativePath)
}

export function toWorkspaceTypeScriptRelativePath(workspaceRootPath: string, absolutePath: string) {
  const relativePath = path.relative(workspaceRootPath, absolutePath)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith('..' + path.sep) ||
    path.isAbsolute(relativePath)
  ) {
    return null
  }
  return relativePath.split(path.sep).join('/')
}

export async function addWorkspaceTypeScriptTextFile(input: {
  absolutePath: string
  budget: WorkspaceTypeScriptFileBudget
  filesByPath: Map<string, WorkspaceTypeScriptProjectFile>
  maxBytes: number
  maxFiles: number
  workspaceRootPath: string
}) {
  const relativePath = toWorkspaceTypeScriptRelativePath(input.workspaceRootPath, input.absolutePath)
  if (!relativePath || input.filesByPath.has(relativePath)) {
    return false
  }

  if (input.budget.count >= input.maxFiles || input.budget.bytes >= input.maxBytes) {
    input.budget.truncated = true
    return false
  }

  const stats = await fs.stat(input.absolutePath).catch(() => null)
  if (!stats?.isFile() || stats.size > MAX_WORKSPACE_TYPESCRIPT_SINGLE_FILE_BYTES) {
    if (stats?.isFile()) {
      input.budget.truncated = true
    }
    return false
  }
  if (input.budget.bytes + stats.size > input.maxBytes) {
    input.budget.truncated = true
    return false
  }

  const content = await fs.readFile(input.absolutePath, 'utf8').catch(() => null)
  if (content === null) {
    return false
  }

  input.filesByPath.set(relativePath, { content, filePath: relativePath })
  input.budget.count += 1
  input.budget.bytes += stats.size
  return true
}
