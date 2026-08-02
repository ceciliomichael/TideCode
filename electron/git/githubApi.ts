import { fetchGitHub } from './githubHttp'

const GITHUB_API_BASE_URL = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'

interface GitHubRepositoryPayload {
  clone_url?: unknown
  html_url?: unknown
  owner?: unknown
}

interface GitHubOwnerPayload {
  login?: unknown
}

export interface CreatedGitHubRepository {
  cloneUrl: string
  owner: string
  repoUrl: string
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function getOwnerLogin(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const login = (value as GitHubOwnerPayload).login
  return hasText(login) ? login.trim() : null
}

async function parseGitHubResponse(response: Response) {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

function getGitHubErrorMessage(payload: unknown, status: number) {
  if (typeof payload === 'object' && payload !== null) {
    const message = (payload as { message?: unknown }).message
    if (hasText(message)) {
      return message.trim()
    }
  }

  return `GitHub returned status ${status}.`
}

export async function createGitHubRepository(input: {
  accessToken: string
  description?: string
  isPrivate: boolean
  repoName: string
}): Promise<CreatedGitHubRepository> {
  let response: Response
  try {
    response = await fetchGitHub(`${GITHUB_API_BASE_URL}/user/repos`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      body: JSON.stringify({
        description: input.description,
        name: input.repoName,
        private: input.isPrivate,
      }),
    })
  } catch {
    throw new Error('Could not connect to GitHub. Check your internet connection and try again.')
  }

  const payload = await parseGitHubResponse(response)
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('GitHub sign-in expired. Connect to GitHub again and retry.')
    }

    throw new Error(`GitHub could not create the repository: ${getGitHubErrorMessage(payload, response.status)}`)
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('GitHub returned an invalid repository response.')
  }

  const repository = payload as GitHubRepositoryPayload
  const cloneUrl = hasText(repository.clone_url) ? repository.clone_url.trim() : null
  const repoUrl = hasText(repository.html_url) ? repository.html_url.trim() : null
  const owner = getOwnerLogin(repository.owner)

  if (!cloneUrl || !repoUrl || !owner) {
    throw new Error('GitHub returned an incomplete repository response.')
  }

  return {
    cloneUrl,
    owner,
    repoUrl,
  }
}
