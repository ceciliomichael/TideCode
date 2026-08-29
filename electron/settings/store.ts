import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppSettings, AppSettingsSurface, ConversationModeModelPreference } from '../../src/types/chat'
import { DEFAULT_APP_SETTINGS } from '../../src/lib/defaultAppSettings'
import {
  APP_SETTINGS_SURFACES,
  DEFAULT_APP_SETTINGS_SURFACE,
  pickSharedAppSettings,
  pickSurfaceAppSettings,
  splitAppSettingsInput,
  type SharedAppSettings,
  type SurfaceAppSettings,
} from '../../src/lib/appSettingsScopes'
import { isAppAppearance, isAppLanguage, isFollowUpBehavior } from '../../src/lib/appSettings'
import { clampStoredDiffPanelWidth } from '../../src/lib/diffPanelSizing'
import { clampStoredTerminalPanelHeight } from '../../src/lib/terminalPanelSizing'
import { isReasoningEffort } from '../../src/lib/reasoningEffort'
import { hasLaunchOnlyAppSettings, resetLaunchOnlyAppSettings } from '../../src/hooks/appSettingsLaunchState'
import { clampStoredWorkspaceEditorWidth } from '../../src/lib/workspaceEditorSizing'
import { clampStoredWorkspaceExplorerWidth } from '../../src/lib/workspaceExplorerSizing'
import { normalizeContextCompactionSettings } from '../../src/lib/contextCompactionSettings'
import { isPlanRelativePath, normalizePlanRelativePath } from '../../src/lib/planContracts'
import type { ChatMode, SourceControlSectionId } from '../../src/types/chat'
import { electronApp } from '../electronApp'
import { writeJsonFileAtomic } from './fileStore'
import { isChatProviderId as isSupportedChatProviderId } from '../providers/providerIds'

const CONFIG_ROOT_SEGMENTS = ['.tidecode', 'config'] as const
const SETTINGS_FILE_NAME = 'settings.json'
const LEGACY_WORKSPACE_UI_STATE_FILE_NAME = 'workspace-ui-state.json'
const SURFACE_SETTINGS_FILE_PREFIX = 'surface-settings'
const SETTINGS_LOCK_FILE_NAME = 'settings.lock'
const SETTINGS_HOME_OVERRIDE_ENV = 'TIDECODE_SETTINGS_HOME'
const SETTINGS_LOCK_RETRY_MS = 20
const SETTINGS_LOCK_STALE_MS = 5_000
const SETTINGS_LOCK_TIMEOUT_MS = 5_000
let settingsUpdateQueue: Promise<void> = Promise.resolve()
let settingsLockQueue: Promise<void> = Promise.resolve()
const cachedStoredSettingsBySurface = new Map<AppSettingsSurface, AppSettings>()
const SOURCE_CONTROL_SECTION_IDS: readonly SourceControlSectionId[] = ['commit', 'changes', 'history']

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

