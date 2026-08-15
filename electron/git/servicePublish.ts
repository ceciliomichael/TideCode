import type {
  GitHubAuthStatus,
  GitHubDeviceLoginResult,
  GitInitResult,
  GitPublishInput,
  GitPublishResult,
} from '../../src/types/chat'
import { createGitHubRepository } from './githubApi'
import {
  completeGitHubDeviceLogin,
  connectGitHub,
  getGitHubAccessToken,
  getGitHubAuthStatus,
} from './githubAuthService'
import { normalizeGitPublishOptions } from './publishValidation'
import {
  getErrorMessage,
  hasAnyRemote,
  isGitUnavailable,
  readHeadCommitHash,
  readSymbolicHeadBranchName,
  resolveRepositoryRoot,
  runGit,
  validateBranchName,
} from './repositoryContext'
import { runGitWithAccessToken } from './gitCredentialRunner'

export { completeGitHubDeviceLogin, connectGitHub, getGitHubAuthStatus }

async function ensureInitialCommit(repoRootPath: string, defaultBranch: string) {
  await validateBranchName(defaultBranch, repoRootPath)

  const currentBranch = await readSymbolicHeadBranchName(repoRootPath)
  try {
    if (currentBranch && currentBranch !== defaultBranch) {
      await runGit(['branch', '--move', '--force', defaultBranch], repoRootPath)
    } else if (!currentBranch) {
      await runGit(['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`], repoRootPath)
    }
  } catch (error) {
    throw new Error(`Failed to set the default branch: ${getErrorMessage(error)}`)
  }

  try {
    await runGit(['add', '-A'], repoRootPath)
  } catch (error) {
    throw new Error(`Failed to stage files: ${getErrorMessage(error)}`)
  }

  if (await readHeadCommitHash(repoRootPath)) {
    return
  }

  try {
    const { stdout: statusOutput } = await runGit(['status', '--porcelain'], repoRootPath)
    const commitArgs = statusOutput.trim().length > 0
      ? ['commit', '-m', 'Initial commit']
      : ['commit', '--allow-empty', '-m', 'Initial commit']
    await runGit(commitArgs, repoRootPath)
  } catch (error) {
    const message = getErrorMessage(error)
    if (/user\.(?:email|name)|tell me who you are/iu.test(message)) {
      throw new Error(
        'Git user identity is not configured. Run `git config --global user.email "you@example.com"` and `git config --global user.name "Your Name"` in a terminal, then try again.',
      )
    }

    throw new Error(`Failed to create initial commit: ${message}`)
  }
}

async function initializeRepositoryIfNeeded(workspacePath: string) {
  let repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (repoRootPath) {
    return repoRootPath
  }

  try {
    await runGit(['init'], workspacePath)
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    throw new Error(`Failed to initialize repository: ${getErrorMessage(error)}`)
  }

  repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    throw new Error('Repository was initialized but could not be located.')
  }

  return repoRootPath
}

async function attachRemoteAndPush(input: {
  accessToken: string
  cloneUrl: string
  repoRootPath: string
}) {
  try {
    await runGit(['remote', 'add', 'origin', input.cloneUrl], input.repoRootPath)
  } catch (error) {
    throw new Error(`GitHub created the repository, but TideCode could not add the Git remote: ${getErrorMessage(error)}`)
  }

  const branchName = await readSymbolicHeadBranchName(input.repoRootPath)
  if (!branchName) {
    throw new Error('GitHub created the repository, but the local repository has no active branch to push.')
  }

  try {
    await runGitWithAccessToken(
      ['push', '--set-upstream', 'origin', branchName],
      input.repoRootPath,
      input.accessToken,
    )
  } catch (error) {
    throw new Error(`GitHub repository was created, but the initial push failed: ${getErrorMessage(error)}`)
  }
}

export interface GitPublishRemoteInput {
  workspacePath: string
  remoteUrl: string
  remoteName?: string
  defaultBranch?: string
}

export interface GitPublishRemoteResult {
  remoteName: string
  remoteUrl: string
  repoUrl?: string
  success: boolean
}

export async function publishToRemote(input: GitPublishRemoteInput): Promise<GitPublishRemoteResult> {
  const normalizedPath = input.workspacePath.trim()
  const remoteUrl = input.remoteUrl.trim()
  if (!remoteUrl) {
    throw new Error('Remote URL is required.')
  }
  const remoteName = input.remoteName?.trim() || 'origin'
  const defaultBranch = input.defaultBranch?.trim() || 'main'

  const repoRootPath = await initializeRepositoryIfNeeded(normalizedPath)
  await ensureInitialCommit(repoRootPath, defaultBranch)

  try {
    const { stdout: remotes } = await runGit(['remote'], repoRootPath)
    const existingRemotes = remotes.split(/\r?\n/).map((r) => r.trim()).filter(Boolean)
    if (existingRemotes.includes(remoteName)) {
      await runGit(['remote', 'set-url', remoteName, remoteUrl], repoRootPath)
    } else {
      await runGit(['remote', 'add', remoteName, remoteUrl], repoRootPath)
    }
  } catch (error) {
    throw new Error(`Failed to configure remote "${remoteName}": ${getErrorMessage(error)}`)
  }

  const branchName = (await readSymbolicHeadBranchName(repoRootPath)) || defaultBranch
  try {
    await runGit(['push', '--set-upstream', remoteName, branchName], repoRootPath)
  } catch (error) {
    throw new Error(`Remote "${remoteName}" was added (${remoteUrl}), but initial push failed: ${getErrorMessage(error)}`)
  }

  let repoUrl: string | undefined = undefined
  if (remoteUrl.startsWith('https://') || remoteUrl.startsWith('http://')) {
    repoUrl = remoteUrl.replace(/\.git$/iu, '')
  } else if (remoteUrl.startsWith('git@')) {
    const match = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/u)
    if (match) {
      repoUrl = `https://${match[1]}/${match[2]}`
    }
  }

  return {
    remoteName,
    remoteUrl,
    repoUrl,
    success: true,
  }
}

export async function publishToGitHub(input: GitPublishInput): Promise<GitPublishResult> {
  const options = normalizeGitPublishOptions(input)
  const repoRootPath = await initializeRepositoryIfNeeded(options.workspacePath)

  if (await hasAnyRemote(repoRootPath)) {
    throw new Error('This repository already has a remote. Use Push or Sync Changes instead.')
  }

  const accessToken = await getGitHubAccessToken()
  await ensureInitialCommit(repoRootPath, options.defaultBranch)

  const repository = await createGitHubRepository({
    accessToken,
    description: options.description,
    isPrivate: options.isPrivate,
    repoName: options.repoName,
  })

  await attachRemoteAndPush({
    accessToken,
    cloneUrl: repository.cloneUrl,
    repoRootPath,
  })

  return {
    remoteUrl: repository.cloneUrl,
    repoUrl: repository.repoUrl,
    success: true,
  }
}

export type { GitHubAuthStatus, GitHubDeviceLoginResult, GitInitResult }
