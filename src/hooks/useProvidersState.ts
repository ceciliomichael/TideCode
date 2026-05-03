import { useCallback, useEffect, useState } from 'react'
import type { ApiKeyProviderId, ProvidersState, SaveApiKeyProviderInput } from '../types/chat'

type ProvidersOperationKey =
  | null
  | 'codex:add-account'
  | 'codex:connect'
  | 'codex:disconnect'
  | `codex:switch:${string}`
  | `apikey:${ApiKeyProviderId}:remove`
  | `apikey:${ApiKeyProviderId}:save`
  | 'state:load'

interface ProvidersStateModel {
  activeOperation: ProvidersOperationKey
  errorMessage: string | null
  isLoading: boolean
  providersState: ProvidersState | null
}

const DEFAULT_ERROR_MESSAGE = 'Unable to update provider settings right now. Please try again.'

export function useProvidersState() {
  const [state, setState] = useState<ProvidersStateModel>({
    activeOperation: 'state:load',
    errorMessage: null,
    isLoading: true,
    providersState: null,
  })

  const refresh = useCallback(async () => {
    setState((currentValue) => ({
      ...currentValue,
      activeOperation: 'state:load',
      errorMessage: null,
      isLoading: true,
    }))

    try {
      const providersState = await window.echosphereProviders.getProvidersState()
      setState({
        activeOperation: null,
        errorMessage: null,
        isLoading: false,
        providersState,
      })
    } catch (error) {
      console.error('Failed to load provider settings', error)
      setState((currentValue) => ({
        ...currentValue,
        activeOperation: null,
        errorMessage: 'Unable to load provider settings.',
        isLoading: false,
      }))
    }
  }, [])

  const refreshInBackground = useCallback(async () => {
    try {
      const providersState = await window.echosphereProviders.getProvidersState(true)
      setState((currentValue) => ({
        ...currentValue,
        isLoading: currentValue.activeOperation === 'state:load' ? false : currentValue.isLoading,
        providersState,
      }))
    } catch (error) {
      console.error('Failed to refresh provider settings', error)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let backgroundRefreshTimeoutId: number | null = null

    void refresh().finally(() => {
      if (cancelled) {
        return
      }

      backgroundRefreshTimeoutId = window.setTimeout(() => {
        void refreshInBackground()
      }, 250)
    })

    return () => {
      cancelled = true
      if (backgroundRefreshTimeoutId !== null) {
        window.clearTimeout(backgroundRefreshTimeoutId)
      }
    }
  }, [refresh, refreshInBackground])

  useEffect(() => {
    return window.echosphereProviders.onStateChange(() => {
      void refreshInBackground()
    })
  }, [refreshInBackground])

  const runOperation = useCallback(
    async (operationKey: ProvidersOperationKey, operation: () => Promise<ProvidersState>) => {
      setState((currentValue) => ({
        ...currentValue,
        activeOperation: operationKey,
        errorMessage: null,
      }))

      try {
        const providersState = await operation()
        setState({
          activeOperation: null,
          errorMessage: null,
          isLoading: false,
          providersState,
        })
        return true
      } catch (error) {
        console.error('Failed to update provider settings', error)
        const errorMessage = error instanceof Error && error.message.trim().length > 0 ? error.message : DEFAULT_ERROR_MESSAGE
        setState((currentValue) => ({
          ...currentValue,
          activeOperation: null,
          errorMessage,
        }))
        return false
      }
    },
    [],
  )

  const connectCodexWithOAuth = useCallback(async () => {
    return runOperation('codex:connect', () => window.echosphereProviders.connectCodexWithOAuth())
  }, [runOperation])

  const addCodexAccountWithOAuth = useCallback(async () => {
    return runOperation('codex:add-account', () => window.echosphereProviders.addCodexAccountWithOAuth())
  }, [runOperation])

  const disconnectCodex = useCallback(async () => {
    return runOperation('codex:disconnect', () => window.echosphereProviders.disconnectCodex())
  }, [runOperation])

  const switchCodexAccount = useCallback(
    async (accountKey: string) => {
      return runOperation(`codex:switch:${accountKey}`, () => window.echosphereProviders.switchCodexAccount(accountKey))
    },
    [runOperation],
  )

  const saveApiKeyProvider = useCallback(
    async (input: SaveApiKeyProviderInput) => {
      return runOperation(`apikey:${input.providerId}:save`, () => window.echosphereProviders.saveApiKeyProvider(input))
    },
    [runOperation],
  )

  const removeApiKeyProvider = useCallback(
    async (providerId: ApiKeyProviderId) => {
      return runOperation(`apikey:${providerId}:remove`, () => window.echosphereProviders.removeApiKeyProvider(providerId))
    },
    [runOperation],
  )

  return {
    activeOperation: state.activeOperation,
    addCodexAccountWithOAuth,
    connectCodexWithOAuth,
    disconnectCodex,
    errorMessage: state.errorMessage,
    isLoading: state.isLoading,
    providersState: state.providersState,
    refresh,
    refreshInBackground,
    removeApiKeyProvider,
    saveApiKeyProvider,
    switchCodexAccount,
  }
}