function sanitizeConversationModeModelPreference(value: unknown): ConversationModeModelPreference | null {
  if (!value || typeof value !== 'object') return null

  const preference = value as Record<string, unknown>
  const modelId = typeof preference.modelId === 'string' ? preference.modelId.trim() : ''
  if (!modelId) return null

  const label = typeof preference.label === 'string' ? preference.label.trim() : ''
  const providerId =
    preference.providerId === null || isChatProviderId(preference.providerId)
      ? (preference.providerId ?? null)
      : null
  const reasoningEffort =
    typeof preference.reasoningEffort === 'string' && isReasoningEffort(preference.reasoningEffort)
      ? preference.reasoningEffort
      : undefined

  return {
    label,
    modelId,
    providerId,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
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
    const sanitizedPreference = sanitizeConversationModeModelPreference(candidatePreference)
    const chatMode =
      preference.chatMode === 'agent' || preference.chatMode === 'plan'
        ? preference.chatMode
        : undefined
    if (!sanitizedPreference) {
      continue
    }

    const entry: AppSettings['conversationModelPreferences'][string] = {
      ...sanitizedPreference,
    }
    if (chatMode !== undefined) entry.chatMode = chatMode
    if (preference.modeSelections && typeof preference.modeSelections === 'object') {
      const modeSelections: NonNullable<typeof entry.modeSelections> = {}
      const rawModeSelections = preference.modeSelections as Record<string, unknown>
      const agentSelection = sanitizeConversationModeModelPreference(rawModeSelections.agent)
      const planSelection = sanitizeConversationModeModelPreference(rawModeSelections.plan)
      if (agentSelection) modeSelections.agent = agentSelection
      if (planSelection) modeSelections.plan = planSelection
      if (modeSelections.agent || modeSelections.plan) entry.modeSelections = modeSelections
    }

    sanitizedValue[normalizedId] = entry
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
    const chatModeBeforeRevert =
      (candidateSession as { chatModeBeforeRevert?: unknown }).chatModeBeforeRevert === 'agent' ||
      (candidateSession as { chatModeBeforeRevert?: unknown }).chatModeBeforeRevert === 'plan'
        ? (candidateSession as { chatModeBeforeRevert: ChatMode }).chatModeBeforeRevert
        : undefined
    const revertedChatMode =
      (candidateSession as { revertedChatMode?: unknown }).revertedChatMode === 'agent' ||
      (candidateSession as { revertedChatMode?: unknown }).revertedChatMode === 'plan'
        ? (candidateSession as { revertedChatMode: ChatMode }).revertedChatMode
        : undefined
    const revertedPlanPaths = Array.isArray((candidateSession as { revertedPlanPaths?: unknown }).revertedPlanPaths)
      ? Array.from(
          new Set(
            ((candidateSession as { revertedPlanPaths: unknown[] }).revertedPlanPaths ?? [])
              .filter((candidatePath): candidatePath is string => typeof candidatePath === 'string')
              .map((candidatePath) => normalizePlanRelativePath(candidatePath))
              .filter(isPlanRelativePath),
          ),
        )
      : []

    if (messageId.length === 0 || redoCheckpointId.length === 0) {
      continue
    }

    sanitizedValue[normalizedConversationId] = {
      ...(chatModeBeforeRevert ? { chatModeBeforeRevert } : {}),
      messageId,
      redoCheckpointId,
      ...(revertedChatMode ? { revertedChatMode } : {}),
      ...(revertedPlanPaths.length > 0 ? { revertedPlanPaths } : {}),
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

function getConfigDirectoryPath() {
  const overriddenHome = process.env[SETTINGS_HOME_OVERRIDE_ENV]?.trim()
  const homePath = overriddenHome && overriddenHome.length > 0 ? overriddenHome : electronApp.getPath('home')
  return path.join(homePath, ...CONFIG_ROOT_SEGMENTS)
}

function getSettingsFilePath() {
  return path.join(getConfigDirectoryPath(), SETTINGS_FILE_NAME)
}

function getLegacyWorkspaceUiStateFilePath() {
  return path.join(getConfigDirectoryPath(), LEGACY_WORKSPACE_UI_STATE_FILE_NAME)
}

function getSurfaceSettingsFilePath(surface: AppSettingsSurface) {
  return path.join(getConfigDirectoryPath(), SURFACE_SETTINGS_FILE_PREFIX + '.' + surface + '.json')
}

function getSettingsLockFilePath() {
  return path.join(getConfigDirectoryPath(), SETTINGS_LOCK_FILE_NAME)
}

async function ensureConfigDirectory() {
  await fs.mkdir(getConfigDirectoryPath(), { recursive: true })
}

async function waitForSettingsLockRetry() {
  await new Promise<void>((resolve) => setTimeout(resolve, SETTINGS_LOCK_RETRY_MS))
}

async function removeStaleSettingsLock(lockPath: string) {
  try {
    const stats = await fs.stat(lockPath)
    const rawOwnerPid = await fs.readFile(lockPath, 'utf8').catch(() => '')
    const ownerPid = Number.parseInt(rawOwnerPid.trim(), 10)
    if (Number.isInteger(ownerPid) && ownerPid > 0) {
      try {
        process.kill(ownerPid, 0)
        return false
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          return false
        }
      }
    } else if (Date.now() - stats.mtimeMs < SETTINGS_LOCK_STALE_MS) {
      return false
    }
    await fs.unlink(lockPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true
    }
    return false
  }
}

async function withSettingsFileLock<T>(operation: () => Promise<T>): Promise<T> {
  let releaseQueue!: () => void
  const previousOperation = settingsLockQueue
  settingsLockQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })
  await previousOperation.catch(() => undefined)

  try {
    return await acquireSettingsFileLock(operation)
  } finally {
    releaseQueue()
  }
}

async function acquireSettingsFileLock<T>(operation: () => Promise<T>): Promise<T> {
  await ensureConfigDirectory()
  const lockPath = getSettingsLockFilePath()
  const deadline = Date.now() + SETTINGS_LOCK_TIMEOUT_MS

  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(lockPath, 'wx')
      try {
        await handle.writeFile(`${process.pid}\n`, 'utf8')
        return await operation()
      } finally {
        await handle.close().catch(() => undefined)
        await fs.unlink(lockPath).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('Failed to release TideCode settings lock', error)
          }
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      if (await removeStaleSettingsLock(lockPath)) {
        continue
      }
      await waitForSettingsLockRetry()
    }
  }

  throw new Error('Timed out waiting for the TideCode settings lock.')
}

