import { spawnSync } from 'node:child_process'
import path from 'node:path'

type WindowsRegistryValueReader = (
  keyPath: string,
  valueName: string,
  environment: NodeJS.ProcessEnv,
) => string | null

export interface WindowsPathRefreshOptions {
  platform?: NodeJS.Platform
  readRegistryValue?: WindowsRegistryValueReader
}

const USER_ENVIRONMENT_KEY = 'HKCU\\Environment'
const MACHINE_ENVIRONMENT_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const WINDOWS_PATH_SEPARATOR = ';'
const WINDOWS_PATH_KEY = 'Path'

function readEnvironmentValue(environment: NodeJS.ProcessEnv, key: string) {
  const normalizedKey = key.toLowerCase()
  for (const [environmentKey, value] of Object.entries(environment)) {
    if (environmentKey.toLowerCase() !== normalizedKey) continue
    const normalizedValue = value?.trim()
    if (normalizedValue) return normalizedValue
  }
  return undefined
}

export function parseWindowsRegistryStringValue(output: string, valueName: string) {
  const normalizedValueName = valueName.toLowerCase()
  for (const line of output.split(/\r?\n/gu)) {
    const match = /^\s*(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/u.exec(line)
    if (match?.[1]?.toLowerCase() !== normalizedValueName) continue
    return match[2]?.trim() ?? null
  }
  return null
}

function expandWindowsEnvironmentVariables(value: string, environment: NodeJS.ProcessEnv) {
  let expanded = value
  for (let pass = 0; pass < 10; pass += 1) {
    const next = expanded.replace(/%([^%]+)%/gu, (match, key: string) =>
      readEnvironmentValue(environment, key) ?? match)
    if (next === expanded) return expanded
    expanded = next
  }
  return expanded
}

function readWindowsRegistryValue(
  keyPath: string,
  valueName: string,
  environment: NodeJS.ProcessEnv,
) {
  const systemRoot = readEnvironmentValue(environment, 'SystemRoot')
    ?? readEnvironmentValue(environment, 'WinDir')
  const registryCommand = systemRoot
    ? path.win32.join(systemRoot, 'System32', 'reg.exe')
    : 'reg.exe'

  try {
    const result = spawnSync(registryCommand, ['query', keyPath, '/v', valueName], {
      encoding: 'utf8',
      env: environment,
      timeout: 1_000,
      windowsHide: true,
    })
    if (result.status !== 0 || typeof result.stdout !== 'string') return null
    return parseWindowsRegistryStringValue(result.stdout, valueName)
  } catch {
    return null
  }
}

function splitWindowsPath(value: string | null | undefined) {
  return value
    ?.split(WINDOWS_PATH_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean) ?? []
}

function mergeWindowsPathValues(values: readonly (string | null | undefined)[]) {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const value of values) {
    for (const entry of splitWindowsPath(value)) {
      const normalizedEntry = entry.toLowerCase()
      if (seen.has(normalizedEntry)) continue
      seen.add(normalizedEntry)
      merged.push(entry)
    }
  }
  return merged.join(WINDOWS_PATH_SEPARATOR)
}

export function refreshWindowsPathEnvironment(
  environment: NodeJS.ProcessEnv,
  options: WindowsPathRefreshOptions = {},
) {
  if ((options.platform ?? process.platform) !== 'win32') return { ...environment }

  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path')
    ?? WINDOWS_PATH_KEY
  const currentPath = readEnvironmentValue(environment, 'PATH') ?? ''
  const readRegistryValue = options.readRegistryValue ?? readWindowsRegistryValue
  const userPath = readRegistryValue(USER_ENVIRONMENT_KEY, 'Path', environment)
  const machinePath = readRegistryValue(MACHINE_ENVIRONMENT_KEY, 'Path', environment)
  const expandedUserPath = userPath
    ? expandWindowsEnvironmentVariables(userPath, environment)
    : null
  const expandedMachinePath = machinePath
    ? expandWindowsEnvironmentVariables(machinePath, environment)
    : null
  const refreshedPath = mergeWindowsPathValues([
    currentPath,
    expandedUserPath,
    expandedMachinePath,
  ])

  const refreshedEnvironment: NodeJS.ProcessEnv = { ...environment }
  for (const key of Object.keys(refreshedEnvironment)) {
    if (key.toLowerCase() === 'path' && key !== pathKey) delete refreshedEnvironment[key]
  }
  refreshedEnvironment[pathKey] = refreshedPath
  return refreshedEnvironment
}
