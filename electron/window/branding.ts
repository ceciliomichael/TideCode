import { app, nativeImage, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'

const TIDECODE_APP_ICON_FILES = {
  raster: 'tidecode-icon-light.png',
  vector: 'tidecode-icon-light.svg',
} as const

function getApplicationRoot() {
  return process.env.APP_ROOT ?? process.cwd()
}

export function getTideCodeAppIconPath() {
  const assetsRoot = path.join(getApplicationRoot(), 'public', 'assets')
  const rasterPath = path.join(assetsRoot, TIDECODE_APP_ICON_FILES.raster)

  return existsSync(rasterPath)
    ? rasterPath
    : path.join(assetsRoot, TIDECODE_APP_ICON_FILES.vector)
}

export function applyTideCodeAppIcon(window: BrowserWindow) {
  const iconPath = getTideCodeAppIconPath()
  if (!existsSync(iconPath)) {
    return
  }

  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    return
  }

  if (process.platform === 'win32' || process.platform === 'linux') {
    window.setIcon(icon)
  }

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }
}
