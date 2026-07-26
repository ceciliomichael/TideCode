import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '../../src/types/chat'
import { DEFAULT_APP_SETTINGS } from '../../src/lib/defaultAppSettings'
import { isAppAppearance, isAppLanguage, isFollowUpBehavior } from '../../src/lib/appSettings'
import { clampStoredDiffPanelWidth } from '../../src/lib/diffPanelSizing'
import { clampStoredTerminalPanelHeight } from '../../src/lib/terminalPanelSizing'
import { isReasoningEffort } from '../../src/lib/reasoningEffort'
import { hasLaunchOnlyAppSettings, resetLaunchOnlyAppSettings } from '../../src/hooks/appSettingsLaunchState'
import { clampStoredWorkspaceEditorWidth } from '../../src/lib/workspaceEditorSizing'
import { clampStoredWorkspaceExplorerWidth } from '../../src/lib/workspaceExplorerSizing'
import type { SourceControlSectionId } from '../../src/types/chat'
import { electronApp } from '../electronApp'
import { writeJsonFileAtomic } from './fileStore'
import { isChatProviderId as isSupportedChatProviderId } from '../providers/providerIds'

const CONFIG_ROOT_SEGMENTS = ['.echosphere', 'config'] as const
const SETTINGS_FILE_NAME = 'settings.json'
const WORKSPACE_UI_STATE_FILE_NAME = 'workspace-ui-state.json'
const SETTINGS_HOME_OVERRIDE_ENV = 'ECHOSPHERE_SETTINGS_HOME'
let settingsUpdateQueue: Promise<void> = Promise.resolve()
let cachedStoredSettings: AppSettings | null = null
const SOURCE_CONTROL_SECTION_IDS: readonly SourceControlSectionId[] = ['commit', 'changes', 'history']
const WORKSPACE_UI_SETTINGS_KEYS = [
  'conversationModelPreferences',
  'diffPanelWidth',
  'editSessionsByConversation',
  'lastActiveConversationId',
  'lastActiveDraftFolderId',
  'openEmptyConversationOnLaunch',
  'revertEditSessionsByConversation',
  'sidebarWidth',
  'workspaceEditorWidth',
  'workspaceExplorerWidth',
  'sourceControlSectionOrder',
  'sourceControlSectionOpen',
  'sourceControlSectionSizes',
  'terminalOpenByWorkspace',
  'terminalPanelHeightsByWorkspace',
] as const satisfies readonly (keyof AppSettings)[]

type WorkspaceUiSettingsKey = (typeof WORKSPACE_UI_SETTINGS_KEYS)[number]
type WorkspaceUiSettings = Pick<AppSettings, WorkspaceUiSettingsKey>
type DurableAppSettings = Omit<AppSettings, WorkspaceUiSettingsKey>

const WORKSPACE_UI_SETTINGS_KEY_SET = new Set<keyof AppSettings>(WORKSPACE_UI_SETTINGS_KEYS)

function isChatProviderId(value: unknown): value is AppSettings['chatModelProviderId'] {
  return value === null || isSupportedChatProviderId(value)
}

function isAppTerminalExecutionMode(value: unknown): value is AppSettings['terminalExecutionMode'] {
  return value === 'sandbox' || value === 'full'
}

function isSourceControlSectionId(value: string): value is SourceControlSectionId {
  return SOURCE_CONTROL_SECTION_IDS.includes(value as SourceControlSectionId)
}

function sanitizeSourceControlSectionOrder(value: unknown): SourceControlSectionId[] {
  if (!Array.isArray(value)) {
    return DEFAULT_APP_SETTINGS.sourceControlSectionOrder
  }

  const filtered = value
    .map((item) => (typeof item === 'string' ? item : ''))
    .filter((item): item is SourceControlSectionId => isSourceControlSectionId(item))

  const unique = Array.from(new Set(filtered))
  for (const sectionId of SOURCE_CONTROL_SECTION_IDS) {
    if (!unique.includes(sectionId)) {
      unique.push(sectionId)
    }
  }

  return unique
}

