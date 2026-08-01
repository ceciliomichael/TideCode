import { DEFAULT_APP_SETTINGS } from '../../src/lib/defaultAppSettings'
import { isAppAppearance, isAppLanguage, isFollowUpBehavior } from '../../src/lib/appSettings'
import { clampStoredDiffPanelWidth } from '../../src/lib/diffPanelSizing'
import { clampStoredTerminalPanelHeight } from '../../src/lib/terminalPanelSizing'
import { isReasoningEffort } from '../../src/lib/reasoningEffort'
import { resetLaunchOnlyAppSettings } from '../../src/hooks/appSettingsLaunchState'
import { clampStoredWorkspaceEditorWidth } from '../../src/lib/workspaceEditorSizing'
import { clampStoredWorkspaceExplorerWidth } from '../../src/lib/workspaceExplorerSizing'
import { normalizeContextCompactionSettings } from '../../src/lib/contextCompactionSettings'
import type { AppSettings } from '../../src/types/chat'
import type { SourceControlSectionId } from '../../src/types/chat'
import { isChatProviderId as isSupportedChatProviderId } from '../providers/providerIds'

const INITIAL_SETTINGS_ARG_PREFIX = '--tidecode-initial-settings='
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

function sanitizeSourceControlSectionOpen(value: unknown): AppSettings['sourceControlSectionOpen'] {
  const candidate = value as Partial<AppSettings['sourceControlSectionOpen']> | null | undefined
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

function sanitizeTerminalOpenByWorkspace(value: unknown): AppSettings['terminalOpenByWorkspace'] {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APP_SETTINGS.terminalOpenByWorkspace }
  }

  const candidateEntries = Object.entries(value as Record<string, unknown>)
  const sanitizedValue: AppSettings['terminalOpenByWorkspace'] = {}
  for (const [workspaceKey, workspaceIsOpen] of candidateEntries) {
    const normalizedWorkspaceKey = workspaceKey.trim()
    if (normalizedWorkspaceKey.length === 0 || typeof workspaceIsOpen !== 'boolean') {
      continue
    }

    sanitizedValue[normalizedWorkspaceKey] = workspaceIsOpen
  }

  return sanitizedValue
}

function sanitizeTerminalPanelHeightsByWorkspace(value: unknown): AppSettings['terminalPanelHeightsByWorkspace'] {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APP_SETTINGS.terminalPanelHeightsByWorkspace }
  }

  const candidateEntries = Object.entries(value as Record<string, unknown>)
  const sanitizedValue: AppSettings['terminalPanelHeightsByWorkspace'] = {}
  for (const [workspaceKey, workspacePanelHeight] of candidateEntries) {
    const normalizedWorkspaceKey = workspaceKey.trim()
    if (normalizedWorkspaceKey.length === 0 || typeof workspacePanelHeight !== 'number') {
      continue
    }

    sanitizedValue[normalizedWorkspaceKey] = clampStoredTerminalPanelHeight(workspacePanelHeight)
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
    const chatMode =
      typeof preference.chatMode === 'string' && preference.chatMode === 'plan'
        ? ('plan' as const)
        : undefined
    const reasoningEffort =
      typeof preference.reasoningEffort === 'string' && isReasoningEffort(preference.reasoningEffort)
        ? preference.reasoningEffort
        : undefined

    if (modelId.length === 0) {
      continue
    }

    const entry: AppSettings['conversationModelPreferences'][string] = {
      label,
      modelId,
      providerId,
    }
    if (chatMode !== undefined) entry.chatMode = chatMode
    if (reasoningEffort !== undefined) entry.reasoningEffort = reasoningEffort

    sanitizedValue[normalizedId] = entry
  }

  return sanitizedValue
}

