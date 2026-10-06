import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppTerminalExecutionMode } from '../../../../src/types/chat'
import type { SkillSummary } from '../../../../src/types/skills'
import { getConversationAttachmentsPath } from '../../../history/paths'
import {
  DEFAULT_WORKSPACE_RELATIVE_PATH,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from '../../../workspace/paths'
import type { AgentToolContext } from '../toolTypes'
import { getToolOutputDirectory, TOOL_OUTPUT_ALIAS_ROOT } from './toolOutputStore'
import {
  assertSandboxPathDoesNotEscapeThroughSymlink,
  getSandboxPathRoots,
  isPathInsideRoot,
  resolveSandboxPath,
} from './sandboxPaths'

export interface WorkspaceToolContext extends Pick<AgentToolContext, 'checkpointId' | 'conversationId' | 'terminalExecutionMode' | 'workspaceRootPath'> {
  enabledSkills: readonly SkillSummary[]
}

export const WORKSPACE_PATH_DESCRIPTION =
  'Accepts exactly one path. Relative paths resolve from the workspace. @workspace/... explicitly addresses the workspace, @attachments/... addresses current-chat attachments, @skills/<skill-name>/... addresses an enabled skill, and @tool-output/... addresses temporary read-only saved tool output. Full absolute paths remain supported according to Sandbox/Full Access policy. Read, list, glob, and grep targets must already exist. To inspect multiple roots, make separate calls; never join paths with spaces.'

export const ROOT_CAPABLE_WORKSPACE_PATH_DESCRIPTION =
  `${WORKSPACE_PATH_DESCRIPTION} An empty string or "." refers to the bound workspace root.`

export const OPTIONAL_ROOT_CAPABLE_WORKSPACE_PATH_DESCRIPTION =
  `${WORKSPACE_PATH_DESCRIPTION} An omitted path, empty string, or "." refers to the bound workspace root.`

export class WorkspaceTargetNotFoundError extends Error {
  constructor(
    public readonly requestedPath: string,
    public readonly absolutePath: string,
    multiplePathHint = '',
  ) {
    super(`Path not found: ${requestedPath}. Use a path relative to the workspace root. Do not guess a replacement filename; discover the actual path with list, glob, or grep from a known directory.${multiplePathHint}`)
    this.name = 'WorkspaceTargetNotFoundError'
  }
}

export function resolveWorkspaceAliasRelativePath(
  workspaceRootPath: string,
  aliasPath: string,
) {
  const normalizedAliasPath = aliasPath.trim().replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (normalizedAliasPath === '@workspace') {
    return ''
  }
  if (!normalizedAliasPath.startsWith('@workspace/')) {
    return null
  }

  const remainder = normalizedAliasPath.slice('@workspace/'.length)
  const segments = remainder.split('/').filter(Boolean)
  const workspaceName = path.basename(normalizeWorkspacePath(workspaceRootPath))
  const firstSegment = segments[0] ?? ''
  const matchesWorkspaceName = process.platform === 'win32'
    ? firstSegment.toLowerCase() === workspaceName.toLowerCase()
    : firstSegment === workspaceName
  return (matchesWorkspaceName ? segments.slice(1) : segments).join('/')
}

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

  const trimmedCandidatePath = candidatePath.trim()
  const normalizedAliasPath = trimmedCandidatePath.replace(/\\/gu, '/')
  if (normalizedAliasPath === '@workspace' || normalizedAliasPath.startsWith('@workspace/')) {
    const workspaceRelativePath =
      resolveWorkspaceAliasRelativePath(normalizedWorkspaceRootPath, normalizedAliasPath) ||
      DEFAULT_WORKSPACE_RELATIVE_PATH
    return getSafeWorkspaceTargetPath(normalizedWorkspaceRootPath, workspaceRelativePath)
  }
  if (
    normalizedAliasPath === '@attachments' ||
    normalizedAliasPath.startsWith('@attachments/') ||
    normalizedAliasPath === '@skills' ||
    normalizedAliasPath.startsWith('@skills/') ||
    normalizedAliasPath === TOOL_OUTPUT_ALIAS_ROOT ||
    normalizedAliasPath.startsWith(`${TOOL_OUTPUT_ALIAS_ROOT}/`)
  ) {
    throw new Error('The @attachments, @skills, and @tool-output virtual roots are read-only. Copy content into @workspace/ before modifying it.')
  }

  if (path.isAbsolute(trimmedCandidatePath)) {
    assertWorkspaceRootIsNotRepeated(normalizedWorkspaceRootPath, trimmedCandidatePath)
  }

  return getSafeWorkspaceTargetPath(normalizedWorkspaceRootPath, candidatePath)
}

