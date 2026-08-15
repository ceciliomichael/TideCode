import { randomUUID } from 'node:crypto'
import type { ApiKeyProviderId, ApiKeyProviderStatus, ChatProviderId } from '../../src/types/chat'
import type { TideCodeLaunchRequest } from '../../src/lib/appLaunchRequest'
import { getCodexProviderStatus } from '../providers/codex/service'
import { isApiKeyProviderId, isCustomApiKeyProviderId } from '../providers/providerIds'
import { parseExtraBody } from '../providers/extraBody'
import {
  readStoredApiKeyProviders,
  removeApiKeyProviderConfig,
  saveApiKeyProviderConfig,
  toApiKeyProviderStatuses,
  PROVIDER_LABELS,
} from '../providers/store'
import { getTideCodeSystemModels } from './models'
import { launchTideCodeDesktop } from './desktopAppLaunch'
import { colors } from './renderer'
import type { SelectItem } from './interactiveSelect'
import type { CliSessionState, SlashCommandHelpers } from './types'

type ProviderMenuAction =
  | { kind: 'provider'; providerId: ChatProviderId }
  | { kind: 'add-custom' }

interface ProviderSnapshot {
  statuses: ApiKeyProviderStatus[]
  codexConnected: boolean
}

const CUSTOM_PROVIDER_DEFAULT_URL = 'http://localhost:1234/v1'

function providerLabel(providerId: string, customLabel?: string): string {
  if (customLabel) return customLabel
  if (providerId === 'codex') return 'Codex'
  return PROVIDER_LABELS[providerId as keyof typeof PROVIDER_LABELS] ?? providerId
}

function isJsonObject(value: string): string | undefined {
  if (!value.trim()) return undefined
  try {
    const parsed = parseExtraBody(value)
    if (Object.keys(parsed).length === 0) return 'Enter a non-empty JSON object or leave this field blank.'
    return undefined
  } catch {
    return 'Enter valid JSON in object form, for example {"temperature":0.2}.'
  }
}

function providerStatusDescription(status: ApiKeyProviderStatus): string {
  if (!status.configured) return 'Not configured · Enter to set up'
  if (status.isCustom) return `${status.baseUrl ?? 'Custom endpoint'} · Enter to manage`
  return 'Configured locally · Enter to manage'
}

async function readProviderSnapshot(): Promise<ProviderSnapshot> {
  const [storedProviders, codex] = await Promise.all([
    readStoredApiKeyProviders(),
    getCodexProviderStatus(false).catch(() => ({ isAuthenticated: false })),
  ])
  return {
    statuses: toApiKeyProviderStatuses(storedProviders),
    codexConnected: codex.isAuthenticated,
  }
}

function findProviderStatus(snapshot: ProviderSnapshot, providerId: ApiKeyProviderId) {
  return snapshot.statuses.find((status) => status.id === providerId)
}

function listProviderItems(snapshot: ProviderSnapshot, state: CliSessionState): SelectItem<ProviderMenuAction>[] {
  const items: SelectItem<ProviderMenuAction>[] = snapshot.statuses.map((status) => ({
    value: { kind: 'provider', providerId: status.id },
    label: status.label,
    description: providerStatusDescription(status),
    badge: `${status.configured ? colors.success : colors.subtle}[${status.configured ? 'ready' : 'setup'}]${colors.reset}`,
    isCurrent: state.providerId === status.id,
  }))

  items.unshift({
    value: { kind: 'add-custom' },
    label: '+ Add custom OpenAI-compatible provider',
    description: 'Connect Ollama, LM Studio, OpenRouter, vLLM, or another compatible endpoint',
  })

  if (snapshot.codexConnected) {
    items.push({
      value: { kind: 'provider', providerId: 'codex' },
      label: 'Codex',
      description: 'ChatGPT account connected · Enter to use',
      badge: `${colors.success}[ready]${colors.reset}`,
      isCurrent: state.providerId === 'codex',
    })
  } else {
    items.push({
      value: { kind: 'provider', providerId: 'codex' },
      label: 'Codex',
      description: 'Connect from desktop Settings → Providers',
      badge: `${colors.subtle}[not connected]${colors.reset}`,
      isCurrent: state.providerId === 'codex',
    })
  }

  return items
}

async function promptJsonObject(
  helpers: SlashCommandHelpers,
  title: string,
  initialValue = '',
  footer = 'Optional · JSON object is sent with requests',
): Promise<string | null> {
  return helpers.input({
    title,
    label: 'JSON',
    initialValue,
    placeholder: 'leave blank for none',
    footer,
    validate: isJsonObject,
  })
}

