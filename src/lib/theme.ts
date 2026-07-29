import { DEFAULT_APP_APPEARANCE, isAppAppearance, type AppAppearance } from './appSettings'

export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'echosphere:appearance'
export const SYSTEM_DARK_MODE_QUERY = '(prefers-color-scheme: dark)'
export const LIGHT_THEME_COLOR = '#EEF4EE'
export const DARK_THEME_COLOR = '#171717'

export function getCachedAppearancePreference(): AppAppearance {
  if (typeof window === 'undefined' || typeof window.echosphereSettings?.getInitialSettings !== 'function') {
    return DEFAULT_APP_APPEARANCE
  }

  try {
    const cachedAppearance = window.echosphereSettings.getInitialSettings().appearance
    return isAppAppearance(cachedAppearance) ? cachedAppearance : DEFAULT_APP_APPEARANCE
  } catch {
    return DEFAULT_APP_APPEARANCE
  }
}

export function cacheAppearancePreference(appearance: AppAppearance) {
  if (typeof window === 'undefined' || typeof window.echosphereSettings?.updateSettings !== 'function') {
    return
  }

  try {
    void window.echosphereSettings.updateSettings({ appearance })
  } catch {
    // Ignore cache write failures
  }
}

export function resolveTheme(
  appearance: AppAppearance,
  mediaQueryList?: Pick<MediaQueryList, 'matches'> | null,
): ResolvedTheme {
  if (appearance === 'system') {
    return mediaQueryList?.matches ? 'dark' : 'light'
  }

  return appearance
}
