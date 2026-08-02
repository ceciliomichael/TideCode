import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { normalizeGitFilePath } from './serviceHelpers'

const execFileAsync = promisify(execFile)
const GIT_EXECUTION_OPTIONS = {
  encoding: 'utf8' as const,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
}
const GH_EXECUTION_OPTIONS = {
  encoding: 'utf8' as const,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
}

interface GitStdoutResult {
  stdout: string
  truncated: boolean
}

interface GitStdoutStreamOptions {
  charLimit?: number
}

export interface GitCommandError extends Error {
  code?: number | string
  stderr?: string
  stdout?: string
}

export function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Unknown git error.'
  }

  const commandError = error as GitCommandError
  return [commandError.stderr, commandError.message, commandError.stdout]
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?.trim() ?? 'Unknown git error.'
}

export function isGitUnavailable(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  const commandError = error as GitCommandError
  const message = getErrorMessage(commandError).toLowerCase()
  return commandError.code === 'ENOENT' || message.includes("'git' is not recognized") || message.includes('command not found')
}

function isRepositoryMissing(error: unknown) {
  return getErrorMessage(error).toLowerCase().includes('not a git repository')
}

export async function runGit(args: string[], cwd: string) {
  return execFileAsync('git', args, {
    ...GIT_EXECUTION_OPTIONS,
    cwd,
  })
}

export async function runGh(args: string[], cwd: string) {
  return execFileAsync('gh', args, {
    ...GH_EXECUTION_OPTIONS,
    cwd,
  })
}

export async function runGitBuffer(args: string[], cwd: string) {
  return execFileAsync('git', args, {
    ...GIT_EXECUTION_OPTIONS,
    cwd,
    encoding: 'buffer',
  })
}

function readGitStdout(args: string[], cwd: string, options: GitStdoutStreamOptions = {}) {
  const charLimit = options.charLimit ?? Number.POSITIVE_INFINITY

  return new Promise<GitStdoutResult>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let truncated = false

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      if (truncated) {
        return
      }

      if (stdout.length >= charLimit) {
        truncated = true
        child.kill()
        return
      }

      const remainingChars = charLimit - stdout.length
      if (chunk.length > remainingChars) {
        stdout += chunk.slice(0, remainingChars)
        truncated = true
        child.kill()
        return
      }

      stdout += chunk
    })

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.once('error', (error) => {
      reject(error)
    })

    child.once('close', (code, signal) => {
      if (truncated || code === 0 || signal === 'SIGTERM') {
        resolve({ stdout, truncated })
        return
      }

      const errorMessage = stderr.trim().length > 0 ? stderr.trim() : `git ${args[0] ?? 'command'} failed with exit code ${code ?? 'unknown'}`
      reject(new Error(errorMessage))
    })
  })
}

