import type { GitSyncAction, GitSyncInput, GitSyncResult } from '../../src/types/chat'
import {
  getErrorMessage,
  getPreferredRemoteName,
  hasRemoteTrackingBranch,
  isFastForwardOnlyPullFailure,
  isGitUnavailable,
  isWorkingTreeConflictFailure,
  readCurrentUpstreamBranch,
  readSymbolicHeadBranchName,
  resolveRepositoryRoot,
  runGit,
} from './repositoryContext'

async function resolveCurrentUpstream(repoRootPath: string, branchName: string) {
  let upstreamBranch = await readCurrentUpstreamBranch(repoRootPath)
  if (!upstreamBranch && (await hasRemoteTrackingBranch(repoRootPath, branchName))) {
    const remoteName = await getPreferredRemoteName(repoRootPath)
    if (remoteName) {
      await runGit(['branch', '--set-upstream-to', `${remoteName}/${branchName}`, branchName], repoRootPath)
      upstreamBranch = `${remoteName}/${branchName}`
    }
  }

  return upstreamBranch
}

async function pullCurrentBranch(repoRootPath: string, branchName: string) {
  const upstreamBranch = await resolveCurrentUpstream(repoRootPath, branchName)
  if (!upstreamBranch) {
    throw new Error(
      `No upstream is configured for '${branchName}'. Push once or set an upstream before pulling.`,
    )
  }

  await runGit(['pull', '--ff-only', '--no-rebase'], repoRootPath)
}

async function pushCurrentBranch(repoRootPath: string, branchName: string) {
  const upstreamBranch = await readCurrentUpstreamBranch(repoRootPath)
  if (upstreamBranch) {
    await runGit(['push'], repoRootPath)
  } else {
    const remoteName = await getPreferredRemoteName(repoRootPath)
    if (!remoteName) {
      throw new Error('No remote is configured for this repository.')
    }

    await runGit(['push', '-u', remoteName, branchName], repoRootPath)
  }
}

export async function gitSync(input: GitSyncInput): Promise<GitSyncResult> {
  const workspacePath = input.workspacePath.trim()
  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    throw new Error('No git repository was found for this workspace.')
  }

  const action: GitSyncAction = input.action
  let branchName = await readSymbolicHeadBranchName(repoRootPath)
  let message = ''

  try {
    if (action === 'fetch-all') {
      await runGit(['fetch', '--all', '--prune'], repoRootPath)
      message = 'Fetched all remotes.'
    } else if (action === 'pull') {
      if (!branchName) {
        throw new Error('Cannot pull from detached HEAD. Checkout a branch first.')
      }

      await pullCurrentBranch(repoRootPath, branchName)
      message = `Pulled latest changes into '${branchName}'.`
    } else if (action === 'push') {
      if (!branchName) {
        throw new Error('Cannot push from detached HEAD. Checkout a branch first.')
      }

      await pushCurrentBranch(repoRootPath, branchName)
      message = `Pushed '${branchName}' to remote.`
    } else if (action === 'sync') {
      if (!branchName) {
        throw new Error('Cannot sync from detached HEAD. Checkout a branch first.')
      }

      const upstreamBranch = await resolveCurrentUpstream(repoRootPath, branchName)
      if (upstreamBranch) {
        await runGit(['pull', '--ff-only', '--no-rebase'], repoRootPath)
      }
      await pushCurrentBranch(repoRootPath, branchName)
      message = `Synchronized '${branchName}' with remote.`
    } else {
      throw new Error(`Unsupported sync action: ${String(action)}`)
    }
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    if ((action === 'pull' || action === 'sync') && isFastForwardOnlyPullFailure(error)) {
      throw new Error('Pull failed because the branch cannot be fast-forwarded. Rebase or merge first.')
    }

    if ((action === 'pull' || action === 'sync') && isWorkingTreeConflictFailure(error)) {
      throw new Error(
        'Pull failed because local changes would be overwritten. Commit, stash, or discard changes first.',
      )
    }

    throw new Error(`Failed to ${action}: ${getErrorMessage(error)}`)
  }

  branchName = await readSymbolicHeadBranchName(repoRootPath)
  return {
    action,
    branchName,
    message,
    success: true,
  }
}

