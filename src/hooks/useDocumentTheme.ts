import { useLayoutEffect, useRef, useState } from 'react'
import type { AppAppearance } from '../lib/appSettings'
import { syncTideCodeFavicon } from '../lib/brandAssets'
import {
  cacheAppearancePreference,
  DARK_THEME_COLOR,
  LIGHT_THEME_COLOR,
  resolveTheme,
  SYSTEM_DARK_MODE_QUERY,
  type ResolvedTheme,
} from '../lib/theme'

const THEME_TRANSITION_CLASS_NAME = 'theme-transition'
const THEME_TRANSITION_DURATION_MS = 180

function applyDocumentTheme(appearance: AppAppearance, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement

  root.dataset.theme = resolvedTheme
  root.dataset.themePreference = appearance
  root.style.colorScheme = resolvedTheme
  syncTideCodeFavicon()
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
}

function enableThemeTransition(root: HTMLElement) {
  root.classList.add(THEME_TRANSITION_CLASS_NAME)
}

export function useDocumentTheme(appearance: AppAppearance) {
  const isFirstApplicationRef = useRef(true)
  const transitionTimeoutRef = useRef<number | null>(null)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return resolveTheme(appearance)
    }

    return resolveTheme(appearance, window.matchMedia(SYSTEM_DARK_MODE_QUERY))
  })

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const root = document.documentElement
    const mediaQueryList =
      typeof window.matchMedia === 'function' ? window.matchMedia(SYSTEM_DARK_MODE_QUERY) : null

    const clearThemeTransition = () => {
      root.classList.remove(THEME_TRANSITION_CLASS_NAME)

      if (transitionTimeoutRef.current !== null) {
        window.clearTimeout(transitionTimeoutRef.current)
        transitionTimeoutRef.current = null
      }
    }

    const applyCurrentTheme = (shouldAnimate: boolean) => {
      if (shouldAnimate) {
        enableThemeTransition(root)
      }

      const nextResolvedTheme = resolveTheme(appearance, mediaQueryList)
      setResolvedTheme(nextResolvedTheme)
      applyDocumentTheme(appearance, nextResolvedTheme)
      cacheAppearancePreference(appearance)

      if (shouldAnimate) {
        transitionTimeoutRef.current = window.setTimeout(() => {
          clearThemeTransition()
        }, THEME_TRANSITION_DURATION_MS)
      }
    }

    applyCurrentTheme(!isFirstApplicationRef.current)
    isFirstApplicationRef.current = false

    if (appearance !== 'system' || mediaQueryList === null) {
      return () => {
        clearThemeTransition()
      }
    }

    const handleSystemThemeChange = () => {
      applyCurrentTheme(true)
    }

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleSystemThemeChange)

      return () => {
        clearThemeTransition()
        mediaQueryList.removeEventListener('change', handleSystemThemeChange)
      }
    }

    mediaQueryList.addListener(handleSystemThemeChange)

    return () => {
      clearThemeTransition()
      mediaQueryList.removeListener(handleSystemThemeChange)
    }
  }, [appearance])

  return resolvedTheme
}
