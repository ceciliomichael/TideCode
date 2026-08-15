const TIDECODE_LAUNCH_REQUEST_PREFIX = '--tidecode-launch='
const MAX_PREFILL_TEXT_LENGTH = 4096

const BUILT_IN_CHAT_PROVIDER_IDS = ['codex', 'anthropic', 'deepseek', 'google', 'mistral', 'openai'] as const

export type TideCodeSettingsLaunchRequest =
  | {
      screen: 'settings'
      section: 'models'
      action?: 'add-model'
      providerId?: string
    }
  | {
      screen: 'settings'
      section: 'providers'
      action?: 'add-custom-provider'
      providerName?: string
      baseUrl?: string
      apiKeyHandoffToken?: string
    }

export type TideCodeLaunchRequest = TideCodeSettingsLaunchRequest

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlySupportedKeys(value: Record<string, unknown>) {
  return Object.keys(value).every((key) =>
    key === 'screen' || key === 'section' || key === 'action' || key === 'providerId' ||
    key === 'providerName' || key === 'baseUrl' || key === 'apiKeyHandoffToken')
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PREFILL_TEXT_LENGTH
}

function isChatProviderId(value: unknown): value is string {
  return typeof value === 'string' &&
    (BUILT_IN_CHAT_PROVIDER_IDS.includes(value as typeof BUILT_IN_CHAT_PROVIDER_IDS[number]) ||
      /^custom:[A-Za-z0-9._-]{1,120}$/u.test(value))
}

function isHttpUrl(value: unknown): value is string {
  if (!isBoundedText(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

function isApiKeyHandoffToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/u.test(value)
}

function parseRequest(value: unknown): TideCodeLaunchRequest | null {
  if (!isRecord(value) || !hasOnlySupportedKeys(value) || value.screen !== 'settings') {
    return null
  }

  if (value.section === 'models' && (value.action === undefined || value.action === 'add-model')) {
    if (value.providerName !== undefined || value.baseUrl !== undefined || value.apiKeyHandoffToken !== undefined) return null
    if (value.action === undefined && value.providerId !== undefined) return null
    if (value.providerId !== undefined && !isChatProviderId(value.providerId)) return null
    return {
      screen: 'settings',
      section: 'models',
      ...(value.action ? { action: value.action } : {}),
      ...(value.providerId ? { providerId: value.providerId } : {}),
    }
  }

  if (value.section === 'providers' && (value.action === undefined || value.action === 'add-custom-provider')) {
    if (value.providerId !== undefined) return null
    if (value.action === undefined) {
      if (value.providerName !== undefined || value.baseUrl !== undefined || value.apiKeyHandoffToken !== undefined) return null
      return { screen: 'settings', section: 'providers' }
    }
    if (value.providerName !== undefined && (!isBoundedText(value.providerName) || !value.providerName.trim())) return null
    if (value.baseUrl !== undefined && !isHttpUrl(value.baseUrl)) return null
    if (value.apiKeyHandoffToken !== undefined && !isApiKeyHandoffToken(value.apiKeyHandoffToken)) return null
    return {
      screen: 'settings',
      section: 'providers',
      action: value.action,
      ...(value.providerName ? { providerName: value.providerName } : {}),
      ...(value.baseUrl ? { baseUrl: value.baseUrl } : {}),
      ...(value.apiKeyHandoffToken ? { apiKeyHandoffToken: value.apiKeyHandoffToken } : {}),
    }
  }

  return null
}

export function serializeTideCodeLaunchRequest(request: TideCodeLaunchRequest): string {
  const parsedRequest = parseRequest(request)
  if (!parsedRequest) {
    throw new Error('Unsupported TideCode desktop launch request.')
  }

  return `${TIDECODE_LAUNCH_REQUEST_PREFIX}${encodeURIComponent(JSON.stringify(parsedRequest))}`
}

export function parseTideCodeLaunchRequest(argv: readonly string[]): TideCodeLaunchRequest | null {
  const serializedRequest = argv.find((value) => value.startsWith(TIDECODE_LAUNCH_REQUEST_PREFIX))
  if (!serializedRequest) {
    return null
  }

  try {
    const encodedPayload = serializedRequest.slice(TIDECODE_LAUNCH_REQUEST_PREFIX.length)
    return parseRequest(JSON.parse(decodeURIComponent(encodedPayload)) as unknown)
  } catch {
    return null
  }
}