function sanitizeSourceControlSectionSizes(value: unknown): Record<SourceControlSectionId, number> {
  const candidate = value as Partial<Record<SourceControlSectionId, number>> | null | undefined
  return {
    changes:
      typeof candidate?.changes === 'number' && Number.isFinite(candidate.changes) && candidate.changes > 0
        ? candidate.changes
        : DEFAULT_APP_SETTINGS.sourceControlSectionSizes.changes,
    commit:
      typeof candidate?.commit === 'number' && Number.isFinite(candidate.commit) && candidate.commit > 0
        ? candidate.commit
        : DEFAULT_APP_SETTINGS.sourceControlSectionSizes.commit,
    history:
      typeof candidate?.history === 'number' && Number.isFinite(candidate.history) && candidate.history > 0
        ? candidate.history
        : DEFAULT_APP_SETTINGS.sourceControlSectionSizes.history,
  }
}

function sanitizeSourceControlSectionOpen(value: unknown) {
  const candidate = value as Partial<Record<'commit' | 'changes' | 'history' | 'staged' | 'unstaged', boolean>> | null | undefined
  return {
    changes:
      typeof candidate?.changes === 'boolean'
        ? candidate.changes
        : DEFAULT_APP_SETTINGS.sourceControlSectionOpen.changes,
    commit:
      typeof candidate?.commit === 'boolean'
        ? candidate.commit
        : DEFAULT_APP_SETTINGS.sourceControlSectionOpen.commit,
    history:
      typeof candidate?.history === 'boolean'
        ? candidate.history
        : DEFAULT_APP_SETTINGS.sourceControlSectionOpen.history,
    staged:
      typeof candidate?.staged === 'boolean'
        ? candidate.staged
        : DEFAULT_APP_SETTINGS.sourceControlSectionOpen.staged,
    unstaged:
      typeof candidate?.unstaged === 'boolean'
        ? candidate.unstaged
        : DEFAULT_APP_SETTINGS.sourceControlSectionOpen.unstaged,
  }
}

function sanitizeTerminalOpenByWorkspace(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APP_SETTINGS.terminalOpenByWorkspace }
  }

  const candidateEntries = Object.entries(value as Record<string, unknown>)
  const sanitizedValue: Record<string, boolean> = {}
  for (const [workspaceKey, workspaceIsOpen] of candidateEntries) {
    const normalizedWorkspaceKey = workspaceKey.trim()
    if (normalizedWorkspaceKey.length === 0 || typeof workspaceIsOpen !== 'boolean') {
      continue
    }

    sanitizedValue[normalizedWorkspaceKey] = workspaceIsOpen
  }

  return sanitizedValue
}

function sanitizeTerminalPanelHeightsByWorkspace(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APP_SETTINGS.terminalPanelHeightsByWorkspace }
  }

  const candidateEntries = Object.entries(value as Record<string, unknown>)
  const sanitizedValue: Record<string, number> = {}
  for (const [workspaceKey, workspacePanelHeight] of candidateEntries) {
    const normalizedWorkspaceKey = workspaceKey.trim()
    if (normalizedWorkspaceKey.length === 0 || typeof workspacePanelHeight !== 'number') {
      continue
    }

    sanitizedValue[normalizedWorkspaceKey] = clampStoredTerminalPanelHeight(workspacePanelHeight)
  }

  return sanitizedValue
}

function sanitizeConversationModelPreferences(value: unknown): AppSettings['conversationModelPreferences'] {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const candidateEntries = Object.entries(value as Record<string, unknown>)
  const sanitizedValue: AppSettings['conversationModelPreferences'] = {}

  for (const [conversationId, candidatePreference] of candidateEntries) {
    const normalizedId = conversationId.trim()
    if (
      normalizedId.length === 0 ||
      !candidatePreference ||
      typeof candidatePreference !== 'object'
    ) {
      continue
    }

    const preference = candidatePreference as Record<string, unknown>
    const modelId =
      typeof preference.modelId === 'string' ? preference.modelId.trim() : ''
    const label =
      typeof preference.label === 'string' ? preference.label.trim() : ''
    const providerId =
      preference.providerId === null || isChatProviderId(preference.providerId)
        ? (preference.providerId ?? null)
        : null

    if (modelId.length === 0) {
      continue
    }

    sanitizedValue[normalizedId] = {
      label,
      modelId,
      providerId,
    }
  }

  return sanitizedValue
}

