import type { CheckoutGitBranchInput, CreateGitBranchInput, GitBranchState } from '../../src/types/chat'
import {
  getErrorMessage,
  getPreferredRemoteName,
  getRemoteUrl,
  hasRemoteTrackingBranch,
  isGitUnavailable,
  isWorkingTreeConflictFailure,
  readAheadBehindCounts,
  readCurrentBranch,
  readDefaultBranch,
  readLocalBranches,
  readRemoteBranches,
  resolveRepositoryRoot,
  runGit,
  validateBranchName,
} from './repositoryContext'


function createEmptyBranchState(): GitBranchState {
  return {
    aheadCommitCount: 0,
    behindCommitCount: 0,
    branches: [],
    currentBranch: null,
    remoteBranches: [],
    defaultBranch: null,
    hasRepository: false,
    hasUpstream: false,
    isDetachedHead: false,
    remoteUrl: null,
    repoRootPath: null,
  }
}


export async function getGitBranchState(workspacePath: string): Promise<GitBranchState> {
  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    return createEmptyBranchState()
  }

  const [branchState, branches, remoteBranches, defaultBranch, remoteUrl, aheadBehindCounts] = await Promise.all([
    readCurrentBranch(repoRootPath),
    readLocalBranches(repoRootPath),
    readRemoteBranches(repoRootPath),
    readDefaultBranch(repoRootPath),
    getRemoteUrl(repoRootPath).catch(() => null),
    readAheadBehindCounts(repoRootPath),
  ])

  return {
    ...aheadBehindCounts,
    branches,
    currentBranch: branchState.currentBranch,
    defaultBranch,
    remoteBranches,
    hasRepository: true,
    isDetachedHead: branchState.isDetachedHead,
    remoteUrl: remoteUrl ?? null,
    repoRootPath,
  }
}


export async function checkoutGitBranch(input: CheckoutGitBranchInput): Promise<GitBranchState> {
  const workspacePath = input.workspacePath.trim()
  const branchName = input.branchName.trim()

  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  if (branchName.length === 0) {
    throw new Error('Branch name is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    throw new Error('No git repository was found for this workspace.')
  }

  try {
    const localBranches = await readLocalBranches(repoRootPath)
    if (localBranches.includes(branchName)) {
      await runGit(['checkout', '--quiet', branchName], repoRootPath)
    } else if (await hasRemoteTrackingBranch(repoRootPath, branchName)) {
      const remoteName = await getPreferredRemoteName(repoRootPath)
      if (!remoteName) {
        throw new Error(`No remote is configured for branch '${branchName}'.`)
      }
      await runGit(['checkout', '--quiet', '--track', '-b', branchName, `${remoteName}/${branchName}`], repoRootPath)
    } else {
      await runGit(['checkout', '--quiet', branchName], repoRootPath)
    }
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    if (isWorkingTreeConflictFailure(error)) {
      throw new Error(
        'Cannot switch branches because local changes would be overwritten. Commit, stash, or discard changes first.',
      )
    }

    throw new Error(getErrorMessage(error))
  }

  return getGitBranchState(repoRootPath)
}

export async function createAndCheckoutGitBranch(input: CreateGitBranchInput): Promise<GitBranchState> {
  const workspacePath = input.workspacePath.trim()
  const branchName = input.branchName.trim()

  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  if (branchName.length === 0) {
    throw new Error('Branch name is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    throw new Error('No git repository was found for this workspace.')
  }

  await validateBranchName(branchName, repoRootPath)

  try {
    await runGit(['checkout', '--quiet', '-b', branchName], repoRootPath)
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    throw new Error(getErrorMessage(error))
  }

  return getGitBranchState(repoRootPath)
}

