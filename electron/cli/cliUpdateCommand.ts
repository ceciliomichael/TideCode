import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { electronApp } from '../electronApp'
import {
  buildLatestReleaseRequestUrl,
  checkForUpdates,
  TIDECODE_LATEST_RELEASE_URL,
} from '../updates/githubReleaseService'
import { TIDECODE_INSTALL_UPDATE_ARGUMENT } from '../../src/lib/updateRequest'
import type { SlashCommandHelpers } from './types'

async function requestLatestRelease(): Promise<unknown> {
  const response = await fetch(buildLatestReleaseRequestUrl(), {
    headers: {
      Accept: 'application/vnd.github+json',
      'Cache-Control': 'no-cache',
      'User-Agent': 'TideCode-CLI-update-checker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`GitHub could not be reached right now (HTTP ${response.status}).`)
  return response.json()
}

export function findInstalledTideCodeExecutable(): string | null {
  const candidates = process.platform === 'win32'
    ? [
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'TideCode', 'TideCode.exe') : '',
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'tidecode', 'tidecode.exe') : '',
      ]
    : process.platform === 'darwin'
      ? ['/Applications/TideCode.app/Contents/MacOS/TideCode', '/Applications/tidecode.app/Contents/MacOS/tidecode']
      : [process.env.APPIMAGE ?? '', '/opt/TideCode/tidecode', '/usr/bin/tidecode']
  return candidates.find((candidate) => candidate.length > 0 && existsSync(candidate)) ?? null
}

export async function runCliUpdateCommand(helpers: SlashCommandHelpers): Promise<void> {
  helpers.renderInfo('Checking the official TideCode release…')
  const result = await checkForUpdates(electronApp.getVersion?.() ?? '1.1.11', requestLatestRelease)
  if (!result.updateAvailable) {
    helpers.renderSuccess(`TideCode ${result.currentVersion} is up to date.`)
    return
  }
  const executable = findInstalledTideCodeExecutable()
  if (!executable) {
    helpers.renderWarning(`TideCode ${result.latestVersion} is available. Automatic install requires the packaged desktop app: ${TIDECODE_LATEST_RELEASE_URL}`)
    return
  }
  const confirmed = await helpers.confirm(
    `Download TideCode ${result.latestVersion} and close the desktop app plus CLI to install it?`,
    true,
  )
  if (!confirmed) return

  const child = spawn(executable, [TIDECODE_INSTALL_UPDATE_ARGUMENT], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  helpers.renderSuccess('Update handed to the TideCode desktop updater. Closing the CLI now.')
  helpers.exit()
}
