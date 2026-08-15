import type { ChatProviderId } from '../../src/types/chat'
import type { TideCodeLaunchRequest } from '../../src/lib/appLaunchRequest'
import {
  readStoredApiKeyProviders,
  type StoredApiKeyProviders,
  toApiKeyProviderStatuses,
} from '../providers/store'
import { getCodexProviderStatus } from '../providers/codex/service'
import { launchTideCodeDesktop } from './desktopAppLaunch'
import { isChatProviderId } from '../providers/providerIds'
import {
  findSystemModel,
  getConfiguredProviderModels,
  getTideCodeSystemModels,
  type SystemModelItem,
} from './models'
import { colors } from './renderer'
import type { SelectItem } from './interactiveSelect'
import type { CliSessionState, SlashCommandHelpers } from './types'

type ModelMenuAction =
  | { kind: 'add' }
  | { kind: 'manage' }
  | { kind: 'use'; model: SystemModelItem }

const MODELS_SETTINGS_REQUEST: TideCodeLaunchRequest = {
  screen: 'settings',
  section: 'models',
}

const PROVIDERS_ADD_REQUEST: TideCodeLaunchRequest = {
  action: 'add-custom-provider',
  screen: 'settings',
  section: 'providers',
}

const MODELS_ADD_REQUEST = {
  action: 'add-model',
  screen: 'settings',
  section: 'models',
} as const

export function getModelAddLaunchRequest(
  hasConfiguredProvider: boolean,
  requestedProviderId?: ChatProviderId,
): TideCodeLaunchRequest {
  if (!hasConfiguredProvider) return PROVIDERS_ADD_REQUEST
  return requestedProviderId ? { ...MODELS_ADD_REQUEST, providerId: requestedProviderId } : MODELS_ADD_REQUEST
}

export function resolveModelAddLaunchRequest(
  availableProviderIds: readonly ChatProviderId[],
  requestedProviderId?: ChatProviderId,
): TideCodeLaunchRequest | null {
  if (requestedProviderId && !availableProviderIds.includes(requestedProviderId)) return null
  return getModelAddLaunchRequest(availableProviderIds.length > 0, requestedProviderId)
}

export function getDesktopCompatibleProviderIds(
  storedProviders: StoredApiKeyProviders,
  codexAuthenticated: boolean,
): ChatProviderId[] {
  const providerIds = toApiKeyProviderStatuses(storedProviders)
    .filter((provider) => provider.configured)
    .map((provider) => provider.id as ChatProviderId)
  if (codexAuthenticated) providerIds.push('codex')
  return providerIds
}

export function isDesktopCompatibleProviderConfigured(
  providerId: ChatProviderId,
  storedProviders: StoredApiKeyProviders,
  codexAuthenticated: boolean,
): boolean {
  return getDesktopCompatibleProviderIds(storedProviders, codexAuthenticated).includes(providerId)
}

async function getDesktopCompatibleProviderIdsFromStore(): Promise<ChatProviderId[]> {
  const [storedProviders, codex] = await Promise.all([
    readStoredApiKeyProviders().catch(() => ({} as StoredApiKeyProviders)),
    getCodexProviderStatus(false).catch(() => ({ isAuthenticated: false })),
  ])
  return getDesktopCompatibleProviderIds(storedProviders, codex.isAuthenticated)
}

function formatModelDescription(model: SystemModelItem): string {
  const details = [model.label]
  if (model.reasoningCapable) details.push('reasoning')
  if (model.supportsImageInput === false) details.push('text-only')
  if (model.isCustom) details.push('custom')
  return details.join(' · ')
}

function modelSelectItem(model: SystemModelItem, state: CliSessionState): SelectItem<ModelMenuAction> {
  const isCurrent = model.apiModelId.toLowerCase() === state.modelId.toLowerCase() &&
    model.providerId.toLowerCase() === state.providerId.toLowerCase()
  return {
    value: { kind: 'use', model },
    label: model.apiModelId,
    description: formatModelDescription(model),
    badge: model.isCustom
      ? `${colors.yellow}[${model.providerLabel}]${colors.reset}`
      : `${colors.cyan}[${model.providerLabel}]${colors.reset}`,
    isCurrent,
  }
}

async function openDesktopSettings(
  request: TideCodeLaunchRequest,
  helpers: SlashCommandHelpers,
  manualPath: string,
): Promise<void> {
  try {
    const result = await launchTideCodeDesktop(request)
    if (!result.ok) {
      helpers.renderWarning(`Could not open TideCode desktop automatically. ${manualPath}`)
    }
  } catch {
    helpers.renderWarning(`Could not open TideCode desktop automatically. ${manualPath}`)
  }
}

