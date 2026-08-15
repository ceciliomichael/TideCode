import os from 'node:os'
import path from 'node:path'
import * as electronModule from 'electron'

interface ElectronAppLike {
  getPath(name: 'home' | 'userData' | 'appData'): string
  getName?(): string
  getVersion?(): string
  getAppPath?(): string
}

function isElectronAppLike(value: unknown): value is ElectronAppLike {
  return typeof value === 'object' && value !== null && typeof (value as ElectronAppLike).getPath === 'function'
}

const fallbackApp: ElectronAppLike = {
  getPath(name) {
    if (name === 'home') {
      return os.homedir()
    }
    if (name === 'userData' || name === 'appData') {
      return path.join(os.homedir(), '.tidecode')
    }

    return os.homedir()
  },
  getName() {
    return 'TideCode'
  },
  getVersion() {
    return '1.1.11'
  },
  getAppPath() {
    return process.cwd()
  },
}

const electronNamespace = electronModule as unknown as {
  app?: unknown
  default?: unknown
}

export const electronApp = isElectronAppLike(electronNamespace.app)
  ? electronNamespace.app
  : isElectronAppLike(electronNamespace.default)
    ? electronNamespace.default
    : fallbackApp
