import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppTerminalExecutionMode } from '../../../../src/types/chat'
import {
  DEFAULT_WORKSPACE_RELATIVE_PATH,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from '../../../workspace/paths'
import type { AgentToolContext } from '../toolTypes'
import {
  assertSandboxPathDoesNotEscapeThroughSymlink,
  getSandboxPathRoots,
  isPathInsideRoot,
  resolveSandboxPath,
} from './sandboxPaths'

export interface WorkspaceReadScope {
  endLine: number
  startLine: number
}

export interface WorkspaceToolContext extends Pick<AgentToolContext, 'checkpointId' | 'terminalExecutionMode' | 'workspaceRootPath'> {
  /** Latest successful file-read range, keyed by the resolved absolute path. */
  readScopes?: Map<string, WorkspaceReadScope>
}

export const WORKSPACE_PATH_DESCRIPTION =
  'Accepts exactly one path; read, list, glob, and grep targets must already exist. Prefer a path relative to the workspace root. Use an absolute path only when copied exactly from the user or a tool result; never construct one. To inspect multiple roots, make separate calls; never join paths with spaces.'

function assertWorkspaceRootIsNotRepeated(workspaceRootPath: string, candidatePath: string) {
  const normalizedCandidatePath = path.resolve(candidatePath)
  const workspaceFolderName = path.basename(workspaceRootPath)
  if (!workspaceFolderName) {
    return
  }

  const repeatedRootPath = path.join(workspaceRootPath, workspaceFolderName)
  if (
    normalizedCandidatePath !== repeatedRootPath &&
    !normalizedCandidatePath.startsWith(`${repeatedRootPath}${path.sep}`)
  ) {
    return
  }

  throw new Error('Invalid path: workspace root repeated. Use a path relative to the workspace root.')
}

export function resolveWorkspaceTargetPath(workspaceRootPath: string, candidatePath: string | undefined) {
  const normalizedWorkspaceRootPath = normalizeWorkspacePath(workspaceRootPath)
  if (!candidatePath || candidatePath.trim().length === 0) {
    return {
      absolutePath: normalizedWorkspaceRootPath,
      relativePath: DEFAULT_WORKSPACE_RELATIVE_PATH,
    }
  }

  if (path.isAbsolute(candidatePath.trim())) {
    assertWorkspaceRootIsNotRepeated(normalizedWorkspaceRootPath, candidatePath.trim())
  }

  return getSafeWorkspaceTargetPath(normalizedWorkspaceRootPath, candidatePath)
}

export function resolveReadableTargetPath(
  workspaceRootPath: string,
  candidatePath: string | undefined,
  terminalExecutionMode: AppTerminalExecutionMode = 'sandbox',
  options: { allowGlobalAgentsDirectory?: boolean } = {},
) {
  const normalizedWorkspaceRootPath = normalizeWorkspacePath(workspaceRootPath)
  const normalizedCandidatePath = candidatePath?.trim()
  if (normalizedCandidatePath && path.isAbsolute(normalizedCandidatePath)) {
    assertWorkspaceRootIsNotRepeated(normalizedWorkspaceRootPath, normalizedCandidatePath)
  }

  if (terminalExecutionMode === 'sandbox') {
    if (options.allowGlobalAgentsDirectory) {
      const target = resolveSandboxPath(normalizedWorkspaceRootPath, candidatePath)
      return {
        absolutePath: target.absolutePath,
        displayPath: target.displayPath,
      }
    }

    const target = resolveWorkspaceTargetPath(normalizedWorkspaceRootPath, candidatePath)
    return {
      absolutePath: target.absolutePath,
      displayPath: target.relativePath,
    }
  }

  if (!candidatePath || candidatePath.trim().length === 0) {
    return {
      absolutePath: normalizedWorkspaceRootPath,
      displayPath: DEFAULT_WORKSPACE_RELATIVE_PATH,
    }
  }

  const fullAccessCandidatePath = candidatePath.trim()

  const absolutePath = path.isAbsolute(fullAccessCandidatePath)
    ? path.resolve(fullAccessCandidatePath)
    : path.resolve(normalizedWorkspaceRootPath, fullAccessCandidatePath)
  const relativePath = path.relative(normalizedWorkspaceRootPath, absolutePath)

  return {
    absolutePath,
    displayPath: isPathInsideRoot(normalizedWorkspaceRootPath, absolutePath)
      ? relativePath === ''
        ? DEFAULT_WORKSPACE_RELATIVE_PATH
        : relativePath
      : absolutePath,
  }
}

export async function resolveReadOnlyTargetPath(
  workspaceRootPath: string,
  candidatePath: string | undefined,
  terminalExecutionMode: AppTerminalExecutionMode = 'sandbox',
) {
  const target = resolveReadableTargetPath(
    workspaceRootPath,
    candidatePath,
    terminalExecutionMode,
    { allowGlobalAgentsDirectory: true },
  )

  if (terminalExecutionMode === 'sandbox') {
    await assertSandboxPathDoesNotEscapeThroughSymlink(
      target.absolutePath,
      getSandboxPathRoots(normalizeWorkspacePath(workspaceRootPath)),
    )
  }

  await assertWorkspaceTargetExists(candidatePath, target.absolutePath)

  return target
}

async function assertWorkspaceTargetExists(
  candidatePath: string | undefined,
  absolutePath: string,
) {
  try {
    await fs.stat(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') {
      throw error
    }

    const normalizedCandidatePath = candidatePath?.trim() || DEFAULT_WORKSPACE_RELATIVE_PATH
    const multiplePathHint = /\s/u.test(normalizedCandidatePath)
      ? ' The path field accepts one path only; if you meant multiple roots, use one call per root instead of joining them with spaces.'
      : ''
    throw new Error(`Path not found: ${normalizedCandidatePath}. Use a path relative to the workspace root.${multiplePathHint}`)
  }
}