function sanitizeBootstrappedSettings(input: unknown): AppSettings {
  const candidate = input as Partial<AppSettings> | null | undefined

  return {
    appearance: isAppAppearance(candidate?.appearance) ? candidate.appearance : DEFAULT_APP_SETTINGS.appearance,
    chatModelId: typeof candidate?.chatModelId === 'string' ? candidate.chatModelId.trim() : DEFAULT_APP_SETTINGS.chatModelId,
    chatModelProviderId: isChatProviderId(candidate?.chatModelProviderId)
      ? candidate.chatModelProviderId
      : DEFAULT_APP_SETTINGS.chatModelProviderId,
    chatModelLabel:
      typeof candidate?.chatModelLabel === 'string' ? candidate.chatModelLabel.trim() : DEFAULT_APP_SETTINGS.chatModelLabel,
    chatReasoningEffort: isReasoningEffort(candidate?.chatReasoningEffort)
      ? candidate.chatReasoningEffort
      : DEFAULT_APP_SETTINGS.chatReasoningEffort,
    contextCompaction: normalizeContextCompactionSettings(candidate?.contextCompaction),
    agentModelId:
      typeof candidate?.agentModelId === 'string'
        ? candidate.agentModelId.trim()
        : DEFAULT_APP_SETTINGS.agentModelId,
    agentModelProviderId: isChatProviderId(candidate?.agentModelProviderId)
      ? candidate.agentModelProviderId
      : DEFAULT_APP_SETTINGS.agentModelProviderId,
    agentModelLabel:
      typeof candidate?.agentModelLabel === 'string'
        ? candidate.agentModelLabel.trim()
        : DEFAULT_APP_SETTINGS.agentModelLabel,
    planModelId:
      typeof candidate?.planModelId === 'string'
        ? candidate.planModelId.trim()
        : DEFAULT_APP_SETTINGS.planModelId,
    planModelProviderId: isChatProviderId(candidate?.planModelProviderId)
      ? candidate.planModelProviderId
      : DEFAULT_APP_SETTINGS.planModelProviderId,
    planModelLabel:
      typeof candidate?.planModelLabel === 'string'
        ? candidate.planModelLabel.trim()
        : DEFAULT_APP_SETTINGS.planModelLabel,
    summarizationModelId:
      typeof candidate?.summarizationModelId === 'string'
        ? candidate.summarizationModelId.trim()
        : DEFAULT_APP_SETTINGS.summarizationModelId,
    summarizationModelProviderId: isChatProviderId(candidate?.summarizationModelProviderId)
      ? candidate.summarizationModelProviderId
      : DEFAULT_APP_SETTINGS.summarizationModelProviderId,
    summarizationModelLabel:
      typeof candidate?.summarizationModelLabel === 'string'
        ? candidate.summarizationModelLabel.trim()
        : DEFAULT_APP_SETTINGS.summarizationModelLabel,
    gitCommitModelId:
      typeof candidate?.gitCommitModelId === 'string'
        ? candidate.gitCommitModelId.trim()
        : DEFAULT_APP_SETTINGS.gitCommitModelId,
    gitCommitModelProviderId: isChatProviderId(candidate?.gitCommitModelProviderId)
      ? candidate.gitCommitModelProviderId
      : DEFAULT_APP_SETTINGS.gitCommitModelProviderId,
    gitCommitModelLabel:
      typeof candidate?.gitCommitModelLabel === 'string'
        ? candidate.gitCommitModelLabel.trim()
        : DEFAULT_APP_SETTINGS.gitCommitModelLabel,
    kanbanAiPlanningEnabled:
      typeof candidate?.kanbanAiPlanningEnabled === 'boolean'
        ? candidate.kanbanAiPlanningEnabled
        : DEFAULT_APP_SETTINGS.kanbanAiPlanningEnabled,
    kanbanModelId:
      typeof candidate?.kanbanModelId === 'string'
        ? candidate.kanbanModelId.trim()
        : DEFAULT_APP_SETTINGS.kanbanModelId,
    kanbanModelProviderId: isChatProviderId(candidate?.kanbanModelProviderId)
      ? candidate.kanbanModelProviderId
      : DEFAULT_APP_SETTINGS.kanbanModelProviderId,
    kanbanModelLabel:
      typeof candidate?.kanbanModelLabel === 'string'
        ? candidate.kanbanModelLabel.trim()
        : DEFAULT_APP_SETTINGS.kanbanModelLabel,
    diffPanelWidth:
      typeof candidate?.diffPanelWidth === 'number' && Number.isFinite(candidate.diffPanelWidth)
        ? clampStoredDiffPanelWidth(candidate.diffPanelWidth)
        : DEFAULT_APP_SETTINGS.diffPanelWidth,
    editSessionsByConversation: sanitizeEditSessionsByConversation(candidate?.editSessionsByConversation),
    followUpBehavior: isFollowUpBehavior(candidate?.followUpBehavior)
      ? candidate.followUpBehavior
      : DEFAULT_APP_SETTINGS.followUpBehavior,
    language: isAppLanguage(candidate?.language) ? candidate.language : DEFAULT_APP_SETTINGS.language,
    lastActiveConversationId:
      typeof candidate?.lastActiveConversationId === 'string' && candidate.lastActiveConversationId.trim().length > 0
        ? candidate.lastActiveConversationId.trim()
        : DEFAULT_APP_SETTINGS.lastActiveConversationId,
    lastActiveDraftFolderId:
      typeof candidate?.lastActiveDraftFolderId === 'string' && candidate.lastActiveDraftFolderId.trim().length > 0
        ? candidate.lastActiveDraftFolderId.trim()
        : DEFAULT_APP_SETTINGS.lastActiveDraftFolderId,
    openEmptyConversationOnLaunch:
      typeof candidate?.openEmptyConversationOnLaunch === 'boolean'
        ? candidate.openEmptyConversationOnLaunch
        : DEFAULT_APP_SETTINGS.openEmptyConversationOnLaunch,
    revertEditSessionsByConversation: sanitizeRevertEditSessionsByConversation(
      candidate?.revertEditSessionsByConversation,
    ),
    sendMessageOnEnter:
      typeof candidate?.sendMessageOnEnter === 'boolean'
        ? candidate.sendMessageOnEnter
        : DEFAULT_APP_SETTINGS.sendMessageOnEnter,
    workspaceFileEditorWordWrap:
      typeof candidate?.workspaceFileEditorWordWrap === 'boolean'
        ? candidate.workspaceFileEditorWordWrap
        : DEFAULT_APP_SETTINGS.workspaceFileEditorWordWrap,
    conversationModelPreferences: sanitizeConversationModelPreferences(candidate?.conversationModelPreferences),
    disabledSkillsByPath: sanitizeDisabledSkillsByPath(candidate?.disabledSkillsByPath),
    sidebarWidth:

      typeof candidate?.sidebarWidth === 'number' && Number.isFinite(candidate.sidebarWidth)
        ? Math.max(DEFAULT_APP_SETTINGS.sidebarWidth, candidate.sidebarWidth)
        : DEFAULT_APP_SETTINGS.sidebarWidth,
    workspaceEditorWidth:
      typeof candidate?.workspaceEditorWidth === 'number' && Number.isFinite(candidate.workspaceEditorWidth)
        ? clampStoredWorkspaceEditorWidth(candidate.workspaceEditorWidth)
        : DEFAULT_APP_SETTINGS.workspaceEditorWidth,
    workspaceExplorerWidth:
      typeof candidate?.workspaceExplorerWidth === 'number' && Number.isFinite(candidate.workspaceExplorerWidth)
        ? clampStoredWorkspaceExplorerWidth(candidate.workspaceExplorerWidth)
        : DEFAULT_APP_SETTINGS.workspaceExplorerWidth,
    sourceControlSectionOrder: sanitizeSourceControlSectionOrder(candidate?.sourceControlSectionOrder),
    sourceControlSectionOpen: sanitizeSourceControlSectionOpen(candidate?.sourceControlSectionOpen),
    sourceControlSectionSizes: sanitizeSourceControlSectionSizes(candidate?.sourceControlSectionSizes),
    terminalOpenByWorkspace: sanitizeTerminalOpenByWorkspace(candidate?.terminalOpenByWorkspace),
    terminalPanelHeightsByWorkspace: sanitizeTerminalPanelHeightsByWorkspace(candidate?.terminalPanelHeightsByWorkspace),
    terminalExecutionMode: isAppTerminalExecutionMode(candidate?.terminalExecutionMode)
      ? candidate.terminalExecutionMode
      : DEFAULT_APP_SETTINGS.terminalExecutionMode,
    githubToken:
      typeof candidate?.githubToken === 'string'
        ? candidate.githubToken.trim()
        : DEFAULT_APP_SETTINGS.githubToken ?? '',
    selectedProjectId:
      typeof candidate?.selectedProjectId === 'string' && candidate.selectedProjectId.trim().length > 0
        ? candidate.selectedProjectId.trim()
        : DEFAULT_APP_SETTINGS.selectedProjectId,
    modelToggleState:
      typeof candidate?.modelToggleState === 'object' && candidate.modelToggleState !== null
        ? (candidate.modelToggleState as Record<string, boolean>)
        : DEFAULT_APP_SETTINGS.modelToggleState,
  }
}

export function serializeInitialSettingsArg(settings: AppSettings) {
  return `${INITIAL_SETTINGS_ARG_PREFIX}${encodeURIComponent(JSON.stringify(settings))}`
}

export function parseInitialSettingsArg(argv: readonly string[]): AppSettings {
  const serializedSettings = argv.find((value) => value.startsWith(INITIAL_SETTINGS_ARG_PREFIX))

  if (!serializedSettings) {
    return DEFAULT_APP_SETTINGS
  }

  try {
    return resetLaunchOnlyAppSettings(
      sanitizeBootstrappedSettings(JSON.parse(decodeURIComponent(serializedSettings.slice(INITIAL_SETTINGS_ARG_PREFIX.length)))),
    )
  } catch (error) {
    console.error('Failed to parse initial settings payload', error)
    return DEFAULT_APP_SETTINGS
  }
}
