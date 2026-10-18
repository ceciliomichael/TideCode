import { nativeTheme, type BrowserWindow, type TitleBarOverlay } from 'electron'
import type { AppAppearance } from '../../src/lib/appSettings'

type ResolvedWindowTheme = 'light' | 'dark'

interface WindowThemePalette {
  backgroundColor: string
  overlayColor: string
  symbolColor: string
}

const TITLE_BAR_OVERLAY_HEIGHT = 36

// Keep these native window colors aligned with the shell/titlebar surface tokens in src/index.css.
// Electron cannot read the renderer CSS variables before the window is painted.
// Let the CSS titlebar show through the native controls so its background changes in one paint.

const LIGHT_WINDOW_THEME: WindowThemePalette = {
  backgroundColor: '#eef1ef',
  overlayColor: '#00000000',
  symbolColor: '#202221',
}

const DARK_WINDOW_THEME: WindowThemePalette = {
  backgroundColor: '#131314',
  overlayColor: '#00000000',
  symbolColor: '#e9e9ea',
}

export function syncNativeThemeSource(appearance: AppAppearance) {
  nativeTheme.themeSource = appearance
}

export function resolveWindowTheme(appearance: AppAppearance): ResolvedWindowTheme {
  if (appearance === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  return appearance
}

export function getWindowBackgroundColor(appearance: AppAppearance) {
  return getWindowThemePalette(resolveWindowTheme(appearance)).backgroundColor
}

export function getTitleBarOverlay(appearance: AppAppearance): TitleBarOverlay {
  const palette = getWindowThemePalette(resolveWindowTheme(appearance))

  return {
    color: palette.overlayColor,
    symbolColor: palette.symbolColor,
    height: TITLE_BAR_OVERLAY_HEIGHT,
  }
}

export function applyWindowTheme(window: BrowserWindow, appearance: AppAppearance) {
  syncNativeThemeSource(appearance)
  const palette = getWindowThemePalette(resolveWindowTheme(appearance))

  window.setBackgroundColor(palette.backgroundColor)

  if (process.platform === 'win32' || process.platform === 'linux') {
    window.setTitleBarOverlay({
      color: palette.overlayColor,
      symbolColor: palette.symbolColor,
      height: TITLE_BAR_OVERLAY_HEIGHT,
    })
  }
}

function getWindowThemePalette(theme: ResolvedWindowTheme): WindowThemePalette {
  return theme === 'dark' ? DARK_WINDOW_THEME : LIGHT_WINDOW_THEME
}
