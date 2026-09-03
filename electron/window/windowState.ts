import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'

const WINDOW_STATE_FILE_NAME = 'window-state.json'

export type TideCodeWindowState = {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
  isFullScreen: boolean
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE_NAME)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseWindowState(value: unknown): TideCodeWindowState | null {
  if (!value || typeof value !== 'object') return null

  const state = value as Record<string, unknown>
  if (
    !isFiniteNumber(state.x)
    || !isFiniteNumber(state.y)
    || !isFiniteNumber(state.width)
    || !isFiniteNumber(state.height)
    || state.width <= 0
    || state.height <= 0
  ) {
    return null
  }

  return {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    isMaximized: state.isMaximized === true,
    isFullScreen: state.isFullScreen === true,
  }
}

export async function readWindowState(): Promise<TideCodeWindowState | null> {
  try {
    const content = await fs.readFile(getWindowStatePath(), 'utf8')
    return parseWindowState(JSON.parse(content))
  } catch {
    return null
  }
}

export async function saveWindowState(window: BrowserWindow) {
  if (window.isDestroyed()) return

  const state: TideCodeWindowState = {
    ...window.getNormalBounds(),
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen(),
  }
  const targetPath = getWindowStatePath()
  const temporaryPath = `${targetPath}.tmp`

  await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2), 'utf8')
  await fs.rename(temporaryPath, targetPath)
}
