import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { TideCodeUpdateCheckResult, TideCodeUpdateRelease } from '../../src/types/updates'
import { writeJsonFileAtomic } from '../settings/fileStore'
import { compareSemanticVersions, normalizeSemanticVersion } from './releaseVersion'

const UPDATE_RELEASE_CACHE_FILE_NAME = 'update-release-cache.json'

export interface CachedUpdateRelease {
  checkedAt: string
  release: TideCodeUpdateRelease
}

function isOfficialReleaseUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith('/ceciliomichael/TideCode/releases/')
  } catch {
    return false
  }
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : null
}

export function parseCachedUpdateRelease(value: unknown): CachedUpdateRelease | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as { checkedAt?: unknown; release?: unknown }
  const checkedAt = readString(candidate.checkedAt)
  if (!checkedAt || !candidate.release || typeof candidate.release !== 'object') {
    return null
  }

  const release = candidate.release as Partial<Record<keyof TideCodeUpdateRelease, unknown>>
  const body = readString(release.body)
  const htmlUrl = readString(release.htmlUrl)
  const name = readString(release.name)
  const tagName = readString(release.tagName)
  const versionValue = readString(release.version)
  const publishedAt = release.publishedAt === null
    ? null
    : readString(release.publishedAt)

  if (
    body === null
    || htmlUrl === null
    || name === null
    || tagName === null
    || versionValue === null
    || !isOfficialReleaseUrl(htmlUrl)
    || (release.publishedAt !== null && publishedAt === null)
  ) {
    return null
  }

  let version: string
  try {
    version = normalizeSemanticVersion(versionValue)
  } catch {
    return null
  }

  return {
    checkedAt,
    release: {
      body,
      htmlUrl,
      name,
      publishedAt,
      tagName,
      version,
    },
  }
}

export function buildCachedUpdateCheckResult(
  currentVersion: string,
  cachedRelease: CachedUpdateRelease,
): TideCodeUpdateCheckResult {
  const normalizedCurrentVersion = normalizeSemanticVersion(currentVersion)

  return {
    checkedAt: cachedRelease.checkedAt,
    currentVersion: normalizedCurrentVersion,
    downloadPercent: null,
    downloadState: 'not-available',
    latestVersion: cachedRelease.release.version,
    release: cachedRelease.release,
    updateAvailable: compareSemanticVersions(cachedRelease.release.version, normalizedCurrentVersion) > 0,
  }
}

export function createUpdateReleaseCacheStore(userDataPath: string) {
  const cachePath = path.join(userDataPath, UPDATE_RELEASE_CACHE_FILE_NAME)

  return {
    async read(): Promise<CachedUpdateRelease | null> {
      try {
        const raw = await fs.readFile(cachePath, 'utf8')
        return parseCachedUpdateRelease(JSON.parse(raw) as unknown)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
          return null
        }

        console.warn('TideCode could not read its cached release metadata.', error)
        return null
      }
    },
    async write(cachedRelease: CachedUpdateRelease) {
      await fs.mkdir(userDataPath, { recursive: true })
      await writeJsonFileAtomic(cachePath, JSON.stringify(cachedRelease, null, 2))
    },
  }
}
