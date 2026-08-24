import type { GitCommitInput, GitCommitResult, GitHistoryEntry } from '../../src/types/chat'
import type { GitModelSelection } from './modelTextGeneration'
import { generatePullRequestDetails } from './pullRequestMessageGenerator'
import { generateStagedCommitMessage } from './stagedCommitMessage'
import {
  fetchOrigin,
  getErrorMessage,
  getPreferredRemoteName,
  getRemoteUrl,
  hasRemoteTrackingBranch,
  isGhAuthError,
  isGhUnavailable,
  isGitUnavailable,
  pushCheckedOutBranch,
  readCurrentBranch,
  readDefaultBranch,
  readHeadCommitHash,
  readLocalBranches,
  readPullRequestCommitLogText,
  readPullRequestDiffText,
  readPullRequestNumstatText,
  readStagedNumstatText,
  readSymbolicHeadBranchName,
  resolveRepositoryRoot,
  runGh,
  runGit,
  syncCheckedOutBranchWithRemote,
  validateBranchName,
} from './repositoryContext'
import {
  AUTONOMOUS_BRANCH_MAX_LENGTH,
  buildAutonomousBranchBaseName,
  extractGitHubPullRequestUrl,
  getCommitMessageBody,
  getCommitMessageSubject,
  isDefaultBranchName,
  parseGitHubRepositoryRef,
  remoteUrlToHttpsBase,
  parseGitHistoryLine,
  trimInvalidBranchTail,
  type GitHubRepositoryRef,
} from './serviceHelpers'

const HISTORY_LOG_FORMAT = '%x1f%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%ar%x1f%s%x1f%D'

function resolveCommitModelSelection(input: GitCommitInput): GitModelSelection | null {
  const modelId = input.modelId?.trim() ?? ''
  if (!input.providerId || modelId.length === 0) {
    return null
  }

  return {
    modelId,
    providerId: input.providerId,
    reasoningEffort: input.reasoningEffort ?? 'medium',
  }
}

async function readLatestHistoryEntry(repoRootPath: string): Promise<GitHistoryEntry | null> {
  const headHash = await readHeadCommitHash(repoRootPath)
  if (!headHash) {
    return null
  }

  try {
    const { stdout } = await runGit(
      [
        'log',
        '--graph',
        '--decorate=short',
        '--date=iso-strict',
        '--pretty=format:' + HISTORY_LOG_FORMAT,
        '--all',
        '--no-color',
        '-n1',
      ],
      repoRootPath,
    )

    return parseGitHistoryLine(stdout.trim(), headHash)
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    throw new Error(`Failed to load latest git history entry: ${getErrorMessage(error)}`)
  }
}

