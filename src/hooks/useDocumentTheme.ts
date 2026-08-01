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

const THEME_SWITCHING_CLASS_NAME = 'theme-switching'

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

export function useDocumentTheme(appearance: AppAppearance) {
  const transitionFrameRef = useRef<number | null>(null)
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

    const finishThemeSwitch = () => {
      root.classList.remove(THEME_SWITCHING_CLASS_NAME)

      if (transitionFrameRef.current !== null) {
        window.cancelAnimationFrame(transitionFrameRef.current)
        transitionFrameRef.current = null
      }
    }

    const applyCurrentTheme = () => {
      if (transitionFrameRef.current !== null) {
        window.cancelAnimationFrame(transitionFrameRef.current)
      }

      root.classList.add(THEME_SWITCHING_CLASS_NAME)

      const nextResolvedTheme = resolveTheme(appearance, mediaQueryList)
      applyDocumentTheme(appearance, nextResolvedTheme)
      cacheAppearancePreference(appearance)
      setResolvedTheme(nextResolvedTheme)

      transitionFrameRef.current = window.requestAnimationFrame(() => {
        transitionFrameRef.current = window.requestAnimationFrame(() => {
          root.classList.remove(THEME_SWITCHING_CLASS_NAME)
          transitionFrameRef.current = null
        })
      })
    }

    applyCurrentTheme()

    if (appearance !== 'system' || mediaQueryList === null) {
      return () => {
        finishThemeSwitch()
      }
    }

    const handleSystemThemeChange = () => {
      applyCurrentTheme()
    }

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleSystemThemeChange)

      return () => {
        finishThemeSwitch()
        mediaQueryList.removeEventListener('change', handleSystemThemeChange)
      }
    }

    mediaQueryList.addListener(handleSystemThemeChange)

    return () => {
      finishThemeSwitch()
      mediaQueryList.removeListener(handleSystemThemeChange)
    }
  }, [appearance])

  return resolvedTheme
}
