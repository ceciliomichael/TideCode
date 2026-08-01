import { useCallback, useEffect, useState } from 'react'
import type { ApiKeyProviderId, ProvidersState, SaveApiKeyProviderInput } from '../types/chat'
import { applyOptimisticProviderRemoval, applyOptimisticProviderSave } from './providerOptimisticState'

type ProvidersOperationKey =
  | null
  | 'codex:add-account'
  | 'codex:connect'
  | 'codex:disconnect'
  | `codex:switch:${string}`
  | `codex:remove-account:${string}`
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
      const providersState = await window.tidecodeProviders.getProvidersState()
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
      const providersState = await window.tidecodeProviders.getProvidersState(true)
      setState((currentValue) => ({
        ...currentValue,
        isLoading: currentValue.activeOperation === 'state:load' ? false : currentValue.isLoading,
        providersState,
      }))
    } catch (error) {
      console.error('Failed to refresh provider settings', error)
    }
  }, [])

  const syncCachedState = useCallback(async () => {
    try {
      const providersState = await window.tidecodeProviders.getProvidersState()
      setState((currentValue) => ({
        ...currentValue,
        providersState,
      }))
    } catch (error) {
      console.error('Failed to synchronize provider settings', error)
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
    return window.tidecodeProviders.onStateChange(() => {
      void syncCachedState()
    })
  }, [syncCachedState])

  const runOperation = useCallback(
    async (
      operationKey: ProvidersOperationKey,
      operation: () => Promise<ProvidersState>,
      optimisticUpdate?: (providersState: ProvidersState | null) => ProvidersState | null,
    ) => {
      let previousProvidersState: ProvidersState | null = null
      setState((currentValue) => ({
          ...currentValue,
          activeOperation: operationKey,
          errorMessage: null,
          providersState: (() => {
            previousProvidersState = currentValue.providersState
            return optimisticUpdate?.(currentValue.providersState) ?? currentValue.providersState
          })(),
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
          providersState: previousProvidersState,
        }))
        return false
      }
    },
    [],
  )

  const connectCodexWithOAuth = useCallback(async () => {
    return runOperation('codex:connect', () => window.tidecodeProviders.connectCodexWithOAuth())
  }, [runOperation])

  const addCodexAccountWithOAuth = useCallback(async () => {
    return runOperation('codex:add-account', () => window.tidecodeProviders.addCodexAccountWithOAuth())
  }, [runOperation])

  const disconnectCodex = useCallback(async () => {
    return runOperation('codex:disconnect', () => window.tidecodeProviders.disconnectCodex())
  }, [runOperation])

  const switchCodexAccount = useCallback(
    async (accountKey: string) => {
      return runOperation(`codex:switch:${accountKey}`, () => window.tidecodeProviders.switchCodexAccount(accountKey))
    },
    [runOperation],
  )

  const removeCodexAccount = useCallback(
    async (accountKey: string) => {
      return runOperation(`codex:remove-account:${accountKey}`, () => window.tidecodeProviders.removeCodexAccount(accountKey))
    },
    [runOperation],
  )

  const saveApiKeyProvider = useCallback(
    async (input: SaveApiKeyProviderInput) => {
      return runOperation(
        `apikey:${input.providerId}:save`,
        () => window.tidecodeProviders.saveApiKeyProvider(input),
        (providersState) => applyOptimisticProviderSave(providersState, input),
      )
    },
    [runOperation],
  )

  const removeApiKeyProvider = useCallback(
    async (providerId: ApiKeyProviderId) => {
      return runOperation(
        `apikey:${providerId}:remove`,
        () => window.tidecodeProviders.removeApiKeyProvider(providerId),
        (providersState) => applyOptimisticProviderRemoval(providersState, providerId),
      )
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
    removeCodexAccount,
    saveApiKeyProvider,
    switchCodexAccount,
  }
}
