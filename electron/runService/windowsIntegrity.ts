import { execFileSync } from 'node:child_process'
import path from 'node:path'

let cachedIntegrityLevel: number | undefined

export function parseWindowsIntegrityLevel(groupOutput: string) {
  const integritySids = [...groupOutput.matchAll(/"S-1-16-(\d+)"/gu)]
  if (integritySids.length !== 1) {
    throw new Error('Unable to determine the Windows security level for the TideCode run service.')
  }

  const integrityLevel = Number(integritySids[0][1])
  if (!Number.isSafeInteger(integrityLevel) || integrityLevel < 0) {
    throw new Error('The Windows security level for the TideCode run service is invalid.')
  }
  return integrityLevel
}

export function readWindowsIntegrityLevel(queryGroups?: () => string) {
  try {
    if (queryGroups) {
      return parseWindowsIntegrityLevel(queryGroups())
    }

    const systemRoot = process.env.SystemRoot
    if (!systemRoot) {
      throw new Error('The Windows system directory is unavailable.')
    }
    const output = execFileSync(path.join(systemRoot, 'System32', 'whoami.exe'), ['/groups', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return parseWindowsIntegrityLevel(output)
  } catch (error) {
    const failure = new Error('Unable to determine the Windows security level for the TideCode run service. Check that whoami.exe can run, then restart TideCode.')
    Object.assign(failure, { cause: error })
    throw failure
  }
}

export function getWindowsIntegrityLevel() {
  cachedIntegrityLevel ??= readWindowsIntegrityLevel()
  return cachedIntegrityLevel
}