function isRecoverableSettingsParseError(error: unknown) {
  return error instanceof SyntaxError
}

async function writeSharedSettingsFile(settings: SharedAppSettings) {
  await ensureConfigDirectory()
  await writeJsonFileAtomic(getSettingsFilePath(), JSON.stringify(settings, null, 2))
}

async function writeSurfaceSettingsFile(surface: AppSettingsSurface, settings: SurfaceAppSettings) {
  await ensureConfigDirectory()
  await writeJsonFileAtomic(getSurfaceSettingsFilePath(surface), JSON.stringify(settings, null, 2))
}

async function readLegacySettingsFile(): Promise<AppSettings> {
  try {
    await ensureConfigDirectory()
    const raw = await fs.readFile(getSettingsFilePath(), 'utf8')
    return sanitizeSettings(JSON.parse(raw) as Partial<AppSettings>)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || isRecoverableSettingsParseError(error)) {
      return DEFAULT_APP_SETTINGS
    }
    console.error('Failed to load app settings', error)
    throw error
  }
}

async function readLegacyWorkspaceUiSettings(): Promise<Partial<AppSettings>> {
  try {
    const raw = await fs.readFile(getLegacyWorkspaceUiStateFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || isRecoverableSettingsParseError(error)) {
      return {}
    }
    console.error('Failed to load legacy workspace UI settings', error)
    throw error
  }
}

async function readLegacyMergedSettings(): Promise<AppSettings> {
  const [settings, workspaceUiSettings] = await Promise.all([
    readLegacySettingsFile(),
    readLegacyWorkspaceUiSettings(),
  ])
  return sanitizeSettings({
    ...settings,
    ...workspaceUiSettings,
  })
}

async function readSharedSettingsFile(): Promise<SharedAppSettings> {
  try {
    const raw = await fs.readFile(getSettingsFilePath(), 'utf8')
    return pickSharedAppSettings(sanitizeSettings(JSON.parse(raw) as Partial<AppSettings>))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const settings = pickSharedAppSettings(DEFAULT_APP_SETTINGS)
      await writeSharedSettingsFile(settings)
      return settings
    }
    if (isRecoverableSettingsParseError(error)) {
      return pickSharedAppSettings(DEFAULT_APP_SETTINGS)
    }
    console.error('Failed to load shared app settings', error)
    throw error
  }
}