async function createOrGetGitHubPullRequest(input: {
  baseBranchName: string
  commitMessage: string
  currentBranchName: string
  remoteName: string
  repoRootPath: string
  repositoryRef: GitHubRepositoryRef
  selection: GitModelSelection | null
}) {
  const repositorySlug = `${input.repositoryRef.owner}/${input.repositoryRef.repo}`
  try {
    const { stdout: existingPrStdout } = await runGh(
      [
        'pr',
        'list',
        '--state',
        'open',
        '--head',
        input.currentBranchName,
        '--base',
        input.baseBranchName,
        '--json',
        'url',
        '--limit',
        '1',
        '--repo',
        repositorySlug,
      ],
      input.repoRootPath,
    )

    const parsedExistingPr = JSON.parse(existingPrStdout) as Array<{ url?: string }>
    const existingUrl = parsedExistingPr[0]?.url?.trim()
    if (existingUrl && existingUrl.length > 0) {
      return existingUrl
    }
  } catch (error) {
    if (isGhUnavailable(error)) {
      throw new Error('GitHub CLI (`gh`) is required to auto-create PRs. Install `gh` and authenticate with `gh auth login`.')
    }

    if (isGhAuthError(error)) {
      throw new Error('GitHub CLI is not authenticated. Run `gh auth login` to enable automatic PR creation.')
    }

    throw new Error(`Failed to check existing pull requests: ${getErrorMessage(error)}`)
  }

  let pullRequestTitle = getCommitMessageSubject(input.commitMessage)
  let pullRequestBody = getCommitMessageBody(input.commitMessage)
  try {
    const baseRef = `${input.remoteName}/${input.baseBranchName}`
    const [diffText, numstatText, commitLogText] = await Promise.all([
      readPullRequestDiffText(input.repoRootPath, baseRef, input.currentBranchName),
      readPullRequestNumstatText(input.repoRootPath, baseRef, input.currentBranchName),
      readPullRequestCommitLogText(input.repoRootPath, baseRef, input.currentBranchName),
    ])
    const generatedDetails = await generatePullRequestDetails({
      commitLogText,
      diffText,
      fallbackCommitMessage: input.commitMessage,
      numstatText,
      selection: input.selection,
    })
    pullRequestTitle = generatedDetails.title
    pullRequestBody = generatedDetails.body
  } catch {
    // Keep the commit-derived title and body when branch context cannot be read.
  }

  try {
    const { stdout: createPrStdout } = await runGh(
      [
        'pr',
        'create',
        '--base',
        input.baseBranchName,
        '--head',
        input.currentBranchName,
        '--title',
        pullRequestTitle,
        '--body',
        pullRequestBody,
        '--repo',
        repositorySlug,
      ],
      input.repoRootPath,
    )

    const createdPrUrl = extractGitHubPullRequestUrl(createPrStdout)
    if (createdPrUrl) {
      return createdPrUrl
    }
  } catch (error) {
    if (isGhUnavailable(error)) {
      throw new Error('GitHub CLI (`gh`) is required to auto-create PRs. Install `gh` and authenticate with `gh auth login`.')
    }

    if (isGhAuthError(error)) {
      throw new Error('GitHub CLI is not authenticated. Run `gh auth login` to enable automatic PR creation.')
    }

    throw new Error(`Failed to create pull request: ${getErrorMessage(error)}`)
  }

  try {
    const { stdout: fallbackListStdout } = await runGh(
      [
        'pr',
        'list',
        '--state',
        'open',
        '--head',
        input.currentBranchName,
        '--base',
        input.baseBranchName,
        '--json',
        'url',
        '--limit',
        '1',
        '--repo',
        repositorySlug,
      ],
      input.repoRootPath,
    )
    const parsedFallback = JSON.parse(fallbackListStdout) as Array<{ url?: string }>
    const fallbackUrl = parsedFallback[0]?.url?.trim()
    if (fallbackUrl && fallbackUrl.length > 0) {
      return fallbackUrl
    }
  } catch {
    // best effort fallback
  }

  return null
}

async function doesLocalBranchExist(repoRootPath: string, branchName: string) {
  try {
    await runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], repoRootPath)
    return true
  } catch {
    return false
  }
}

async function checkoutOrCreateBranch(repoRootPath: string, branchName: string) {
  await validateBranchName(branchName, repoRootPath)

  if (await doesLocalBranchExist(repoRootPath, branchName)) {
    await runGit(['checkout', '--quiet', branchName], repoRootPath)
    await syncCheckedOutBranchWithRemote(repoRootPath, branchName)
    return branchName
  }

  await runGit(['checkout', '--quiet', '-b', branchName], repoRootPath)
  return branchName
}

async function resolveDefaultBranchName(repoRootPath: string) {
  const remoteDefaultBranch = await readDefaultBranch(repoRootPath)
  if (remoteDefaultBranch) {
    return remoteDefaultBranch
  }

  const localBranches = await readLocalBranches(repoRootPath).catch((): string[] => [])
  if (localBranches.includes('main')) {
    return 'main'
  }

  if (localBranches.includes('master')) {
    return 'master'
  }

  return null
}

