import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_APP_SETTINGS } from '../lib/defaultAppSettings'
import { resetLaunchOnlyAppSettings } from './appSettingsLaunchState'
import { getCachedAppearancePreference } from '../lib/theme'
import { preserveLocalSurfaceSettings } from '../lib/appSettingsScopes'
import type { AppSettings } from '../types/chat'
import { shouldDeferRendererSettingsCommit } from './appSettingsUpdatePolicy'

export type AppSettingsSaveState = 'idle' | 'saving' | 'saved' | 'error'

interface PendingSettingsUpdate {
  deferRendererCommit: boolean
  input: Partial<AppSettings>
}

export function applyPendingSettingsUpdates(
  baseSettings: AppSettings,
  pendingUpdates: Iterable<PendingSettingsUpdate>,
) {
  let nextSettings = baseSettings
  for (const pendingUpdate of pendingUpdates) {
    if (pendingUpdate.deferRendererCommit) continue
    nextSettings = {
      ...nextSettings,
      ...pendingUpdate.input,
    }
  }
  return nextSettings
}

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
  const canonicalSettingsRef = useRef<AppSettings>(initialSettings)
  const pendingUpdatesRef = useRef(new Map<number, PendingSettingsUpdate>())
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

        canonicalSettingsRef.current = nextSettings
        const visibleSettings = applyPendingSettingsUpdates(nextSettings, pendingUpdatesRef.current.values())
        settingsRef.current = visibleSettings
        setSettings(visibleSettings)
        setErrorMessage(null)
        setSaveState(pendingUpdatesRef.current.size > 0 ? 'saving' : 'idle')
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
    return window.tidecodeSettings.onRemoteChange((nextSettings) => {
      const normalizedSettings = resetLaunchOnlyAppSettings(nextSettings)
      const mergedSettings = preserveLocalSurfaceSettings(normalizedSettings, settingsRef.current)
      canonicalSettingsRef.current = mergedSettings
      const visibleSettings = applyPendingSettingsUpdates(mergedSettings, pendingUpdatesRef.current.values())
      settingsRef.current = visibleSettings
      setSettings(visibleSettings)
      setErrorMessage(null)
      setSaveState(pendingUpdatesRef.current.size > 0 ? 'saving' : 'idle')
    })
  }, [])

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
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const pendingUpdate: PendingSettingsUpdate = {
      deferRendererCommit: shouldDeferRendererSettingsCommit(input),
      input,
    }
    pendingUpdatesRef.current.set(requestId, pendingUpdate)

    const optimisticSettings = applyPendingSettingsUpdates(
      canonicalSettingsRef.current,
      pendingUpdatesRef.current.values(),
    )
    settingsRef.current = optimisticSettings
    if (!pendingUpdate.deferRendererCommit) {
      setSettings(optimisticSettings)
    }
    setSaveState('saving')
    setErrorMessage(null)

    return window.tidecodeSettings
      .updateSettings(input)
      .then((nextSettings) => {
        const localSettingsAtCommit = {
          ...settingsRef.current,
          ...input,
        }
        pendingUpdatesRef.current.delete(requestId)
        const normalizedSettings = resetLaunchOnlyAppSettings(nextSettings)
        const mergedSettings = preserveLocalSurfaceSettings(normalizedSettings, localSettingsAtCommit)
        canonicalSettingsRef.current = mergedSettings
        const visibleSettings = applyPendingSettingsUpdates(
          mergedSettings,
          pendingUpdatesRef.current.values(),
        )
        settingsRef.current = visibleSettings
        setSettings(visibleSettings)
        setSaveState(pendingUpdatesRef.current.size > 0 ? 'saving' : 'saved')
        return mergedSettings
      })
      .catch((error) => {
        console.error('Failed to update app settings', error)
        pendingUpdatesRef.current.delete(requestId)
        const visibleSettings = applyPendingSettingsUpdates(
          canonicalSettingsRef.current,
          pendingUpdatesRef.current.values(),
        )
        settingsRef.current = visibleSettings
        setSettings(visibleSettings)
        setSaveState(pendingUpdatesRef.current.size > 0 ? 'saving' : 'error')
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
