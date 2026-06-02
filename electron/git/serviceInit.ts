import type { GitInitResult, GitPublishInput, GitPublishResult } from '../../src/types/chat'
import https from 'node:https'
import {
  getErrorMessage,
  isGitUnavailable,
  resolveRepositoryRoot,
  runGit,
} from './repositoryContext'

export async function initGitRepository(workspacePath: string): Promise<GitInitResult> {
  const normalizedPath = workspacePath.trim()
  if (normalizedPath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  try {
    await runGit(['init'], normalizedPath)
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }
    throw new Error(`Failed to initialize repository: ${getErrorMessage(error)}`)
  }

  const repoRootPath = await resolveRepositoryRoot(normalizedPath)
  if (!repoRootPath) {
    throw new Error('Repository was initialized but could not be located.')
  }

  return {
    repoRootPath,
    success: true,
  }
}

export async function publishToGitHub(input: GitPublishInput): Promise<GitPublishResult> {
  const workspacePath = input.workspacePath.trim()
  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  const repoName = input.repoName.trim()
  if (repoName.length === 0) {
    throw new Error('Repository name is required.')
  }

  // Ensure repo is initialized
  let repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    await runGit(['init'], workspacePath)
    repoRootPath = workspacePath
  }

  // Configure default branch name if specified
  const defaultBranch = input.defaultBranch?.trim() || 'main'

  // Set the default branch name before any commits
  try {
    await runGit(['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`], repoRootPath)
  } catch {
    // Not fatal — some git versions handle this differently
  }

  // Stage all files
  try {
    await runGit(['add', '-A'], repoRootPath)
  } catch (error) {
    throw new Error(`Failed to stage files: ${getErrorMessage(error)}`)
  }

  // Check if there are any commits — if not, create an initial one
  let hasCommits = false
  try {
    await runGit(['rev-parse', 'HEAD'], repoRootPath)
    hasCommits = true
  } catch {
    hasCommits = false
  }

  if (!hasCommits) {
    // Only commit if there are staged files
    try {
      const { stdout: statusOut } = await runGit(['status', '--porcelain'], repoRootPath)
      if (statusOut.trim().length > 0) {
        await runGit(['commit', '-m', 'Initial commit'], repoRootPath)
      } else {
        // Create an empty initial commit so gh can push
        await runGit(['commit', '--allow-empty', '-m', 'Initial commit'], repoRootPath)
      }
    } catch (error) {
      // Might fail if user has no git identity set
      const msg = getErrorMessage(error)
      if (msg.toLowerCase().includes('user.email') || msg.toLowerCase().includes('user.name') || msg.toLowerCase().includes('tell me who you are')) {
        throw new Error(
          'Git user identity is not configured. Run `git config --global user.email "you@example.com"` and `git config --global user.name "Your Name"` in a terminal, then try again.',
        )
      }
      throw new Error(`Failed to create initial commit: ${msg}`)
    }
  }

  const githubToken = input.githubToken?.trim()
  if (!githubToken) {
    throw new Error('GitHub Personal Access Token is required to publish repository.')
  }

  let apiResult: any
  try {
    apiResult = await githubRequest(
      'POST',
      '/user/repos',
      githubToken,
      {
        name: repoName,
        description: input.description?.trim() || undefined,
        private: input.isPrivate,
      }
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('401') || msg.toLowerCase().includes('bad credentials')) {
      throw new Error('Invalid GitHub token. Please verify your Personal Access Token and try again.')
    }
    throw new Error(`GitHub API error: ${msg}`)
  }

  const cloneUrl = apiResult.clone_url
  const repoUrl = apiResult.html_url
  const owner = apiResult.owner?.login

  if (!cloneUrl || !repoUrl || !owner) {
    throw new Error('Failed to retrieve repository details from GitHub API.')
  }

  try {
    // 1. Check if "origin" already exists, remove it if it does
    try {
      await runGit(['remote', 'remove', 'origin'], repoRootPath)
    } catch {
      // Ignore if origin doesn't exist
    }

    // 2. Add authenticated remote URL
    const authRemoteUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repoName}.git`
    await runGit(['remote', 'add', 'origin', authRemoteUrl], repoRootPath)

    // 3. Push and set upstream tracking branch
    await runGit(['push', '-u', 'origin', defaultBranch], repoRootPath)

    // 4. Update remote to use clean remote URL (so token is not stored in config)
    await runGit(['remote', 'set-url', 'origin', cloneUrl], repoRootPath)
  } catch (error) {
    throw new Error(`Failed to push to GitHub: ${getErrorMessage(error)}`)
  }

  return {
    remoteUrl: cloneUrl,
    repoUrl,
    success: true,
  }
}

function githubRequest(
  method: 'GET' | 'POST',
  path: string,
  token: string,
  body?: any
): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : ''
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Echosphere',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let parsed: any
        try {
          parsed = data ? JSON.parse(data) : null
        } catch (e) {
          reject(new Error(`Invalid response from GitHub: ${data}`))
          return
        }

        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed)
        } else {
          const errorMsg = parsed?.message || `GitHub API returned status ${res.statusCode}`
          const errors = parsed?.errors ? ` (${JSON.stringify(parsed.errors)})` : ''
          reject(new Error(`${errorMsg}${errors}`))
        }
      })
    })

    req.on('error', (err) => {
      reject(err)
    })

    if (body) {
      req.write(postData)
    }
    req.end()
  })
}
