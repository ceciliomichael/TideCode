import path from 'node:path'
import type { AppTerminalExecutionMode } from '../../../../src/types/chat'
import {
  DEFAULT_WORKSPACE_RELATIVE_PATH,
  getSafeWorkspaceTargetPath,
} from '../../../workspace/paths'
import type { AgentToolContext } from '../toolTypes'
import {
  assertSandboxPathDoesNotEscapeThroughSymlink,
  getSandboxPathRoots,
  isPathInsideRoot,
  resolveSandboxPath,
} from './sandboxPaths'

export type WorkspaceToolContext = Pick<AgentToolContext, 'checkpointId' | 'terminalExecutionMode' | 'workspaceRootPath'>

export function resolveWorkspaceTargetPath(workspaceRootPath: string, candidatePath: string | undefined) {
  if (!candidatePath || candidatePath.trim().length === 0) {
    return {
      absolutePath: workspaceRootPath,
      relativePath: DEFAULT_WORKSPACE_RELATIVE_PATH,
    }
  }

  if (path.isAbsolute(candidatePath)) {
    return getSafeWorkspaceTargetPath(workspaceRootPath, path.relative(workspaceRootPath, candidatePath))
  }

  return getSafeWorkspaceTargetPath(workspaceRootPath, candidatePath)
}

export function resolveReadableTargetPath(
  workspaceRootPath: string,
  candidatePath: string | undefined,
  terminalExecutionMode: AppTerminalExecutionMode = 'sandbox',
  options: { allowGlobalAgentsDirectory?: boolean } = {},
) {
  if (terminalExecutionMode === 'sandbox') {
    if (options.allowGlobalAgentsDirectory) {
      const target = resolveSandboxPath(workspaceRootPath, candidatePath)
      return {
        absolutePath: target.absolutePath,
        displayPath: target.displayPath,
      }
    }

    const target = resolveWorkspaceTargetPath(workspaceRootPath, candidatePath)
    return {
      absolutePath: target.absolutePath,
      displayPath: target.relativePath,
    }
  }

  if (!candidatePath || candidatePath.trim().length === 0) {
    return {
      absolutePath: workspaceRootPath,
      displayPath: DEFAULT_WORKSPACE_RELATIVE_PATH,
    }
  }

  const absolutePath = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(workspaceRootPath, candidatePath)
  const relativePath = path.relative(workspaceRootPath, absolutePath)

  return {
    absolutePath,
    displayPath: isPathInsideRoot(workspaceRootPath, absolutePath)
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
      getSandboxPathRoots(workspaceRootPath),
    )
  }

  return target
}