function sanitizeRevertEditSessionsByConversation(value: unknown): AppSettings['revertEditSessionsByConversation'] {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APP_SETTINGS.revertEditSessionsByConversation }
  }

  const candidateEntries = Object.entries(value as Record<string, unknown>)
  const sanitizedValue: AppSettings['revertEditSessionsByConversation'] = {}

  for (const [conversationId, candidateSession] of candidateEntries) {
    const normalizedConversationId = conversationId.trim()
    if (normalizedConversationId.length === 0 || !candidateSession || typeof candidateSession !== 'object') {
      continue
    }

    const messageId =
      typeof (candidateSession as { messageId?: unknown }).messageId === 'string'
        ? (candidateSession as { messageId: string }).messageId.trim()
        : ''
    const redoCheckpointId =
      typeof (candidateSession as { redoCheckpointId?: unknown }).redoCheckpointId === 'string'
        ? (candidateSession as { redoCheckpointId: string }).redoCheckpointId.trim()
        : ''

    if (messageId.length === 0 || redoCheckpointId.length === 0) {
      continue
    }

    sanitizedValue[normalizedConversationId] = {
      messageId,
      redoCheckpointId,
    }
  }

  return sanitizedValue
}

function sanitizeEditSessionsByConversation(value: unknown): AppSettings['editSessionsByConversation'] {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APP_SETTINGS.editSessionsByConversation }
  }

  const candidateEntries = Object.entries(value as Record<string, unknown>)
  const sanitizedValue: AppSettings['editSessionsByConversation'] = {}

  for (const [conversationId, candidateSession] of candidateEntries) {
    const normalizedConversationId = conversationId.trim()
    if (normalizedConversationId.length === 0 || !candidateSession || typeof candidateSession !== 'object') {
      continue
    }

    const messageId =
      typeof (candidateSession as { messageId?: unknown }).messageId === 'string'
        ? (candidateSession as { messageId: string }).messageId.trim()
        : ''

    if (messageId.length === 0) {
      continue
    }

    sanitizedValue[normalizedConversationId] = {
      messageId,
    }
  }

  return sanitizedValue
}

function sanitizeDisabledSkillsByPath(value: unknown): AppSettings['disabledSkillsByPath'] {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APP_SETTINGS.disabledSkillsByPath }
  }

  const candidateEntries = Object.entries(value as Record<string, unknown>)
  const sanitizedValue: AppSettings['disabledSkillsByPath'] = {}

  for (const [skillPath, disabled] of candidateEntries) {
    const normalizedSkillPath = skillPath.trim()
    if (normalizedSkillPath.length === 0 || disabled !== true) {
      continue
    }

    sanitizedValue[normalizedSkillPath] = true
  }

  return sanitizedValue
}

function getConfigDirectoryPath() {
  const overriddenHome = process.env[SETTINGS_HOME_OVERRIDE_ENV]?.trim()
  const homePath = overriddenHome && overriddenHome.length > 0 ? overriddenHome : electronApp.getPath('home')
  return path.join(homePath, ...CONFIG_ROOT_SEGMENTS)
}

function getSettingsFilePath() {
  return path.join(getConfigDirectoryPath(), SETTINGS_FILE_NAME)
}

function getWorkspaceUiStateFilePath() {
  return path.join(getConfigDirectoryPath(), WORKSPACE_UI_STATE_FILE_NAME)
}

async function ensureConfigDirectory() {
  await fs.mkdir(getConfigDirectoryPath(), { recursive: true })
}

function isRecoverableSettingsParseError(error: unknown) {
  return error instanceof SyntaxError
}

function pickDurableAppSettings(settings: AppSettings): DurableAppSettings {
  const {
    conversationModelPreferences: _conversationModelPreferences,
    diffPanelWidth: _diffPanelWidth,
    editSessionsByConversation: _editSessionsByConversation,
    lastActiveConversationId: _lastActiveConversationId,
    lastActiveDraftFolderId: _lastActiveDraftFolderId,
    openEmptyConversationOnLaunch: _openEmptyConversationOnLaunch,
    revertEditSessionsByConversation: _revertEditSessionsByConversation,
    sidebarWidth: _sidebarWidth,
    workspaceEditorWidth: _workspaceEditorWidth,
    workspaceExplorerWidth: _workspaceExplorerWidth,
    sourceControlSectionOrder: _sourceControlSectionOrder,
    sourceControlSectionOpen: _sourceControlSectionOpen,
    sourceControlSectionSizes: _sourceControlSectionSizes,
    terminalOpenByWorkspace: _terminalOpenByWorkspace,
    terminalPanelHeightsByWorkspace: _terminalPanelHeightsByWorkspace,
    ...durableSettings
  } = settings

  return durableSettings
}

