import { createRequire } from 'node:module'

interface ElectronShellProvider {
  openExternal(url: string): Promise<void>
}

const requireFromCurrentModule = createRequire(import.meta.url)

function resolveElectronShellProvider(): ElectronShellProvider | null {
  try {
    const electronModule = requireFromCurrentModule('electron') as unknown
    if (typeof electronModule !== 'object' || electronModule === null) {
      return null
    }

    const shellCandidate = (electronModule as { shell?: unknown }).shell
    if (typeof shellCandidate !== 'object' || shellCandidate === null) {
      return null
    }

    const openExternal = (shellCandidate as { openExternal?: unknown }).openExternal
    return typeof openExternal === 'function'
      ? shellCandidate as ElectronShellProvider
      : null
  } catch {
    return null
  }
}

export async function openExternalWithElectronShell(url: string) {
  const electronShell = resolveElectronShellProvider()
  if (!electronShell) {
    throw new Error('Opening an external URL requires the Electron main process.')
  }

  await electronShell.openExternal(url)
}