async function openModelAddFlow(
  requestedProviderId: ChatProviderId | undefined,
  helpers: SlashCommandHelpers,
): Promise<void> {
  const availableProviderIds = await getDesktopCompatibleProviderIdsFromStore()
  if (requestedProviderId && !availableProviderIds.includes(requestedProviderId)) {
    helpers.renderError(`Provider "${requestedProviderId}" is not configured in desktop Settings → Providers. Configure it there first, then run /model add ${requestedProviderId}.`)
    return
  }

  const request = resolveModelAddLaunchRequest(availableProviderIds, requestedProviderId)
  if (!request) {
    helpers.renderError(`Provider "${requestedProviderId}" is not configured in desktop Settings → Providers. Configure it there first, then retry adding the model.`)
    return
  }
  if (request.section === 'providers') {
    await openDesktopSettings(
      request,
      helpers,
      'Open TideCode desktop Settings → Providers and choose Add custom provider.',
    )
    return
  }

  await openDesktopSettings(
    request,
    helpers,
    'Open TideCode desktop Settings → Models and choose Add model.',
  )
}

function renderModelList(
  snapshot: Awaited<ReturnType<typeof getTideCodeSystemModels>>,
  helpers: SlashCommandHelpers,
): void {
  const models = getConfiguredProviderModels(snapshot)
  if (models.length === 0) {
    helpers.renderWarning('No configured models are available. Use /model add to open desktop model setup.')
    return
  }

  const lines = [`${models.length} configured model${models.length === 1 ? '' : 's'}:`]
  const groups = new Map<string, SystemModelItem[]>()
  for (const model of models) {
    const group = groups.get(model.providerId) ?? []
    group.push(model)
    groups.set(model.providerId, group)
  }
  for (const [providerId, providerModels] of groups) {
    lines.push(`\n${providerModels[0]?.providerLabel ?? providerId}`)
    for (const model of providerModels) {
      lines.push(`  ${model.apiModelId}${model.isCustom ? ' · custom' : ''}${model.reasoningCapable ? ' · reasoning' : ''}${model.supportsImageInput === false ? ' · text-only' : ''}`)
    }
  }
  lines.push('\nAdd or edit custom entries from desktop Settings → Models.')
  helpers.renderInfo(lines.join('\n'))
}

export async function runCliModelCommand(
  args: readonly string[],
  state: CliSessionState,
  helpers: SlashCommandHelpers,
): Promise<void> {
  const normalizedArgs = args.map((arg) => arg.trim()).filter(Boolean)
  const action = normalizedArgs[0]?.toLowerCase()
  const snapshot = await getTideCodeSystemModels()

  if (action === 'list') {
    renderModelList(snapshot, helpers)
    return
  }

  if (action === 'add' || action === 'new') {
    const requestedProvider = normalizedArgs[1]
    if (requestedProvider && !isChatProviderId(requestedProvider)) {
      helpers.renderError(`Unknown provider "${requestedProvider}". Use /model add [providerId].`)
      return
    }
    await openModelAddFlow(requestedProvider as ChatProviderId | undefined, helpers)
    return
  }

  if (action === 'edit' || action === 'remove' || action === 'delete') {
    await openDesktopSettings(
      MODELS_SETTINGS_REQUEST,
      helpers,
      'Open TideCode desktop Settings → Models to edit or remove custom models.',
    )
    return
  }

  if (action === 'help') {
    helpers.renderInfo([
      '/model                 Browse configured models',
      '/model <id> [provider]  Switch immediately',
      '/model add [provider]    Open desktop model setup with provider selected',
      '/model edit <id>        Open desktop model management',
      '/model remove <id>      Open desktop model management',
      '/model list             Print the configured catalog',
    ].join('\n'))
    return
  }

  const selectableModels = getConfiguredProviderModels(snapshot)
  if (action) {
    const match = findSystemModel(selectableModels, normalizedArgs[0], normalizedArgs[1])
    if (!match) {
      helpers.renderError(`Model "${normalizedArgs[0]}" was not found among configured providers.`)
      return
    }
    await helpers.switchModel(match.apiModelId, match.providerId)
    return
  }

  const items: SelectItem<ModelMenuAction>[] = [
    {
      value: { kind: 'add' },
      label: '+ Add model in desktop app',
      description: 'Open Settings with the Add model dialog ready to fill in',
      badge: `${colors.success}[setup]${colors.reset}`,
    },
    {
      value: { kind: 'manage' },
      label: 'Manage models in desktop app',
      description: 'Open desktop Settings → Models to edit or remove custom models',
      badge: `${colors.yellow}[desktop]${colors.reset}`,
    },
    ...selectableModels.map((model) => modelSelectItem(model, state)),
  ]

  const currentIndex = items.findIndex((item) =>
    item.value.kind === 'use' &&
    item.value.model.apiModelId.toLowerCase() === state.modelId.toLowerCase() &&
    item.value.model.providerId === state.providerId,
  )
  const selected = await helpers.select<ModelMenuAction>({
    title: 'TideCode Models',
    items,
    initialIndex: currentIndex >= 0 ? currentIndex : 0,
    pageSize: 8,
    footer: 'Enter use/open · /model add opens desktop setup · Esc closes',
  })
  if (!selected) return

  if (selected.kind === 'add') {
    await openModelAddFlow(undefined, helpers)
  } else if (selected.kind === 'manage') {
    await openDesktopSettings(
      MODELS_SETTINGS_REQUEST,
      helpers,
      'Open TideCode desktop Settings → Models to manage custom models.',
    )
  } else {
    await helpers.switchModel(selected.model.apiModelId, selected.model.providerId)
  }
}
