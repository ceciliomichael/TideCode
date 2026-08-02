const GITHUB_REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u
const MAX_GITHUB_REPOSITORY_NAME_LENGTH = 100
const MAX_GITHUB_DESCRIPTION_LENGTH = 350

export interface NormalizedGitPublishOptions {
  defaultBranch: string
  description?: string
  isPrivate: boolean
  repoName: string
  workspacePath: string
}
export function normalizeGitPublishOptions(input: {
  defaultBranch?: string
  description?: string
  isPrivate: boolean
  repoName: string
  workspacePath: string
}): NormalizedGitPublishOptions {
  const workspacePath = input.workspacePath.trim()
  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  const repoName = input.repoName.trim()
  if (repoName.length === 0) {
    throw new Error('Repository name is required.')
  }
  if (repoName.length > MAX_GITHUB_REPOSITORY_NAME_LENGTH || !GITHUB_REPOSITORY_NAME_PATTERN.test(repoName)) {
    throw new Error(
      'Repository name can only contain letters, numbers, hyphens, dots, and underscores, and must be 100 characters or fewer.',
    )
  }

  const description = input.description?.trim() ?? ''
  if (description.length > MAX_GITHUB_DESCRIPTION_LENGTH) {
    throw new Error('Repository description must be 350 characters or fewer.')
  }

  const defaultBranch = input.defaultBranch?.trim() || 'main'

  return {
    defaultBranch,
    description: description.length > 0 ? description : undefined,
    isPrivate: input.isPrivate,
    repoName,
    workspacePath,
  }
}