function pickWorkspaceUiSettings(settings: AppSettings): WorkspaceUiSettings {
  return {
    conversationModelPreferences: settings.conversationModelPreferences,
    diffPanelWidth: settings.diffPanelWidth,
    editSessionsByConversation: settings.editSessionsByConversation,
    lastActiveConversationId: settings.lastActiveConversationId,
    lastActiveDraftFolderId: settings.lastActiveDraftFolderId,
    openEmptyConversationOnLaunch: settings.openEmptyConversationOnLaunch,
    revertEditSessionsByConversation: settings.revertEditSessionsByConversation,
    sidebarWidth: settings.sidebarWidth,
    workspaceEditorWidth: settings.workspaceEditorWidth,
    workspaceExplorerWidth: settings.workspaceExplorerWidth,
    sourceControlSectionOrder: settings.sourceControlSectionOrder,
    sourceControlSectionOpen: settings.sourceControlSectionOpen,
    sourceControlSectionSizes: settings.sourceControlSectionSizes,
    terminalOpenByWorkspace: settings.terminalOpenByWorkspace,
    terminalPanelHeightsByWorkspace: settings.terminalPanelHeightsByWorkspace,
  }
}

async function writeDurableSettingsFile(settings: DurableAppSettings) {
  await ensureConfigDirectory()
  await writeJsonFileAtomic(getSettingsFilePath(), JSON.stringify(settings, null, 2))
}

async function writeWorkspaceUiStateFile(settings: WorkspaceUiSettings) {
  await ensureConfigDirectory()
  await writeJsonFileAtomic(getWorkspaceUiStateFilePath(), JSON.stringify(settings, null, 2))
}

function splitSettingsInput(input: Partial<AppSettings>) {
  const durableInput: Partial<DurableAppSettings> = {}
  const workspaceUiInput: Partial<WorkspaceUiSettings> = {}

  for (const [key, value] of Object.entries(input) as [keyof AppSettings, AppSettings[keyof AppSettings]][]) {
    if (WORKSPACE_UI_SETTINGS_KEY_SET.has(key)) {
      ;(workspaceUiInput as Partial<Record<keyof AppSettings, AppSettings[keyof AppSettings]>>)[key] = value
      continue
    }

    ;(durableInput as Partial<Record<keyof AppSettings, AppSettings[keyof AppSettings]>>)[key] = value
  }

  return {
    durableInput,
    hasDurableInput: Object.keys(durableInput).length > 0,
    hasWorkspaceUiInput: Object.keys(workspaceUiInput).length > 0,
    workspaceUiInput,
  }
}

async function readLegacySettingsFile() {
  try {
    await ensureConfigDirectory()
    const raw = await fs.readFile(getSettingsFilePath(), 'utf8')
    return sanitizeSettings(JSON.parse(raw) as Partial<AppSettings>)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_APP_SETTINGS
    }
    if (isRecoverableSettingsParseError(error)) {
      return DEFAULT_APP_SETTINGS
    }

    console.error('Failed to load app settings', error)
    throw error
  }
}

async function readDurableSettingsFile(): Promise<DurableAppSettings> {
  try {
    await ensureConfigDirectory()
    const raw = await fs.readFile(getSettingsFilePath(), 'utf8')
    return pickDurableAppSettings(sanitizeSettings(JSON.parse(raw) as Partial<AppSettings>))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const durableSettings = pickDurableAppSettings(DEFAULT_APP_SETTINGS)
      await writeDurableSettingsFile(durableSettings)
      return durableSettings
    }
    if (isRecoverableSettingsParseError(error)) {
      return pickDurableAppSettings(DEFAULT_APP_SETTINGS)
    }

    console.error('Failed to load app settings', error)
    throw error
  }
}