async function configureProvider(
  providerId: ApiKeyProviderId | null,
  existing: ApiKeyProviderStatus | undefined,
  helpers: SlashCommandHelpers,
): Promise<ApiKeyProviderId | null> {
  const isCustom = providerId === null || isCustomApiKeyProviderId(providerId)
  const nextProviderId = providerId ?? `custom:${randomUUID()}`
  const label = isCustom
    ? await helpers.input({
        title: existing ? `Edit ${existing.label}` : 'Add custom provider',
        label: 'Name',
        initialValue: existing?.label ?? '',
        placeholder: 'My inference server',
        footer: 'A friendly name shown in /provider and /model',
        validate: (value) => value.trim() ? undefined : 'Provider name is required.',
      })
    : existing?.label ?? providerLabel(nextProviderId)
  if (label === null) return null

  const apiKey = await helpers.input({
    title: `Configure ${label}`,
    label: 'API key',
    secret: true,
    placeholder: existing?.hasApiKey ? 'stored locally · leave blank to keep it' : 'paste API key (optional for custom endpoints)',
    footer: 'The key is saved locally and never printed',
  })
  if (apiKey === null) return null

  const baseUrl = isCustom
    ? await helpers.input({
        title: `Configure ${label}`,
        label: 'Base URL',
        initialValue: existing?.baseUrl ?? CUSTOM_PROVIDER_DEFAULT_URL,
        placeholder: CUSTOM_PROVIDER_DEFAULT_URL,
        footer: 'Must use http:// or https:// · /v1 is added when required',
        validate: (value) => {
          try {
            const parsed = new URL(value.trim())
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Base URL must use http or https.'
            if (parsed.username || parsed.password) return 'Base URL cannot contain embedded credentials.'
            return undefined
          } catch {
            return 'Enter a valid absolute base URL.'
          }
        },
      })
    : ''
  if (baseUrl === null) return null

  const extraBody = isCustom
    ? await promptJsonObject(helpers, `Configure ${label}`, existing?.extraBody ?? '', 'Optional provider-level JSON request settings')
    : ''
  if (extraBody === null) return null

  try {
    await saveApiKeyProviderConfig({
      apiKey,
      baseUrl,
      ...(isCustom ? { extraBody, label: label.trim() } : {}),
      providerId: nextProviderId,
    })
    helpers.renderSuccess(`${label.trim()} is saved locally.`)
    if (isCustom) helpers.renderInfo(`Add its models from desktop Settings → Models, then activate it with /provider ${nextProviderId}.`)
    return nextProviderId
  } catch (error) {
    helpers.renderError(`Could not save provider: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function activateProvider(
  providerId: ChatProviderId,
  state: CliSessionState,
  helpers: SlashCommandHelpers,
): Promise<void> {
  const snapshot = await getTideCodeSystemModels()
  const models = snapshot.configuredModels.filter((model) => model.providerId === providerId)
  if (models.length === 0) {
    if (providerId === 'codex') {
      helpers.renderWarning('Codex is not connected. Connect it from desktop Settings → Providers first.')
    } else {
      helpers.renderWarning(`No configured models found for ${providerLabel(providerId)}. Use /model add to open desktop model setup.`)
    }
    return
  }

  const current = models.find((model) => model.apiModelId.toLowerCase() === state.modelId.toLowerCase())
  if (current) {
    await helpers.switchModel(current.apiModelId, providerId)
    return
  }
  if (models.length === 1) {
    await helpers.switchModel(models[0].apiModelId, providerId)
    return
  }

  const selected = await helpers.select<string>({
    title: `Choose a ${providerLabel(providerId)} model`,
    items: models.map((model) => ({
      value: model.apiModelId,
      label: model.apiModelId,
      description: `${model.label}${model.reasoningCapable ? ' · reasoning' : ''}${model.isCustom ? ' · custom' : ''}`,
    })),
    pageSize: 8,
    footer: 'The selected model becomes active immediately',
  })
  if (selected) await helpers.switchModel(selected, providerId)
}

async function manageProvider(
  providerId: ChatProviderId,
  state: CliSessionState,
  helpers: SlashCommandHelpers,
): Promise<void> {
  if (providerId === 'codex') {
    const snapshot = await readProviderSnapshot()
    if (!snapshot.codexConnected) {
      helpers.renderInfo('Codex setup is available from desktop Settings → Providers.')
      return
    }
    await activateProvider('codex', state, helpers)
    return
  }
  const snapshot = await readProviderSnapshot()
  const status = findProviderStatus(snapshot, providerId)
  if (!status) {
    helpers.renderInfo('Codex setup is available from desktop Settings → Providers.')
    if (snapshot.codexConnected) await activateProvider('codex', state, helpers)
    return
  }

  const actions: SelectItem<'use' | 'configure' | 'remove'>[] = [
    {
      value: 'use',
      label: 'Use this provider',
      description: 'Choose one of its configured models and make it active',
      isCurrent: state.providerId === providerId,
    },
    {
      value: 'configure',
      label: status.configured ? 'Edit provider credentials' : 'Set up provider',
      description: status.isCustom ? 'Name, API key, base URL, and request defaults' : 'Save or replace the local API key',
    },
  ]
  if (status.configured) {
    actions.push({
      value: 'remove',
      label: status.isCustom ? 'Remove provider' : 'Clear saved API key',
      description: status.isCustom ? 'Remove this endpoint from TideCode' : 'Remove only the locally stored key',
    })
  }

  const action = await helpers.select<'use' | 'configure' | 'remove'>({
    title: providerLabel(providerId, status.label),
    items: actions,
    pageSize: 5,
  })
  if (!action) return

  if (action === 'use') {
    await activateProvider(providerId, state, helpers)
    return
  }
  if (action === 'configure') {
    await configureProvider(providerId, status, helpers)
    return
  }

  const confirmed = await helpers.confirm(`Remove ${status.label} from TideCode?`, false)
  if (!confirmed) return
  try {
    await removeApiKeyProviderConfig(providerId)
    helpers.renderSuccess(`${status.label} was removed.`)
  } catch (error) {
    helpers.renderError(`Could not remove provider: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function renderProviderList(snapshot: ProviderSnapshot, helpers: SlashCommandHelpers): void {
  const lines = snapshot.statuses.map((status) =>
    `${status.label} · ${status.configured ? 'ready' : 'not configured'}${status.isCustom && status.baseUrl ? ` · ${status.baseUrl}` : ''}`,
  )
  lines.push(`Codex · ${snapshot.codexConnected ? 'ready' : 'not connected'}`)
  helpers.renderInfo(lines.join('\n'))
}

export interface ProviderAddLaunchInput {
  apiKey?: string
  request: TideCodeLaunchRequest
}

export function buildProviderAddLaunchRequest(args: readonly string[]): ProviderAddLaunchInput | null {
  if (args.length > 3) return null

  const [providerName, baseUrl, apiKey] = args
  if (baseUrl) {
    try {
      const parsedUrl = new URL(baseUrl)
      if ((parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') || parsedUrl.username || parsedUrl.password) {
        return null
      }
    } catch {
      return null
    }
  }

  return {
    ...(apiKey?.trim() ? { apiKey } : {}),
    request: {
      action: 'add-custom-provider',
      screen: 'settings',
      section: 'providers',
      ...(providerName ? { providerName } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    },
  }
}

async function openDesktopProviderAddFlow(
  args: readonly string[],
  helpers: SlashCommandHelpers,
): Promise<void> {
  const launchInput = buildProviderAddLaunchRequest(args)
  if (!launchInput) {
    helpers.renderError('Usage: /provider add [name] [api base url] [api key]')
    return
  }

  try {
    const result = await launchTideCodeDesktop(launchInput.request, { apiKey: launchInput.apiKey })
    if (!result.ok) {
      helpers.renderWarning('Could not open TideCode desktop automatically. Open Settings → Providers and choose Add custom provider.')
    }
  } catch {
    helpers.renderError('Could not prepare the custom provider setup. Check the API base URL and try again.')
  }
}

export async function runCliProviderCommand(
  args: readonly string[],
  state: CliSessionState,
  helpers: SlashCommandHelpers,
): Promise<void> {
  const normalizedArgs = args.map((arg) => arg.trim()).filter(Boolean)
  const action = normalizedArgs[0]?.toLowerCase()

  if (action === 'list') {
    renderProviderList(await readProviderSnapshot(), helpers)
    return
  }
  if (action === 'add' || action === 'new') {
    await openDesktopProviderAddFlow(normalizedArgs.slice(1), helpers)
    return
  }
  if (action === 'setup' || action === 'edit') {
    const requestedId = normalizedArgs[1]
    if (requestedId && isApiKeyProviderId(requestedId)) {
      const snapshot = await readProviderSnapshot()
      await configureProvider(requestedId, findProviderStatus(snapshot, requestedId), helpers)
      return
    }
    helpers.renderError('Usage: /provider setup <providerId> or use /provider interactively.')
    return
  }
  if (action === 'remove' || action === 'delete') {
    const requestedId = normalizedArgs[1]
    if (!requestedId || !isApiKeyProviderId(requestedId)) {
      helpers.renderError('Usage: /provider remove <custom:providerId>.')
      return
    }
    const snapshot = await readProviderSnapshot()
    const status = findProviderStatus(snapshot, requestedId)
    if (!status) {
      helpers.renderWarning(`Provider ${requestedId} is not configured.`)
      return
    }
    const confirmed = await helpers.confirm(`Remove ${status.label} from TideCode?`, false)
    if (!confirmed) return
    try {
      await removeApiKeyProviderConfig(requestedId)
      helpers.renderSuccess(`${status.label} was removed.`)
    } catch (error) {
      helpers.renderError(`Could not remove provider: ${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }
  if (action && (action === 'codex' || isApiKeyProviderId(action))) {
    await manageProvider(action as ChatProviderId, state, helpers)
    return
  }
  if (action) {
    helpers.renderError(`Unknown provider "${normalizedArgs[0]}". Use /provider list or /provider.`)
    return
  }

  const snapshot = await readProviderSnapshot()
  const selected = await helpers.select<ProviderMenuAction>({
    title: 'TideCode Providers',
    items: listProviderItems(snapshot, state),
    initialIndex: 0,
    pageSize: 8,
    footer: 'Enter manage · /model add opens desktop model setup · Esc closes',
  })
  if (!selected) return
  if (selected.kind === 'add-custom') {
    await openDesktopProviderAddFlow([], helpers)
    return
  }
  await manageProvider(selected.providerId, state, helpers)
}