async function checkPotentialConflictsWithDefaultBranch(
  repoRootPath: string,
  currentBranch: string,
  defaultRemoteRef: string,
) {
  try {
    const { stdout: mergeBaseStdout } = await runGit(
      ['merge-base', currentBranch, defaultRemoteRef],
      repoRootPath,
    )
    const mergeBaseSha = mergeBaseStdout.trim()
    if (mergeBaseSha.length === 0) {
      return false
    }

    const { stdout: mergeTreeStdout } = await runGit(
      ['merge-tree', mergeBaseSha, currentBranch, defaultRemoteRef],
      repoRootPath,
    )

    return mergeTreeStdout.includes('<<<<<<<')
  } catch {
    // `merge-tree` availability and output can vary by git version; treat as non-blocking when unavailable.
    return false
  }
}

async function ensureBranchReadyForPullRequest(
  repoRootPath: string,
  currentBranch: string,
  defaultBranch: string | null,
) {
  if (!defaultBranch || isDefaultBranchName(currentBranch, defaultBranch)) {
    return
  }

  const hasRemote = await fetchOrigin(repoRootPath)
  const remoteName = await getPreferredRemoteName(repoRootPath)
  if (!hasRemote || !remoteName || !(await hasRemoteTrackingBranch(repoRootPath, defaultBranch))) {
    return
  }

  const defaultRemoteRef = `${remoteName}/${defaultBranch}`

  try {
    await runGit(['merge-base', '--is-ancestor', defaultRemoteRef, currentBranch], repoRootPath)
  } catch {
    const hasPotentialConflicts = await checkPotentialConflictsWithDefaultBranch(
      repoRootPath,
      currentBranch,
      defaultRemoteRef,
    )

    if (hasPotentialConflicts) {
      throw new Error(
        `Branch '${currentBranch}' likely conflicts with '${defaultBranch}'. Rebase or merge '${defaultBranch}' into '${currentBranch}' before creating a PR.`,
      )
    }

    throw new Error(
      `Branch '${currentBranch}' is not up to date with '${defaultBranch}'. Rebase or merge '${defaultBranch}' before creating a PR.`,
    )
  }
}

async function reserveUniqueLocalBranchName(repoRootPath: string, baseBranchName: string) {
  const normalizedBaseName = trimInvalidBranchTail(baseBranchName.trim())
  if (normalizedBaseName.length === 0) {
    throw new Error('Failed to derive an automatic branch name.')
  }

  await validateBranchName(normalizedBaseName, repoRootPath)
  if (!(await doesLocalBranchExist(repoRootPath, normalizedBaseName))) {
    return normalizedBaseName
  }

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const suffixText = `-${suffix}`
    const baseBudget = AUTONOMOUS_BRANCH_MAX_LENGTH - suffixText.length
    const truncatedBase = trimInvalidBranchTail(normalizedBaseName.slice(0, Math.max(1, baseBudget)))
    const candidate = trimInvalidBranchTail(`${truncatedBase}${suffixText}`)
    if (candidate.length === 0) {
      continue
    }

    try {
      await validateBranchName(candidate, repoRootPath)
      if (!(await doesLocalBranchExist(repoRootPath, candidate))) {
        return candidate
      }
    } catch {
      continue
    }
  }

  throw new Error('Failed to allocate a unique automatic branch name for this commit.')
}

async function createAutonomousFeatureBranch(
  repoRootPath: string,
  effectiveCommitMessage: string,
  stagedNumstatText: string,
) {
  const baseBranchName = buildAutonomousBranchBaseName(effectiveCommitMessage, stagedNumstatText)
  const uniqueBranchName = await reserveUniqueLocalBranchName(repoRootPath, baseBranchName)
  return checkoutOrCreateBranch(repoRootPath, uniqueBranchName)
}

interface PostPullRequestCleanupResult {
  defaultBranchName: string | null
  postCommitWarning: string | null
  pulledLatestOnDefaultBranch: boolean
  switchedToDefaultBranch: boolean
}

