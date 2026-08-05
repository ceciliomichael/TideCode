import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { GitFileStageBatchInput, GitFileStageBatchResult, GitFileStageInput, GitFileStageResult } from '../../src/types/chat'
import {
  getErrorMessage,
  isGitUnavailable,
  resolveAndValidateGitFilePath,
  resolveRepositoryRoot,
  runGit,
} from './repositoryContext'

async function isTrackedGitFile(repoRootPath: string, filePath: string) {
  try {
    await runGit(['ls-files', '--error-unmatch', '--', filePath], repoRootPath)
    return true
  } catch {
    return false
  }
}

async function resolveStageFileBatch(input: GitFileStageBatchInput) {
  const workspacePath = input.workspacePath.trim()
  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    throw new Error('No git repository was found for this workspace.')
  }

  const filePaths = await Promise.all(input.filePaths.map(async (filePath) => resolveAndValidateGitFilePath(repoRootPath, filePath)))
  if (filePaths.length === 0) {
    throw new Error('At least one file path is required.')
  }

  return { repoRootPath, filePaths }
}

export async function discardGitFileChanges(input: GitFileStageInput): Promise<GitFileStageResult> {
  const workspacePath = input.workspacePath.trim()
  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    throw new Error('No git repository was found for this workspace.')
  }

  const filePath = await resolveAndValidateGitFilePath(repoRootPath, input.filePath)
  const absoluteFilePath = path.resolve(repoRootPath, filePath)

  try {
    if (await isTrackedGitFile(repoRootPath, filePath)) {
      // Discarding an item from the Unstaged section must remove only the
      // worktree diff. The index is the source of truth for the staged
      // version, so restoring from HEAD would be a no-op for a file whose
      // worktree was reverted to HEAD while its staged content still differs.
      await runGit(['restore', '--worktree', '--', filePath], repoRootPath).catch(async () => {
        await runGit(['checkout', '--', filePath], repoRootPath)
      })
    } else {
      await fs.rm(absoluteFilePath, {
        force: true,
        recursive: true,
      })
    }
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    throw new Error(`Failed to discard file changes: ${getErrorMessage(error)}`)
  }

  return {
    filePath,
    success: true,
  }
}

export async function stageGitFile(input: GitFileStageInput): Promise<GitFileStageResult> {
  const workspacePath = input.workspacePath.trim()
  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    throw new Error('No git repository was found for this workspace.')
  }

  const filePath = await resolveAndValidateGitFilePath(repoRootPath, input.filePath)

  try {
    await runGit(['add', '--', filePath], repoRootPath)
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    throw new Error(`Failed to stage file: ${getErrorMessage(error)}`)
  }

  return {
    filePath,
    success: true,
  }
}

export async function stageGitFiles(input: GitFileStageBatchInput): Promise<GitFileStageBatchResult> {
  const { repoRootPath, filePaths } = await resolveStageFileBatch(input)

  try {
    await runGit(['add', '--', ...filePaths], repoRootPath)
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    throw new Error(`Failed to stage files: ${getErrorMessage(error)}`)
  }

  return {
    filePaths,
    success: true,
  }
}

export async function unstageGitFile(input: GitFileStageInput): Promise<GitFileStageResult> {
  const workspacePath = input.workspacePath.trim()
  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    throw new Error('No git repository was found for this workspace.')
  }

  const filePath = await resolveAndValidateGitFilePath(repoRootPath, input.filePath)

  try {
    await runGit(['restore', '--staged', '--', filePath], repoRootPath)
  } catch (error) {
    try {
      await runGit(['reset', '--', filePath], repoRootPath)
    } catch (fallbackError) {
      if (isGitUnavailable(fallbackError)) {
        throw new Error('Git is not available in the current environment.')
      }

      throw new Error(`Failed to unstage file: ${getErrorMessage(fallbackError)}`)
    }

    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }
  }

  return {
    filePath,
    success: true,
  }
}

export async function unstageGitFiles(input: GitFileStageBatchInput): Promise<GitFileStageBatchResult> {
  const { repoRootPath, filePaths } = await resolveStageFileBatch(input)

  try {
    await runGit(['restore', '--staged', '--', ...filePaths], repoRootPath)
  } catch (error) {
    try {
      await runGit(['reset', '--', ...filePaths], repoRootPath)
    } catch (fallbackError) {
      if (isGitUnavailable(fallbackError)) {
        throw new Error('Git is not available in the current environment.')
      }

      throw new Error(`Failed to unstage files: ${getErrorMessage(fallbackError)}`)
    }

    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }
  }

  return {
    filePaths,
    success: true,
  }
}