async function readWorkspaceUiStateFile(legacySettings: AppSettings): Promise<WorkspaceUiSettings> {
  try {
    await ensureConfigDirectory()
    const raw = await fs.readFile(getWorkspaceUiStateFilePath(), 'utf8')
    return pickWorkspaceUiSettings(sanitizeSettings({
      ...DEFAULT_APP_SETTINGS,
      ...(JSON.parse(raw) as Partial<AppSettings>),
    }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const workspaceUiSettings = pickWorkspaceUiSettings(legacySettings)
      await writeWorkspaceUiStateFile(workspaceUiSettings)
      return workspaceUiSettings
    }
    if (isRecoverableSettingsParseError(error)) {
      return pickWorkspaceUiSettings(legacySettings)
    }

    console.error('Failed to load workspace UI state', error)
    throw error
  }
}

async function readStoredSettingsFiles(): Promise<AppSettings> {
  const legacySettings = await readLegacySettingsFile()
  const [durableSettings, workspaceUiSettings] = await Promise.all([
    readDurableSettingsFile(),
    readWorkspaceUiStateFile(legacySettings),
  ])

  return sanitizeSettings({
    ...durableSettings,
    ...workspaceUiSettings,
  })
}

async function writeStoredSettingsFiles(settings: AppSettings) {
  await Promise.all([
    writeDurableSettingsFile(pickDurableAppSettings(settings)),
    writeWorkspaceUiStateFile(pickWorkspaceUiSettings(settings)),
  ])
}

function sanitizeSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const sidebarWidth =
    typeof input?.sidebarWidth === 'number' && Number.isFinite(input.sidebarWidth)
      ? Math.max(DEFAULT_APP_SETTINGS.sidebarWidth, input.sidebarWidth)
      : DEFAULT_APP_SETTINGS.sidebarWidth
  const appearance = isAppAppearance(input?.appearance) ? input.appearance : DEFAULT_APP_SETTINGS.appearance
  const chatModelId = typeof input?.chatModelId === 'string' ? input.chatModelId.trim() : DEFAULT_APP_SETTINGS.chatModelId
  const chatModelProviderId = isChatProviderId(input?.chatModelProviderId)
    ? input.chatModelProviderId
    : DEFAULT_APP_SETTINGS.chatModelProviderId
  const chatModelLabel = typeof input?.chatModelLabel === 'string' ? input.chatModelLabel.trim() : DEFAULT_APP_SETTINGS.chatModelLabel
  const chatReasoningEffort = isReasoningEffort(input?.chatReasoningEffort)
    ? input.chatReasoningEffort
    : DEFAULT_APP_SETTINGS.chatReasoningEffort
  const agentModelId = typeof input?.agentModelId === 'string' ? input.agentModelId.trim() : DEFAULT_APP_SETTINGS.agentModelId
  const agentModelProviderId = isChatProviderId(input?.agentModelProviderId)
    ? input.agentModelProviderId
    : DEFAULT_APP_SETTINGS.agentModelProviderId
  const agentModelLabel =
    typeof input?.agentModelLabel === 'string' ? input.agentModelLabel.trim() : DEFAULT_APP_SETTINGS.agentModelLabel
  const planModelId = typeof input?.planModelId === 'string' ? input.planModelId.trim() : DEFAULT_APP_SETTINGS.planModelId
  const planModelProviderId = isChatProviderId(input?.planModelProviderId)
    ? input.planModelProviderId
    : DEFAULT_APP_SETTINGS.planModelProviderId
  const planModelLabel =
    typeof input?.planModelLabel === 'string' ? input.planModelLabel.trim() : DEFAULT_APP_SETTINGS.planModelLabel
  const summarizationModelId =
    typeof input?.summarizationModelId === 'string'
      ? input.summarizationModelId.trim()
      : DEFAULT_APP_SETTINGS.summarizationModelId
  const summarizationModelProviderId = isChatProviderId(input?.summarizationModelProviderId)
    ? input.summarizationModelProviderId
    : DEFAULT_APP_SETTINGS.summarizationModelProviderId
  const summarizationModelLabel =
    typeof input?.summarizationModelLabel === 'string'
      ? input.summarizationModelLabel.trim()
      : DEFAULT_APP_SETTINGS.summarizationModelLabel
  const gitCommitModelId =
    typeof input?.gitCommitModelId === 'string'
      ? input.gitCommitModelId.trim()
      : DEFAULT_APP_SETTINGS.gitCommitModelId
  const gitCommitModelProviderId = isChatProviderId(input?.gitCommitModelProviderId)
    ? input.gitCommitModelProviderId
    : DEFAULT_APP_SETTINGS.gitCommitModelProviderId
  const gitCommitModelLabel =
    typeof input?.gitCommitModelLabel === 'string'
      ? input.gitCommitModelLabel.trim()
      : DEFAULT_APP_SETTINGS.gitCommitModelLabel
  const kanbanAiPlanningEnabled =
    typeof input?.kanbanAiPlanningEnabled === 'boolean'
      ? input.kanbanAiPlanningEnabled
      : DEFAULT_APP_SETTINGS.kanbanAiPlanningEnabled
  const kanbanModelId =
    typeof input?.kanbanModelId === 'string' ? input.kanbanModelId.trim() : DEFAULT_APP_SETTINGS.kanbanModelId
  const kanbanModelProviderId = isChatProviderId(input?.kanbanModelProviderId)
    ? input.kanbanModelProviderId
    : DEFAULT_APP_SETTINGS.kanbanModelProviderId
  const kanbanModelLabel =
    typeof input?.kanbanModelLabel === 'string'
      ? input.kanbanModelLabel.trim()
      : DEFAULT_APP_SETTINGS.kanbanModelLabel
  const diffPanelWidth =
    typeof input?.diffPanelWidth === 'number' && Number.isFinite(input.diffPanelWidth)
      ? clampStoredDiffPanelWidth(input.diffPanelWidth)
      : DEFAULT_APP_SETTINGS.diffPanelWidth
  const editSessionsByConversation = sanitizeEditSessionsByConversation(input?.editSessionsByConversation)
  const followUpBehavior = isFollowUpBehavior(input?.followUpBehavior)
    ? input.followUpBehavior
    : DEFAULT_APP_SETTINGS.followUpBehavior
  const workspaceEditorWidth =
    typeof input?.workspaceEditorWidth === 'number' && Number.isFinite(input.workspaceEditorWidth)
      ? clampStoredWorkspaceEditorWidth(input.workspaceEditorWidth)
      : DEFAULT_APP_SETTINGS.workspaceEditorWidth
  const workspaceExplorerWidth =
    typeof input?.workspaceExplorerWidth === 'number' && Number.isFinite(input.workspaceExplorerWidth)
      ? clampStoredWorkspaceExplorerWidth(input.workspaceExplorerWidth)
      : DEFAULT_APP_SETTINGS.workspaceExplorerWidth
  const language = isAppLanguage(input?.language) ? input.language : DEFAULT_APP_SETTINGS.language
  const lastActiveConversationId =
    typeof input?.lastActiveConversationId === 'string' && input.lastActiveConversationId.trim().length > 0
      ? input.lastActiveConversationId.trim()
      : DEFAULT_APP_SETTINGS.lastActiveConversationId
  const lastActiveDraftFolderId =
    typeof input?.lastActiveDraftFolderId === 'string' && input.lastActiveDraftFolderId.trim().length > 0
      ? input.lastActiveDraftFolderId.trim()
      : DEFAULT_APP_SETTINGS.lastActiveDraftFolderId
  const openEmptyConversationOnLaunch =
    typeof input?.openEmptyConversationOnLaunch === 'boolean'
      ? input.openEmptyConversationOnLaunch
      : DEFAULT_APP_SETTINGS.openEmptyConversationOnLaunch
  const revertEditSessionsByConversation = sanitizeRevertEditSessionsByConversation(
    input?.revertEditSessionsByConversation,
  )
  const sendMessageOnEnter =
    typeof input?.sendMessageOnEnter === 'boolean'
      ? input.sendMessageOnEnter
      : DEFAULT_APP_SETTINGS.sendMessageOnEnter
  const workspaceFileEditorWordWrap =
    typeof input?.workspaceFileEditorWordWrap === 'boolean'
      ? input.workspaceFileEditorWordWrap
      : DEFAULT_APP_SETTINGS.workspaceFileEditorWordWrap
  const disabledSkillsByPath = sanitizeDisabledSkillsByPath(input?.disabledSkillsByPath)
  const sourceControlSectionOrder = sanitizeSourceControlSectionOrder(input?.sourceControlSectionOrder)
  const sourceControlSectionOpen = sanitizeSourceControlSectionOpen(input?.sourceControlSectionOpen)
  const sourceControlSectionSizes = sanitizeSourceControlSectionSizes(input?.sourceControlSectionSizes)
  const terminalOpenByWorkspace = sanitizeTerminalOpenByWorkspace(input?.terminalOpenByWorkspace)
  const terminalPanelHeightsByWorkspace = sanitizeTerminalPanelHeightsByWorkspace(input?.terminalPanelHeightsByWorkspace)
  const terminalExecutionMode = isAppTerminalExecutionMode(input?.terminalExecutionMode)
    ? input.terminalExecutionMode
    : DEFAULT_APP_SETTINGS.terminalExecutionMode
  const conversationModelPreferences = sanitizeConversationModelPreferences(input?.conversationModelPreferences)

  return {
    appearance,
    chatModelId,
    chatModelProviderId,
    chatModelLabel,
    chatReasoningEffort,
    agentModelId,
    agentModelProviderId,
    agentModelLabel,
    planModelId,
    planModelProviderId,
    planModelLabel,
    summarizationModelId,
    summarizationModelProviderId,
    summarizationModelLabel,
    gitCommitModelId,
    gitCommitModelProviderId,
    gitCommitModelLabel,
    kanbanAiPlanningEnabled,
    kanbanModelId,
    kanbanModelProviderId,
    kanbanModelLabel,
    conversationModelPreferences,
    diffPanelWidth,
    editSessionsByConversation,
    followUpBehavior,
    language,
    lastActiveConversationId,
    lastActiveDraftFolderId,
    openEmptyConversationOnLaunch,
    revertEditSessionsByConversation,
    sendMessageOnEnter,
    workspaceFileEditorWordWrap,
    disabledSkillsByPath,
    sidebarWidth,

    workspaceEditorWidth,
    workspaceExplorerWidth,
    sourceControlSectionOrder,
    sourceControlSectionOpen,
    sourceControlSectionSizes,
    terminalOpenByWorkspace,
    terminalPanelHeightsByWorkspace,
    terminalExecutionMode,
  }
}

