import type { GitInitResult } from '../../src/types/chat'
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
