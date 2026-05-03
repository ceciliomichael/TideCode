import type { ApiKeyProviderId, ProvidersState, SaveApiKeyProviderInput } from '../../src/types/chat'
import {
  addCodexAccountProviderWithOAuth,
  connectCodexProviderWithOAuth,
  disconnectCodexProvider,
  getCodexProviderStatus,
  switchCodexAccount as switchStoredCodexAccount,
} from './codex/service'
import {
  readStoredApiKeyProviders,
  removeApiKeyProviderConfig,
  saveApiKeyProviderConfig,
  toApiKeyProviderStatuses,
} from './store'
import { emitProvidersStateChanged } from './events'

const PROVIDERS_CACHE_TTL_MS = 25_000

let cachedProvidersState: ProvidersState | null = null
let cachedProvidersStateAt = 0
let providersStateRefreshPromise: Promise<ProvidersState> | null = null
let providersStateHydrationPromise: Promise<ProvidersState> | null = null

function isProvidersStateCacheFresh() {
  if (!cachedProvidersState) {
    return false
  }

  return Date.now() - cachedProvidersStateAt <= PROVIDERS_CACHE_TTL_MS
}

async function rebuildProvidersStateCache(hydrate = false) {
  if (hydrate) {
    if (providersStateHydrationPromise) {
      return providersStateHydrationPromise
    }

    providersStateHydrationPromise = buildProvidersState(true)
      .then((nextState) => {
        cachedProvidersState = nextState
        cachedProvidersStateAt = Date.now()
        emitProvidersStateChanged()
        return nextState
      })
      .finally(() => {
        providersStateHydrationPromise = null
      })

    return providersStateHydrationPromise
  }

  if (providersStateRefreshPromise) {
    return providersStateRefreshPromise
  }

  providersStateRefreshPromise = buildProvidersState(false)
    .then((nextState) => {
      cachedProvidersState = nextState
      cachedProvidersStateAt = Date.now()
      emitProvidersStateChanged()
      return nextState
    })
    .finally(() => {
      providersStateRefreshPromise = null
    })

  return providersStateRefreshPromise
}

export async function initializeProvidersState() {
  if (cachedProvidersState) {
    return
  }

  await rebuildProvidersStateCache(false)
}

export async function getProvidersState(hydrate = false) {
  if (hydrate) {
    return rebuildProvidersStateCache(true)
  }

  if (isProvidersStateCacheFresh()) {
    return cachedProvidersState
  }

  return rebuildProvidersStateCache(false)
}

async function refreshProvidersCache(hydrate = false) {
  return rebuildProvidersStateCache(hydrate)
}

async function buildProvidersState(hydrate = false): Promise<ProvidersState> {
  const storedApiKeyProviders = await readStoredApiKeyProviders()
  const codex = await getCodexProviderStatus(hydrate)

  return {
    apiKeyProviders: toApiKeyProviderStatuses(storedApiKeyProviders),
    codex,
  }
}

export async function connectCodexWithOAuth(openExternal: (url: string) => Promise<void>) {
  await connectCodexProviderWithOAuth(openExternal)
  return refreshProvidersCache()
}

export async function addCodexAccountWithOAuth(openExternal: (url: string) => Promise<void>) {
  await addCodexAccountProviderWithOAuth(openExternal)
  return refreshProvidersCache()
}

export async function disconnectCodex() {
  await disconnectCodexProvider()
  return refreshProvidersCache()
}

export async function switchCodexAccount(accountKey: string) {
  await switchStoredCodexAccount(accountKey)
  return refreshProvidersCache(true)
}

export async function saveApiKeyProvider(input: SaveApiKeyProviderInput) {
  await saveApiKeyProviderConfig(input)
  return refreshProvidersCache()
}

export async function removeApiKeyProvider(providerId: ApiKeyProviderId) {
  await removeApiKeyProviderConfig(providerId)
  return refreshProvidersCache()
}
