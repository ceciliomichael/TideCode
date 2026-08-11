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

export type WorkspaceToolContext = Pick<AgentToolContext, 'checkpointId' | 'terminalExecutionMode' | 'workspaceRootPath'>

export const WORKSPACE_PATH_DESCRIPTION =
  'Path relative to the workspace root, or the exact absolute path inside the workspace root.'

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

  throw new Error(
    [
      `Path repeats the workspace root name: ${normalizedCandidatePath}.`,
      `Workspace root is ${workspaceRootPath}.`,
      'Use the path relative to the root instead, or use the exact absolute root without appending its folder name.',
    ].join(' '),
  )
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

  await assertWorkspaceTargetExists(workspaceRootPath, candidatePath, target.absolutePath)

  return target
}

async function assertWorkspaceTargetExists(
  workspaceRootPath: string,
  candidatePath: string | undefined,
  absolutePath: string,
) {
  try {
    await fs.stat(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') {
      throw error
    }

    const normalizedWorkspaceRootPath = normalizeWorkspacePath(workspaceRootPath)
    const normalizedCandidatePath = candidatePath?.trim() || DEFAULT_WORKSPACE_RELATIVE_PATH
    throw new Error(
      [
        `Path does not exist: ${absolutePath}.`,
        `Workspace root is ${normalizedWorkspaceRootPath}.`,
        `Received path: ${normalizedCandidatePath}.`,
        'Use "." for the workspace root or a path relative to that root; do not append the workspace folder name to an absolute root path.',
      ].join(' '),
    )
  }
}