export function resolveMutableTargetPath(
  workspaceRootPath: string,
  candidatePath: string | undefined,
  terminalExecutionMode: AppTerminalExecutionMode = 'sandbox',
) {
  const normalizedWorkspaceRootPath = normalizeWorkspacePath(workspaceRootPath)
  const normalizedCandidatePath = candidatePath?.trim() ?? ''
  const normalizedAliasPath = normalizedCandidatePath.replace(/\\/gu, '/')
  if (
    normalizedAliasPath === '@attachments' ||
    normalizedAliasPath.startsWith('@attachments/') ||
    normalizedAliasPath === '@skills' ||
    normalizedAliasPath.startsWith('@skills/') ||
    normalizedAliasPath === TOOL_OUTPUT_ALIAS_ROOT ||
    normalizedAliasPath.startsWith(`${TOOL_OUTPUT_ALIAS_ROOT}/`)
  ) {
    throw new Error('The @attachments, @skills, and @tool-output virtual roots are read-only. Copy content into @workspace/ before modifying it.')
  }
  if (normalizedAliasPath === '@workspace' || normalizedAliasPath.startsWith('@workspace/')) {
    const relativePath =
      resolveWorkspaceAliasRelativePath(normalizedWorkspaceRootPath, normalizedAliasPath) ?? ''
    const target = getSafeWorkspaceTargetPath(normalizedWorkspaceRootPath, relativePath)
    return {
      absolutePath: target.absolutePath,
      displayPath: normalizedAliasPath === '@workspace' ? '@workspace/' : normalizedAliasPath,
      sandboxRootPath: normalizedWorkspaceRootPath,
    }
  }
  return resolveReadableTargetPath(
    normalizedWorkspaceRootPath,
    candidatePath,
    terminalExecutionMode,
  )
}

function resolveVirtualReadPath(
  workspaceRootPath: string,
  candidatePath: string,
  options: {
    conversationId?: string | null
    enabledSkills?: readonly SkillSummary[]
  },
) {
  const normalizedAliasPath = candidatePath.replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (normalizedAliasPath === '@workspace' || normalizedAliasPath.startsWith('@workspace/')) {
    const relativePath =
      resolveWorkspaceAliasRelativePath(workspaceRootPath, normalizedAliasPath) ?? ''
    const absolutePath = path.resolve(workspaceRootPath, relativePath)
    if (!isPathInsideRoot(workspaceRootPath, absolutePath)) {
      throw new Error(`Virtual workspace path escapes @workspace/: ${candidatePath}`)
    }
    return {
      absolutePath,
      displayPath: normalizedAliasPath === '@workspace' ? '@workspace/' : normalizedAliasPath,
      sandboxRootPath: workspaceRootPath,
    }
  }

  if (normalizedAliasPath === '@attachments' || normalizedAliasPath.startsWith('@attachments/')) {
    const conversationId = options.conversationId?.trim() ?? ''
    if (!conversationId) {
      throw new Error('@attachments/ is unavailable until the chat has a conversation id.')
    }
    const rootPath = getConversationAttachmentsPath(conversationId)
    const relativePath = normalizedAliasPath === '@attachments'
      ? ''
      : normalizedAliasPath.slice('@attachments/'.length)
    const absolutePath = path.resolve(rootPath, relativePath)
    if (!isPathInsideRoot(rootPath, absolutePath)) {
      throw new Error(`Virtual attachment path escapes @attachments/: ${candidatePath}`)
    }
    return {
      absolutePath,
      displayPath: relativePath.length > 0 ? `@attachments/${relativePath.replace(/\\/gu, '/')}` : '@attachments/',
      sandboxRootPath: rootPath,
    }
  }

  if (normalizedAliasPath === '@skills') {
    throw new Error('Use the skill tool to list enabled skills, then address one as @skills/<skill-name>/.')
  }
  if (normalizedAliasPath.startsWith('@skills/')) {
    const remainder = normalizedAliasPath.slice('@skills/'.length)
    const [skillName, ...relativeSegments] = remainder.split('/').filter(Boolean)
    const skill = options.enabledSkills?.find(
      (candidate) => candidate.name.trim().toLowerCase() === skillName?.trim().toLowerCase(),
    )
    if (!skill) {
      throw new Error(`Unknown enabled skill in virtual path: ${skillName || '(missing name)'}`)
    }
    const relativePath = relativeSegments.join('/')
    const rootPath = path.resolve(skill.baseDirectory)
    const absolutePath = path.resolve(rootPath, relativePath)
    if (!isPathInsideRoot(rootPath, absolutePath)) {
      throw new Error(`Virtual skill path escapes @skills/${skill.name}/: ${candidatePath}`)
    }
    return {
      absolutePath,
      displayPath: relativePath.length > 0
        ? `@skills/${skill.name}/${relativePath.replace(/\\/gu, '/')}`
        : `@skills/${skill.name}/`,
      sandboxRootPath: rootPath,
    }
  }

  if (normalizedAliasPath === TOOL_OUTPUT_ALIAS_ROOT || normalizedAliasPath.startsWith(`${TOOL_OUTPUT_ALIAS_ROOT}/`)) {
    const rootPath = getToolOutputDirectory()
    const relativePath = normalizedAliasPath === TOOL_OUTPUT_ALIAS_ROOT
      ? ''
      : normalizedAliasPath.slice(`${TOOL_OUTPUT_ALIAS_ROOT}/`.length)
    const absolutePath = path.resolve(rootPath, relativePath)
    if (!isPathInsideRoot(rootPath, absolutePath)) {
      throw new Error(`Virtual tool output path escapes ${TOOL_OUTPUT_ALIAS_ROOT}/: ${candidatePath}`)
    }
    return {
      absolutePath,
      displayPath: relativePath.length > 0
        ? `${TOOL_OUTPUT_ALIAS_ROOT}/${relativePath.replace(/\\/gu, '/')}`
        : `${TOOL_OUTPUT_ALIAS_ROOT}/`,
      sandboxRootPath: rootPath,
    }
  }

  return null
}