async function runPostPullRequestCleanup(
  repoRootPath: string,
  pullRequestBranchName: string,
): Promise<PostPullRequestCleanupResult> {
  const defaultBranchName = await resolveDefaultBranchName(repoRootPath)
  if (!defaultBranchName) {
    return {
      defaultBranchName: null,
      postCommitWarning: 'Pull request was created, but no default branch could be resolved for post-PR cleanup.',
      pulledLatestOnDefaultBranch: false,
      switchedToDefaultBranch: false,
    }
  }

  if (isDefaultBranchName(pullRequestBranchName, defaultBranchName)) {
    return {
      defaultBranchName,
      postCommitWarning: null,
      pulledLatestOnDefaultBranch: false,
      switchedToDefaultBranch: false,
    }
  }

  try {
    await runGit(['checkout', '--quiet', defaultBranchName], repoRootPath)
  } catch (error) {
    return {
      defaultBranchName,
      postCommitWarning: `Pull request was created, but failed to switch back to '${defaultBranchName}': ${getErrorMessage(error)}`,
      pulledLatestOnDefaultBranch: false,
      switchedToDefaultBranch: false,
    }
  }

  try {
    await syncCheckedOutBranchWithRemote(repoRootPath, defaultBranchName)
    return {
      defaultBranchName,
      postCommitWarning: null,
      pulledLatestOnDefaultBranch: true,
      switchedToDefaultBranch: true,
    }
  } catch (error) {
    return {
      defaultBranchName,
      postCommitWarning: `Switched back to '${defaultBranchName}', but failed to pull the latest changes: ${getErrorMessage(error)}`,
      pulledLatestOnDefaultBranch: false,
      switchedToDefaultBranch: true,
    }
  }
}

