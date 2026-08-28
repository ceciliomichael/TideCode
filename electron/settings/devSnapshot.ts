import { promises as fs } from 'node:fs'
import path from 'node:path'
import { APP_SETTINGS_SURFACES } from '../../src/lib/appSettingsScopes'

const CONFIG_ROOT_SEGMENTS = ['.tidecode', 'config'] as const
const LEGACY_WORKSPACE_UI_STATE_FILE_NAME = 'workspace-ui-state.json'
const SETTINGS_FILE_NAME = 'settings.json'
const SURFACE_SETTINGS_FILE_PREFIX = 'surface-settings'

function getConfigDirectoryPath(homePath: string) {
  return path.join(homePath, ...CONFIG_ROOT_SEGMENTS)
}

export function isDevSettingsSnapshotFile(fileName: string) {
  if (
    fileName === SETTINGS_FILE_NAME ||
    fileName === LEGACY_WORKSPACE_UI_STATE_FILE_NAME
  ) {
    return true
  }

  return APP_SETTINGS_SURFACES.some(
    (surface) => fileName === `${SURFACE_SETTINGS_FILE_PREFIX}.${surface}.json`,
  )
}

export async function synchronizeDevSettingsSnapshot(
  productionHomePath: string,
  developmentHomePath: string,
) {
  const productionConfigPath = getConfigDirectoryPath(productionHomePath)
  const developmentConfigPath = getConfigDirectoryPath(developmentHomePath)

  await fs.rm(developmentConfigPath, { force: true, recursive: true })
  await fs.mkdir(developmentConfigPath, { recursive: true })

  let entries
  try {
    entries = await fs.readdir(productionConfigPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    throw error
  }

  for (const entry of entries) {
    if (!entry.isFile() || !isDevSettingsSnapshotFile(entry.name)) {
      continue
    }

    await fs.copyFile(
      path.join(productionConfigPath, entry.name),
      path.join(developmentConfigPath, entry.name),
    )
  }
}
