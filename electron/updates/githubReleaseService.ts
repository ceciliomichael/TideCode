import type { TideCodeUpdateCheckResult, TideCodeUpdateRelease } from '../../src/types/updates'
import { compareSemanticVersions, normalizeSemanticVersion } from './releaseVersion'

export const TIDECODE_GITHUB_REPOSITORY = 'ceciliomichael/TideCode'
export const TIDECODE_LATEST_RELEASE_URL = `https://github.com/${TIDECODE_GITHUB_REPOSITORY}/releases/latest`

export const TIDECODE_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${TIDECODE_GITHUB_REPOSITORY}/releases/latest`

export function buildLatestReleaseRequestUrl(cacheBust = Date.now()) {
  const separator = TIDECODE_LATEST_RELEASE_API_URL.includes('?') ? '&' : '?'
  return `${TIDECODE_LATEST_RELEASE_API_URL}${separator}_=${encodeURIComponent(String(cacheBust))}`
}

interface GitHubReleasePayload {
  body?: unknown
  html_url?: unknown
  name?: unknown
  published_at?: unknown
  tag_name?: unknown
}

export type ReleaseRequest = () => Promise<unknown>

function getStringProperty(payload: GitHubReleasePayload, key: keyof GitHubReleasePayload) {
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

function isOfficialReleaseUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(
      `/${TIDECODE_GITHUB_REPOSITORY}/releases/`,
    )
  } catch {
    return false
  }
}

function parseGitHubRelease(payload: unknown): TideCodeUpdateRelease {
  if (!payload || typeof payload !== 'object') {
    throw new Error('GitHub returned an invalid release response.')
  }

  const releasePayload = payload as GitHubReleasePayload
  const tagName = getStringProperty(releasePayload, 'tag_name')
  const htmlUrl = getStringProperty(releasePayload, 'html_url')

  if (!tagName || !htmlUrl || !isOfficialReleaseUrl(htmlUrl)) {
    throw new Error('GitHub returned an invalid TideCode release.')
  }

  let version: string
  try {
    version = normalizeSemanticVersion(tagName)
  } catch {
    throw new Error('The latest TideCode release does not use a supported version format.')
  }

  const name = getStringProperty(releasePayload, 'name')?.trim() || `TideCode v${version}`
  const publishedAt = getStringProperty(releasePayload, 'published_at')
  const body = getStringProperty(releasePayload, 'body')?.trim() ?? ''

  return {
    body,
    htmlUrl,
    name,
    publishedAt,
    tagName,
    version,
  }
}

export async function checkForUpdates(
  currentVersion: string,
  requestRelease: ReleaseRequest,
): Promise<TideCodeUpdateCheckResult> {
  const normalizedCurrentVersion = normalizeSemanticVersion(currentVersion)

  try {
    const release = parseGitHubRelease(await requestRelease())

    return {
      checkedAt: new Date().toISOString(),
      currentVersion: normalizedCurrentVersion,
      downloadPercent: null,
      downloadState: 'not-available',
      latestVersion: release.version,
      release,
      updateAvailable: compareSemanticVersions(release.version, normalizedCurrentVersion) > 0,
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'UPDATE_REQUEST_TIMEOUT') {
      throw new Error('The update check timed out. Please try again.')
    }

    if (error instanceof TypeError) {
      throw new Error('TideCode could not connect to GitHub. Check your internet connection and try again.')
    }

    throw error
  }
}