export async function gitCommit(input: GitCommitInput): Promise<GitCommitResult> {
  const workspacePath = input.workspacePath.trim()
  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    throw new Error('No git repository was found for this workspace.')
  }

  const currentStagedNumstat = await readStagedNumstatText(repoRootPath)
  if (currentStagedNumstat.trim().length === 0) {
    try {
      await runGit(['add', '-A'], repoRootPath)
    } catch (error) {
      throw new Error(`Failed to stage changes: ${getErrorMessage(error)}`)
    }
  }

  let stagedNumstatText = await readStagedNumstatText(repoRootPath)
  const trimmedMessage = input.message.trim()
  const commitModelSelection = resolveCommitModelSelection(input)
  let effectiveCommitMessage = trimmedMessage

  if (trimmedMessage.length === 0) {
    const generatedCommit = await generateStagedCommitMessage({
      repoRootPath,
      selection: commitModelSelection,
    })
    stagedNumstatText = generatedCommit.numstatText
    effectiveCommitMessage = generatedCommit.message
  }

  let activeBranchName = await readSymbolicHeadBranchName(repoRootPath)
  const preferredBranchName = input.preferredBranchName?.trim() ?? ''

  try {
    if (input.action === 'commit-and-create-pr') {
      const defaultBranchName = await resolveDefaultBranchName(repoRootPath)

      if (preferredBranchName.length > 0) {
        if (isDefaultBranchName(preferredBranchName, defaultBranchName)) {
          activeBranchName = await createAutonomousFeatureBranch(repoRootPath, effectiveCommitMessage, stagedNumstatText)
        } else {
          activeBranchName = await checkoutOrCreateBranch(repoRootPath, preferredBranchName)
        }
      } else {
        const currentBranchState = await readCurrentBranch(repoRootPath)
        const shouldAutoCreateFeatureBranch =
          currentBranchState.isDetachedHead ||
          currentBranchState.currentBranch === null ||
          (currentBranchState.currentBranch !== null &&
            isDefaultBranchName(currentBranchState.currentBranch, defaultBranchName))

        if (shouldAutoCreateFeatureBranch) {
          activeBranchName = await createAutonomousFeatureBranch(repoRootPath, effectiveCommitMessage, stagedNumstatText)
        } else {
          activeBranchName = currentBranchState.currentBranch
        }
      }
    } else if (preferredBranchName.length > 0) {
      activeBranchName = await checkoutOrCreateBranch(repoRootPath, preferredBranchName)
    }
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    throw new Error(`Failed to prepare branch for commit: ${getErrorMessage(error)}`)
  }

  let commitHash = ''
  try {
    await runGit(['commit', '-m', effectiveCommitMessage], repoRootPath)
    const { stdout } = await runGit(['rev-parse', '--short', 'HEAD'], repoRootPath)
    commitHash = stdout.trim()
  } catch (error) {
    throw new Error(`Failed to commit: ${getErrorMessage(error)}`)
  }

  let prUrl: string | null = null
  let defaultBranchName: string | null = null
  let switchedToDefaultBranch = false
  let pulledLatestOnDefaultBranch = false
  let postCommitWarning: string | null = null
  const historyEntry = await readLatestHistoryEntry(repoRootPath).catch((error) => {
    console.error('Failed to read latest git history entry after commit.', error)
    return null
  })
  if (input.action === 'commit-and-push' || input.action === 'commit-and-create-pr') {
    try {
      const currentBranch = await readSymbolicHeadBranchName(repoRootPath)
      if (!currentBranch) {
        throw new Error('Cannot push from detached HEAD. Checkout a branch first.')
      }

      activeBranchName = currentBranch
      let pullRequestRemoteName: string | null = null

      if (input.action === 'commit-and-create-pr') {
        await ensureBranchReadyForPullRequest(
          repoRootPath,
          currentBranch,
          await resolveDefaultBranchName(repoRootPath),
        )
      }

      if (input.action === 'commit-and-create-pr') {
        const remoteName = await getPreferredRemoteName(repoRootPath)
        if (!remoteName) {
          throw new Error('No remote is configured for this repository.')
        }
        pullRequestRemoteName = remoteName
        await runGit(['push', '-u', remoteName, currentBranch], repoRootPath)
      } else {
        await pushCheckedOutBranch(repoRootPath, currentBranch)
      }

      if (input.action === 'commit-and-create-pr') {
        const remoteUrl = await getRemoteUrl(repoRootPath)
        if (remoteUrl) {
          const resolvedDefaultBranchName = await resolveDefaultBranchName(repoRootPath)
          const effectiveDefaultBranch = resolvedDefaultBranchName ?? 'main'
          const githubRepositoryRef = parseGitHubRepositoryRef(remoteUrl)

          if (githubRepositoryRef) {
            if (!pullRequestRemoteName) {
              throw new Error('No remote is configured for this repository.')
            }
            prUrl = await createOrGetGitHubPullRequest({
              baseBranchName: effectiveDefaultBranch,
              commitMessage: effectiveCommitMessage,
              currentBranchName: currentBranch,
              remoteName: pullRequestRemoteName,
              repoRootPath,
              repositoryRef: githubRepositoryRef,
              selection: commitModelSelection,
            })
          } else {
            const httpsBase = remoteUrlToHttpsBase(remoteUrl)
            if (httpsBase) {
              const compareRef =
                effectiveDefaultBranch !== currentBranch
                  ? `${encodeURIComponent(effectiveDefaultBranch)}...${encodeURIComponent(currentBranch)}`
                  : encodeURIComponent(currentBranch)
              prUrl = `${httpsBase}/compare/${compareRef}?expand=1`
            }
          }
        }

        const postPullRequestCleanupResult = await runPostPullRequestCleanup(repoRootPath, currentBranch)
        defaultBranchName = postPullRequestCleanupResult.defaultBranchName
        switchedToDefaultBranch = postPullRequestCleanupResult.switchedToDefaultBranch
        pulledLatestOnDefaultBranch = postPullRequestCleanupResult.pulledLatestOnDefaultBranch
        postCommitWarning = postPullRequestCleanupResult.postCommitWarning
      }
    } catch (error) {
      if (isGitUnavailable(error)) {
        throw new Error('Git is not available in the current environment.')
      }

      throw new Error(`Committed successfully but failed to push: ${getErrorMessage(error)}`)
    }
  }

  return {
    branchName: activeBranchName,
    commitHash,
    defaultBranchName,
    historyEntry,
    message: effectiveCommitMessage,
    postCommitWarning,
    prUrl,
    pulledLatestOnDefaultBranch,
    success: true,
    switchedToDefaultBranch,
  }
}