async function tryReadSurfaceSettingsFile(surface: AppSettingsSurface): Promise<SurfaceAppSettings | null> {
  try {
    const raw = await fs.readFile(getSurfaceSettingsFilePath(surface), 'utf8')
    return pickSurfaceAppSettings(sanitizeSettings({
      ...DEFAULT_APP_SETTINGS,
      ...(JSON.parse(raw) as Partial<AppSettings>),
    }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (isRecoverableSettingsParseError(error)) return pickSurfaceAppSettings(DEFAULT_APP_SETTINGS)
    console.error('Failed to load ' + surface + ' app settings', error)
    throw error
  }
}

async function ensureSurfaceSettingsMigration() {
  const existingEntries = await Promise.all(
    APP_SETTINGS_SURFACES.map(async (surface) => [surface, await tryReadSurfaceSettingsFile(surface)] as const),
  )
  if (existingEntries.every(([, settings]) => settings !== null)) return

  const legacySettings = await readLegacyMergedSettings()
  const existingFallback = existingEntries.find(([, settings]) => settings !== null)?.[1]
  const fallbackSurfaceSettings = existingFallback ?? pickSurfaceAppSettings(legacySettings)

  for (const [surface, settings] of existingEntries) {
    if (settings === null) {
      await writeSurfaceSettingsFile(surface, fallbackSurfaceSettings)
    }
  }

  // Write the shared-only file last. If migration is interrupted before this
  // point, the legacy settings file remains a complete fallback for retry.
  await writeSharedSettingsFile(pickSharedAppSettings(legacySettings))
}

async function readSurfaceSettingsFile(surface: AppSettingsSurface): Promise<SurfaceAppSettings> {
  const settings = await tryReadSurfaceSettingsFile(surface)
  if (settings) return settings
  const fallback = pickSurfaceAppSettings(DEFAULT_APP_SETTINGS)
  await writeSurfaceSettingsFile(surface, fallback)
  return fallback
}

async function readStoredSettingsFiles(surface: AppSettingsSurface): Promise<AppSettings> {
  await ensureSurfaceSettingsMigration()
  const [sharedSettings, surfaceSettings] = await Promise.all([
    readSharedSettingsFile(),
    readSurfaceSettingsFile(surface),
  ])
  return sanitizeSettings({
    ...sharedSettings,
    ...surfaceSettings,
  })
}

function sanitizeSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const sidebarWidth =
    typeof input?.sidebarWidth === 'number' && Number.isFinite(input.sidebarWidth)
      ? Math.max(DEFAULT_APP_SETTINGS.sidebarWidth, input.sidebarWidth)
      : DEFAULT_APP_SETTINGS.sidebarWidth
  const appearance = isAppAppearance(input?.appearance) ? input.appearance : DEFAULT_APP_SETTINGS.appearance
  const autoDownloadUpdates =
    typeof input?.autoDownloadUpdates === 'boolean'
      ? input.autoDownloadUpdates
      : DEFAULT_APP_SETTINGS.autoDownloadUpdates
  const checkForUpdatesOnLaunch =
    typeof input?.checkForUpdatesOnLaunch === 'boolean'
      ? input.checkForUpdatesOnLaunch
      : DEFAULT_APP_SETTINGS.checkForUpdatesOnLaunch
  const chatModelId = typeof input?.chatModelId === 'string' ? input.chatModelId.trim() : DEFAULT_APP_SETTINGS.chatModelId
  const chatModelProviderId = isChatProviderId(input?.chatModelProviderId)
    ? input.chatModelProviderId
    : DEFAULT_APP_SETTINGS.chatModelProviderId
  const chatModelLabel = typeof input?.chatModelLabel === 'string' ? input.chatModelLabel.trim() : DEFAULT_APP_SETTINGS.chatModelLabel
  const chatReasoningEffort = isReasoningEffort(input?.chatReasoningEffort)
    ? input.chatReasoningEffort
    : DEFAULT_APP_SETTINGS.chatReasoningEffort
  const contextCompaction = normalizeContextCompactionSettings(input?.contextCompaction)
  const agentModelId = typeof input?.agentModelId === 'string' ? input.agentModelId.trim() : DEFAULT_APP_SETTINGS.agentModelId
  const agentModelProviderId = isChatProviderId(input?.agentModelProviderId)
    ? input.agentModelProviderId
    : DEFAULT_APP_SETTINGS.agentModelProviderId
  const agentModelLabel =
    typeof input?.agentModelLabel === 'string' ? input.agentModelLabel.trim() : DEFAULT_APP_SETTINGS.agentModelLabel
  const agentReasoningEffort = isReasoningEffort(input?.agentReasoningEffort)
    ? input.agentReasoningEffort
    : chatReasoningEffort
  const planModelId = typeof input?.planModelId === 'string' ? input.planModelId.trim() : DEFAULT_APP_SETTINGS.planModelId
  const planModelProviderId = isChatProviderId(input?.planModelProviderId)
    ? input.planModelProviderId
    : DEFAULT_APP_SETTINGS.planModelProviderId
  const planModelLabel =
    typeof input?.planModelLabel === 'string' ? input.planModelLabel.trim() : DEFAULT_APP_SETTINGS.planModelLabel
  const planReasoningEffort = isReasoningEffort(input?.planReasoningEffort)
    ? input.planReasoningEffort
    : chatReasoningEffort
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
  const summarizationReasoningEffort = isReasoningEffort(input?.summarizationReasoningEffort)
    ? input.summarizationReasoningEffort
    : chatReasoningEffort
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
  const gitCommitReasoningEffort = isReasoningEffort(input?.gitCommitReasoningEffort)
    ? input.gitCommitReasoningEffort
    : chatReasoningEffort
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
  const kanbanReasoningEffort = isReasoningEffort(input?.kanbanReasoningEffort)
    ? input.kanbanReasoningEffort
    : chatReasoningEffort
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
    autoDownloadUpdates,
    checkForUpdatesOnLaunch,
    chatModelId,
    chatModelProviderId,
    chatModelLabel,
    chatReasoningEffort,
    contextCompaction,
    agentModelId,
    agentModelProviderId,
    agentModelLabel,
    agentReasoningEffort,
    planModelId,
    planModelProviderId,
    planModelLabel,
    planReasoningEffort,
    summarizationModelId,
    summarizationModelProviderId,
    summarizationModelLabel,
    summarizationReasoningEffort,
    gitCommitModelId,
    gitCommitModelProviderId,
    gitCommitModelLabel,
    gitCommitReasoningEffort,
    kanbanAiPlanningEnabled,
    kanbanModelId,
    kanbanModelProviderId,
    kanbanModelLabel,
    kanbanReasoningEffort,
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
    sidebarWidth,

    workspaceEditorWidth,
    workspaceExplorerWidth,
    sourceControlSectionOrder,
    sourceControlSectionOpen,
    sourceControlSectionSizes,
    terminalOpenByWorkspace,
    terminalPanelHeightsByWorkspace,
    terminalExecutionMode,
    selectedProjectId: typeof input?.selectedProjectId === 'string' ? input.selectedProjectId : DEFAULT_APP_SETTINGS.selectedProjectId,
    selectedProjectName:
      typeof input?.selectedProjectName === 'string' && input.selectedProjectName.trim().length > 0
        ? input.selectedProjectName.trim()
        : null,
    modelToggleState: typeof input?.modelToggleState === 'object' && input.modelToggleState !== null ? (input.modelToggleState as Record<string, boolean>) : DEFAULT_APP_SETTINGS.modelToggleState,
  }
}

