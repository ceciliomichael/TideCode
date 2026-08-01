import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_APP_SETTINGS } from '../lib/defaultAppSettings'
import { resetLaunchOnlyAppSettings } from './appSettingsLaunchState'
import { getCachedAppearancePreference } from '../lib/theme'
import type { AppSettings } from '../types/chat'
import { shouldDeferRendererSettingsCommit } from './appSettingsUpdatePolicy'

export type AppSettingsSaveState = 'idle' | 'saving' | 'saved' | 'error'

function getInitialAppSettings(): AppSettings {
  const fallbackSettings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    appearance: getCachedAppearancePreference(),
  }

  if (typeof window === 'undefined' || typeof window.tidecodeSettings?.getInitialSettings !== 'function') {
    return fallbackSettings
  }

  return resetLaunchOnlyAppSettings({
    ...fallbackSettings,
    ...window.tidecodeSettings.getInitialSettings(),
  })
}

export function useAppSettings() {
  const initialSettingsRef = useRef<AppSettings | null>(null)

  if (initialSettingsRef.current === null) {
    initialSettingsRef.current = getInitialAppSettings()
  }

  const initialSettings = initialSettingsRef.current

  const [settings, setSettings] = useState<AppSettings>(() => initialSettings)
  const [isLoading, setIsLoading] = useState(true)
  const [saveState, setSaveState] = useState<AppSettingsSaveState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const settingsRef = useRef<AppSettings>(initialSettings)
  const requestIdRef = useRef(0)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    let isMounted = true

    async function loadSettings() {
      try {
        const nextSettings = resetLaunchOnlyAppSettings(
          await window.tidecodeSettings.getSettings(),
        )
        if (!isMounted) {
          return
        }

        settingsRef.current = nextSettings
        setSettings(nextSettings)
        setErrorMessage(null)
        setSaveState('idle')
      } catch (error) {
        console.error('Failed to load app settings', error)
        if (!isMounted) {
          return
        }

        setErrorMessage('Unable to load your saved settings right now.')
        setSaveState('error')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = settings.language
  }, [settings.language])

  useEffect(() => {
    if (saveState !== 'saved') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSaveState((currentValue) => (currentValue === 'saved' ? 'idle' : currentValue))
    }, 1800)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [saveState])

  const updateSettings = useCallback((input: Partial<AppSettings>) => {
    const previousSettings = settingsRef.current
    const shouldDeferRendererCommit = shouldDeferRendererSettingsCommit(input)
    const optimisticSettings = {
      ...previousSettings,
      ...input,
    }
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    settingsRef.current = optimisticSettings
    if (!shouldDeferRendererCommit) {
      setSettings(optimisticSettings)
    }
    setSaveState('saving')
    setErrorMessage(null)

    return window.tidecodeSettings
      .updateSettings(input)
      .then((nextSettings) => {
        if (requestId !== requestIdRef.current) {
          return null
        }

        settingsRef.current = nextSettings
        setSettings(nextSettings)
        setSaveState('saved')
        return nextSettings
      })
      .catch((error) => {
        console.error('Failed to update app settings', error)
        if (requestId !== requestIdRef.current) {
          return null
        }

        settingsRef.current = previousSettings
        if (!shouldDeferRendererCommit) {
          setSettings(previousSettings)
        }
        setSaveState('error')
        setErrorMessage('Unable to save your settings right now.')
        return null
      })
  }, [])

  return {
    errorMessage,
    isLoading,
    saveState,
    settings,
    updateSettings,
  }
}