export function resolveReadableTargetPath(
  workspaceRootPath: string,
  candidatePath: string | undefined,
  terminalExecutionMode: AppTerminalExecutionMode = 'sandbox',
  options: {
    allowGlobalAgentsDirectory?: boolean
    conversationId?: string | null
    enabledSkills?: readonly SkillSummary[]
  } = {},
) {
  const normalizedWorkspaceRootPath = normalizeWorkspacePath(workspaceRootPath)
  const normalizedCandidatePath = candidatePath?.trim()
  const virtualTarget = normalizedCandidatePath
    ? resolveVirtualReadPath(normalizedWorkspaceRootPath, normalizedCandidatePath, options)
    : null
  if (virtualTarget) {
    return virtualTarget
  }
  if (normalizedCandidatePath && path.isAbsolute(normalizedCandidatePath)) {
    assertWorkspaceRootIsNotRepeated(normalizedWorkspaceRootPath, normalizedCandidatePath)
  }

  if (terminalExecutionMode === 'sandbox') {
    if (options.allowGlobalAgentsDirectory) {
      const target = resolveSandboxPath(normalizedWorkspaceRootPath, candidatePath)
      return {
        absolutePath: target.absolutePath,
        displayPath: target.displayPath,
        sandboxRootPath: isPathInsideRoot(normalizedWorkspaceRootPath, target.absolutePath)
          ? normalizedWorkspaceRootPath
          : target.absolutePath,
      }
    }

    const target = resolveWorkspaceTargetPath(normalizedWorkspaceRootPath, candidatePath)
    return {
      absolutePath: target.absolutePath,
      displayPath: target.relativePath,
      sandboxRootPath: normalizedWorkspaceRootPath,
    }
  }

  if (!candidatePath || candidatePath.trim().length === 0) {
    return {
      absolutePath: normalizedWorkspaceRootPath,
      displayPath: DEFAULT_WORKSPACE_RELATIVE_PATH,
      sandboxRootPath: normalizedWorkspaceRootPath,
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
    sandboxRootPath: isPathInsideRoot(normalizedWorkspaceRootPath, absolutePath)
      ? normalizedWorkspaceRootPath
      : absolutePath,
  }
}

export async function resolveReadOnlyTargetPath(
  workspaceRootPath: string,
  candidatePath: string | undefined,
  terminalExecutionMode: AppTerminalExecutionMode = 'sandbox',
  options: {
    conversationId?: string | null
    enabledSkills?: readonly SkillSummary[]
  } = {},
) {
  const target = resolveReadableTargetPath(
    workspaceRootPath,
    candidatePath,
    terminalExecutionMode,
    {
      allowGlobalAgentsDirectory: true,
      conversationId: options.conversationId,
      enabledSkills: options.enabledSkills,
    },
  )

  if (terminalExecutionMode === 'sandbox') {
    const normalizedWorkspaceRootPath = normalizeWorkspacePath(workspaceRootPath)
    if (target.sandboxRootPath === normalizedWorkspaceRootPath) {
      await assertSandboxPathDoesNotEscapeThroughSymlink(
        target.absolutePath,
        getSandboxPathRoots(normalizedWorkspaceRootPath),
      )
    } else {
      const realRoot = await fs.realpath(target.sandboxRootPath).catch(() => target.sandboxRootPath)
      const realTarget = await fs.realpath(target.absolutePath).catch(() => target.absolutePath)
      if (!isPathInsideRoot(realRoot, realTarget)) {
        throw new Error(`Path escapes its read-only virtual root through a symbolic link: ${candidatePath ?? ''}.`)
      }
    }
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
    throw new WorkspaceTargetNotFoundError(normalizedCandidatePath, absolutePath, multiplePathHint)
  }
}