async function commitStoredSettingsInput(
  currentSettings: AppSettings,
  input: Partial<AppSettings>,
  surface: AppSettingsSurface,
) {
  const { sharedInput, surfaceInput } = splitAppSettingsInput(input)
  const nextSettings = sanitizeSettings({
    ...currentSettings,
    ...sharedInput,
    ...surfaceInput,
  })
  const writes: Promise<void>[] = []
  if (Object.keys(sharedInput).length > 0) {
    writes.push(writeSharedSettingsFile(pickSharedAppSettings(nextSettings)))
  }
  if (Object.keys(surfaceInput).length > 0) {
    writes.push(writeSurfaceSettingsFile(surface, pickSurfaceAppSettings(nextSettings)))
  }
  await Promise.all(writes)
  cachedStoredSettingsBySurface.set(surface, nextSettings)
  return nextSettings
}

export async function getStoredSettings(surface: AppSettingsSurface = DEFAULT_APP_SETTINGS_SURFACE) {
  await settingsUpdateQueue.catch(() => undefined)
  return withSettingsFileLock(async () => {
    const storedSettings = await readStoredSettingsFiles(surface)
    if (!hasLaunchOnlyAppSettings(storedSettings)) {
      cachedStoredSettingsBySurface.set(surface, storedSettings)
      return storedSettings
    }

    const launchSafeSettings = resetLaunchOnlyAppSettings(storedSettings)
    await writeSurfaceSettingsFile(surface, pickSurfaceAppSettings(launchSafeSettings))
    cachedStoredSettingsBySurface.set(surface, launchSafeSettings)
    return launchSafeSettings
  })
}

export async function updateStoredSettings(
  input: Partial<AppSettings>,
  surface: AppSettingsSurface = DEFAULT_APP_SETTINGS_SURFACE,
) {
  let nextSettings = DEFAULT_APP_SETTINGS

  settingsUpdateQueue = settingsUpdateQueue
    .catch(() => undefined)
    .then(async () => {
      nextSettings = await withSettingsFileLock(async () => {
        const currentSettings = await readStoredSettingsFiles(surface).catch(
          () => cachedStoredSettingsBySurface.get(surface) ?? DEFAULT_APP_SETTINGS,
        )
        return commitStoredSettingsInput(currentSettings, input, surface)
      })
    })

  await settingsUpdateQueue
  return nextSettings
}

export async function updateStoredConversationModelPreference(
  conversationId: string,
  preference: AppSettings['conversationModelPreferences'][string] | null,
  surface: AppSettingsSurface = DEFAULT_APP_SETTINGS_SURFACE,
) {
  const normalizedConversationId = conversationId.trim()
  if (!normalizedConversationId) {
    throw new Error('A conversation ID is required to update model preferences.')
  }

  let nextSettings = DEFAULT_APP_SETTINGS
  settingsUpdateQueue = settingsUpdateQueue
    .catch(() => undefined)
    .then(async () => {
      nextSettings = await withSettingsFileLock(async () => {
        const currentSettings = await readStoredSettingsFiles(surface).catch(
          () => cachedStoredSettingsBySurface.get(surface) ?? DEFAULT_APP_SETTINGS,
        )
        const conversationModelPreferences = { ...currentSettings.conversationModelPreferences }
        if (preference) {
          conversationModelPreferences[normalizedConversationId] = preference
        } else {
          delete conversationModelPreferences[normalizedConversationId]
        }
        return commitStoredSettingsInput(currentSettings, { conversationModelPreferences }, surface)
      })
    })

  await settingsUpdateQueue
  return nextSettings
}

export async function flushStoredSettingsUpdates() {
  await settingsUpdateQueue.catch(() => undefined)
}
