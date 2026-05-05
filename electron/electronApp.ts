import os from 'node:os'
import * as electronModule from 'electron'

interface ElectronAppLike {
  getPath(name: 'home'): string
}

function isElectronAppLike(value: unknown): value is ElectronAppLike {
  return typeof value === 'object' && value !== null && typeof (value as ElectronAppLike).getPath === 'function'
}

const fallbackApp: ElectronAppLike = {
  getPath(name) {
    if (name === 'home') {
      return os.homedir()
    }

    throw new Error(`Unsupported fallback Electron path request: ${name}`)
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
