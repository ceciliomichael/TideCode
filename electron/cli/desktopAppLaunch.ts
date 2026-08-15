import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  serializeTideCodeLaunchRequest,
  type TideCodeLaunchRequest,
} from '../../src/lib/appLaunchRequest'
import { createApiKeyHandoff, discardApiKeyHandoff } from './apiKeyHandoff'

export type DesktopLaunchResult =
  | { ok: true; executable: string }
  | { ok: false; reason: 'not-installed' | 'spawn-failed'; message?: string }

export interface DesktopLaunchOptions {
  apiKey?: string
}

export function getInstalledTideCodeExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'win32') {
    const join = path.win32.join
    return [
      environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, 'Programs', 'TideCode', 'TideCode.exe') : '',
      environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, 'Programs', 'tidecode', 'tidecode.exe') : '',
    ]
  }

  if (platform === 'darwin') {
    return ['/Applications/TideCode.app/Contents/MacOS/TideCode', '/Applications/tidecode.app/Contents/MacOS/tidecode']
  }

  return [environment.APPIMAGE ?? '', '/opt/TideCode/tidecode', '/usr/bin/tidecode']
}

export function findInstalledTideCodeExecutable(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  return getInstalledTideCodeExecutableCandidates(platform, environment)
    .find((candidate) => candidate.length > 0 && existsSync(candidate)) ?? null
}

export function launchTideCodeDesktop(
  request: TideCodeLaunchRequest,
  options: DesktopLaunchOptions = {},
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DesktopLaunchResult> {
  const executable = findInstalledTideCodeExecutable(platform, environment)
  if (!executable) {
    return Promise.resolve({ ok: false, reason: 'not-installed' })
  }

  return (async () => {
    let apiKeyHandoffToken: string | null = null
    try {
      if (options.apiKey?.trim()) {
        apiKeyHandoffToken = await createApiKeyHandoff(options.apiKey)
      }
      const launchRequest = apiKeyHandoffToken
        ? { ...request, apiKeyHandoffToken }
        : request
      const argument = serializeTideCodeLaunchRequest(launchRequest)

      return await new Promise<DesktopLaunchResult>((resolve) => {
    let settled = false
    const finish = (result: DesktopLaunchResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    try {
      const child = spawn(executable, [argument], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.once('error', (error) => {
        if (apiKeyHandoffToken) void discardApiKeyHandoff(apiKeyHandoffToken)
        finish({
          ok: false,
          reason: 'spawn-failed',
          message: error instanceof Error ? error.message : String(error),
        })
      })
      child.once('spawn', () => finish({ ok: true, executable }))
      child.unref()
    } catch (error) {
      if (apiKeyHandoffToken) void discardApiKeyHandoff(apiKeyHandoffToken)
      finish({
        ok: false,
        reason: 'spawn-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
      })
    } catch (error) {
      if (apiKeyHandoffToken) await discardApiKeyHandoff(apiKeyHandoffToken).catch(() => undefined)
      return {
        ok: false,
        reason: 'spawn-failed' as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })()
}