export async function validateBranchName(branchName: string, repoRootPath: string) {
  try {
    await runGit(['check-ref-format', '--branch', branchName], repoRootPath)
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export async function resolveRepositoryRoot(workspacePath: string) {
  const normalizedWorkspacePath = workspacePath.trim()
  if (normalizedWorkspacePath.length === 0) {
    return null
  }

  try {
    const { stdout } = await runGit(['rev-parse', '--show-toplevel'], normalizedWorkspacePath)
    const repoRootPath = stdout.trim()
    return repoRootPath.length > 0 ? repoRootPath : null
  } catch (error) {
    if (isRepositoryMissing(error) || isGitUnavailable(error)) {
      return null
    }

    throw error
  }
}

export async function readCurrentBranch(repoRootPath: string) {
  try {
    const { stdout } = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRootPath)
    const branchName = stdout.trim()
    return {
      currentBranch: branchName.length > 0 ? branchName : null,
      isDetachedHead: false,
    }
  } catch {
    // `symbolic-ref` fails when HEAD is detached. In "unborn" repos (no commits yet),
    // `rev-parse HEAD` can also fail, so treat that as "no current commit".
  }

  try {
    const { stdout } = await runGit(['rev-parse', '--short', 'HEAD'], repoRootPath)
    const detachedHeadSha = stdout.trim()
    return {
      currentBranch: detachedHeadSha.length > 0 ? `detached@${detachedHeadSha}` : null,
      isDetachedHead: true,
    }
  } catch {
    return {
      currentBranch: null,
      isDetachedHead: false,
    }
  }
}

export async function readLocalBranches(repoRootPath: string) {
  const { stdout } = await runGit(
    ['for-each-ref', '--format=%(refname:short)', '--sort=-committerdate', 'refs/heads'],
    repoRootPath,
  )

  return stdout
    .split(/\r?\n/)
    .map((branchName) => branchName.trim())
    .filter((branchName) => branchName.length > 0)
}

export async function readDefaultBranch(repoRootPath: string) {
  const remoteName = await getPreferredRemoteName(repoRootPath)
  if (!remoteName) {
    return null
  }

  try {
    const { stdout } = await runGit(
      ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remoteName}/HEAD`],
      repoRootPath,
    )
    const remoteHeadRef = stdout.trim()
    const prefix = `${remoteName}/`
    if (!remoteHeadRef.startsWith(prefix)) {
      return null
    }

    const defaultBranch = remoteHeadRef.slice(prefix.length).trim()
    return defaultBranch.length > 0 ? defaultBranch : null
  } catch {
    return null
  }
}

export async function getPreferredRemoteName(repoRootPath: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(['remote'], repoRootPath)
    const remoteNames = stdout
      .split(/\r?\n/u)
      .map((remoteName) => remoteName.trim())
      .filter((remoteName) => remoteName.length > 0)

    return remoteNames.find((remoteName) => remoteName === 'origin') ?? remoteNames[0] ?? null
  } catch {
    return null
  }
}

export async function hasAnyRemote(repoRootPath: string) {
  return (await getPreferredRemoteName(repoRootPath)) !== null
}

export async function fetchOrigin(repoRootPath: string) {
  const remoteName = await getPreferredRemoteName(repoRootPath)
  if (!remoteName) {
    return false
  }

  await runGit(['fetch', '--prune', remoteName], repoRootPath)
  return true
}

export async function hasRemoteTrackingBranch(repoRootPath: string, branchName: string) {
  const remoteName = await getPreferredRemoteName(repoRootPath)
  if (!remoteName) {
    return false
  }

  try {
    await runGit(['show-ref', '--verify', '--quiet', `refs/remotes/${remoteName}/${branchName}`], repoRootPath)
    return true
  } catch {
    return false
  }
}

export async function readCurrentUpstreamBranch(repoRootPath: string) {
  try {
    const { stdout } = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repoRootPath)
    const upstreamBranch = stdout.trim()
    return upstreamBranch.length > 0 ? upstreamBranch : null
  } catch {
    return null
  }
}

export async function readAheadBehindCounts(repoRootPath: string) {
  const upstreamBranch = await readCurrentUpstreamBranch(repoRootPath)
  if (!upstreamBranch) {
    return {
      aheadCommitCount: 0,
      behindCommitCount: 0,
      hasUpstream: false,
    }
  }

  try {
    const { stdout } = await runGit(
      ['rev-list', '--left-right', '--count', `HEAD...${upstreamBranch}`],
      repoRootPath,
    )
    const [aheadValue, behindValue] = stdout.trim().split(/\s+/)
    const aheadCommitCount = Number.parseInt(aheadValue ?? '', 10)
    const behindCommitCount = Number.parseInt(behindValue ?? '', 10)

    return {
      aheadCommitCount: Number.isFinite(aheadCommitCount) ? Math.max(0, aheadCommitCount) : 0,
      behindCommitCount: Number.isFinite(behindCommitCount) ? Math.max(0, behindCommitCount) : 0,
      hasUpstream: true,
    }
  } catch {
    return {
      aheadCommitCount: 0,
      behindCommitCount: 0,
      hasUpstream: true,
    }
  }
}

export function isFastForwardOnlyPullFailure(error: unknown) {
  const normalizedMessage = getErrorMessage(error).toLowerCase()
  return (
    normalizedMessage.includes('not possible to fast-forward') ||
    normalizedMessage.includes('cannot fast-forward') ||
    normalizedMessage.includes('divergent branches')
  )
}

export function isWorkingTreeConflictFailure(error: unknown) {
  const normalizedMessage = getErrorMessage(error).toLowerCase()
  return (
    normalizedMessage.includes('would be overwritten by checkout') ||
    normalizedMessage.includes('your local changes to the following files would be overwritten') ||
    normalizedMessage.includes('please commit your changes or stash them')
  )
}

export async function syncCheckedOutBranchWithRemote(repoRootPath: string, branchName: string) {
  const hasRemote = await fetchOrigin(repoRootPath)
  if (!hasRemote) {
    return
  }

  let upstreamBranch = await readCurrentUpstreamBranch(repoRootPath)
  if (!upstreamBranch && (await hasRemoteTrackingBranch(repoRootPath, branchName))) {
    const remoteName = await getPreferredRemoteName(repoRootPath)
    if (remoteName) {
      await runGit(['branch', '--set-upstream-to', `${remoteName}/${branchName}`, branchName], repoRootPath)
      upstreamBranch = `${remoteName}/${branchName}`
    }
  }

  if (!upstreamBranch) {
    return
  }

  await runGit(['pull', '--ff-only', '--no-rebase'], repoRootPath)
}

export async function readHeadCommitHash(repoRootPath: string) {
  try {
    const { stdout } = await runGit(['rev-parse', 'HEAD'], repoRootPath)
    const commitHash = stdout.trim()
    return commitHash.length > 0 ? commitHash : null
  } catch {
    return null
  }
}

function isBinaryContent(content: Buffer) {
  return content.includes(0)
}

export function normalizeForGitPathspec(filePath: string) {
  return normalizeGitFilePath(filePath).replace(/^\/+/, '')
}

export function isWithinRepository(repoRootPath: string, candidatePath: string) {
  const normalizedRepoRoot = path.resolve(repoRootPath)
  const normalizedCandidate = path.resolve(candidatePath)
  return normalizedCandidate === normalizedRepoRoot || normalizedCandidate.startsWith(`${normalizedRepoRoot}${path.sep}`)
}

export async function readWorkingTreeFile(repoRootPath: string, filePath: string) {
  const absoluteFilePath = path.resolve(repoRootPath, filePath)
  if (!isWithinRepository(repoRootPath, absoluteFilePath)) {
    return null
  }

  try {
    const fileContent = await fs.readFile(absoluteFilePath)
    if (isBinaryContent(fileContent)) {
      return null
    }

    return fileContent.toString('utf8')
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code
    if (errorCode === 'ENOENT') {
      return ''
    }
    if (errorCode === 'EISDIR' || errorCode === 'EPERM' || errorCode === 'EACCES') {
      return null
    }

    throw error
  }
}

export async function readHeadFile(repoRootPath: string, filePath: string) {
  try {
    const { stdout } = await runGitBuffer(['show', `HEAD:${normalizeGitFilePath(filePath)}`], repoRootPath)
    const fileContent = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
    if (isBinaryContent(fileContent)) {
      return null
    }

    return fileContent.toString('utf8')
  } catch {
    return null
  }
}

export async function resolveAndValidateGitFilePath(repoRootPath: string, rawFilePath: string) {
  const normalizedFilePath = normalizeForGitPathspec(rawFilePath.trim())
  if (normalizedFilePath.length === 0) {
    throw new Error('File path is required.')
  }

  const absoluteFilePath = path.resolve(repoRootPath, normalizedFilePath)
  if (!isWithinRepository(repoRootPath, absoluteFilePath)) {
    throw new Error('Invalid file path for this repository.')
  }

  return normalizedFilePath
}

export async function readSymbolicHeadBranchName(repoRootPath: string) {
  try {
    const { stdout } = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRootPath)
    const branchName = stdout.trim()
    return branchName.length > 0 ? branchName : null
  } catch {
    return null
  }
}

export async function getRemoteUrl(repoRootPath: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(['remote', 'get-url', 'origin'], repoRootPath)
    return stdout.trim() || null
  } catch {
    const remoteName = await getPreferredRemoteName(repoRootPath)
    if (!remoteName) {
      return null
    }

    try {
      const { stdout } = await runGit(['remote', 'get-url', remoteName], repoRootPath)
      return stdout.trim() || null
    } catch {
      return null
    }
  }
}

export function isGhUnavailable(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  const commandError = error as GitCommandError
  const message = getErrorMessage(commandError).toLowerCase()
  return commandError.code === 'ENOENT' || message.includes("'gh' is not recognized") || message.includes('command not found')
}

export function isGhAuthError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('authentication') ||
    message.includes('gh auth login') ||
    message.includes('not logged into') ||
    message.includes('not logged in') ||
    message.includes('no oauth token') ||
    message.includes('no accounts')
  )
}

export async function readStagedDiffText(repoRootPath: string) {
  const { stdout, truncated } = await readGitStdout(
    ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=3', '--', '.'],
    repoRootPath,
    {
      charLimit: 18_000,
    },
  )

  return truncated ? `${stdout}\n\n...[diff truncated for prompt size]` : stdout
}

export async function readStagedNumstatText(repoRootPath: string) {
  const { stdout } = await readGitStdout(['diff', '--cached', '--numstat', '--', '.'], repoRootPath)
  return stdout
}