export async function getStoredSettings() {
  const storedSettings = await readStoredSettingsFiles()
  if (!hasLaunchOnlyAppSettings(storedSettings)) {
    cachedStoredSettings = storedSettings
    return storedSettings
  }

  const launchSafeSettings = resetLaunchOnlyAppSettings(storedSettings)
  await writeStoredSettingsFiles(launchSafeSettings)
  cachedStoredSettings = launchSafeSettings
  return launchSafeSettings
}

export async function updateStoredSettings(input: Partial<AppSettings>) {
  let nextSettings = DEFAULT_APP_SETTINGS

  settingsUpdateQueue = settingsUpdateQueue
    .catch(() => undefined)
    .then(async () => {
      const currentSettings = cachedStoredSettings ?? (await readStoredSettingsFiles().catch(() => DEFAULT_APP_SETTINGS))
      const { durableInput, hasDurableInput, hasWorkspaceUiInput, workspaceUiInput } = splitSettingsInput(input)
      const currentDurableSettings = pickDurableAppSettings(currentSettings)
      const currentWorkspaceUiSettings = pickWorkspaceUiSettings(currentSettings)
      const nextDurableSettings = hasDurableInput
        ? pickDurableAppSettings(sanitizeSettings({
            ...currentSettings,
            ...durableInput,
          }))
        : currentDurableSettings
      const nextWorkspaceUiSettings = hasWorkspaceUiInput
        ? pickWorkspaceUiSettings(sanitizeSettings({
            ...currentSettings,
            ...workspaceUiInput,
          }))
        : currentWorkspaceUiSettings

      nextSettings = sanitizeSettings({
        ...nextDurableSettings,
        ...nextWorkspaceUiSettings,
      })
      cachedStoredSettings = nextSettings

      await Promise.all([
        hasDurableInput ? writeDurableSettingsFile(nextDurableSettings) : Promise.resolve(),
        hasWorkspaceUiInput ? writeWorkspaceUiStateFile(nextWorkspaceUiSettings) : Promise.resolve(),
      ])
    })

  await settingsUpdateQueue
  return nextSettings
}

export async function flushStoredSettingsUpdates() {
  await settingsUpdateQueue.catch(() => undefined)
}
