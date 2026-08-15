import type { AppSettings } from '../../src/types/chat'
import {
  APP_APPEARANCE_OPTIONS,
  APP_LANGUAGE_OPTIONS,
  FOLLOW_UP_BEHAVIOR_OPTIONS,
} from '../../src/lib/appSettings'
import { getStoredSettings, updateStoredSettings } from '../settings/store'
import {
  CLI_DEFAULT_MODEL_SETTINGS,
  getCliDefaultModelSettingValue,
  isCliDefaultModelSettingId,
  runCliDefaultModelSetting,
  type CliDefaultModelSettingId,
} from './cliDefaultModelSettings'
import type { CliSessionState, SlashCommandHelpers } from './types'

type CliSettingId =
  | 'follow-up'
  | 'terminal-access'
  | 'appearance'
  | 'language'
  | 'word-wrap'
  | 'send-on-enter'
  | 'auto-updates'
  | 'open-empty-chat'
  | 'kanban-ai'

interface SettingChoice {
  label: string
  value: string
}

function booleanChoices(): SettingChoice[] {
  return [{ label: 'On', value: 'true' }, { label: 'Off', value: 'false' }]
}

function getSettingChoices(id: CliSettingId): SettingChoice[] {
  switch (id) {
    case 'follow-up':
      return FOLLOW_UP_BEHAVIOR_OPTIONS.map((option) => ({ ...option }))
    case 'terminal-access':
      return [{ label: 'Full access', value: 'full' }, { label: 'Sandboxed', value: 'sandbox' }]
    case 'appearance':
      return APP_APPEARANCE_OPTIONS.map((option) => ({ ...option }))
    case 'language':
      return APP_LANGUAGE_OPTIONS.map((option) => ({ ...option }))
    default:
      return booleanChoices()
  }
}

function getCurrentValue(id: CliSettingId, settings: AppSettings, state: CliSessionState): string {
  switch (id) {
    case 'follow-up': return settings.followUpBehavior
    case 'terminal-access': return state.terminalExecutionMode
    case 'appearance': return settings.appearance
    case 'language': return settings.language
    case 'word-wrap': return String(settings.workspaceFileEditorWordWrap)
    case 'send-on-enter': return String(settings.sendMessageOnEnter)
    case 'auto-updates': return String(settings.autoDownloadUpdates)
    case 'open-empty-chat': return String(settings.openEmptyConversationOnLaunch)
    case 'kanban-ai': return String(settings.kanbanAiPlanningEnabled)
  }
}

export function buildCliSettingsPatch(id: CliSettingId, value: string): Partial<AppSettings> {
  switch (id) {
    case 'follow-up': return { followUpBehavior: value === 'steer' ? 'steer' : 'queue' }
    case 'terminal-access': return { terminalExecutionMode: value === 'sandbox' ? 'sandbox' : 'full' }
    case 'appearance': return { appearance: value === 'light' || value === 'dark' ? value : 'system' }
    case 'language': return { language: value === 'en-GB' || value === 'fil-PH' ? value : 'en-US' }
    case 'word-wrap': return { workspaceFileEditorWordWrap: value === 'true' }
    case 'send-on-enter': return { sendMessageOnEnter: value === 'true' }
    case 'auto-updates': return { autoDownloadUpdates: value === 'true' }
    case 'open-empty-chat': return { openEmptyConversationOnLaunch: value === 'true' }
    case 'kanban-ai': return { kanbanAiPlanningEnabled: value === 'true' }
  }
}

export async function runCliSettingsCommand(state: CliSessionState, helpers: SlashCommandHelpers): Promise<void> {
  const settings = await getStoredSettings()
  const items: Array<{ id: CliSettingId | CliDefaultModelSettingId; label: string; description: string }> = [
    ...CLI_DEFAULT_MODEL_SETTINGS,
    { id: 'follow-up', label: 'Follow-up keys', description: 'Choose what Enter does; Tab performs the other action' },
    { id: 'terminal-access', label: 'Terminal access', description: 'Full workspace access or sandboxed execution' },
    { id: 'appearance', label: 'Theme', description: 'Desktop appearance preference' },
    { id: 'language', label: 'Language', description: 'Desktop interface language' },
    { id: 'word-wrap', label: 'Workspace editor word wrap', description: 'Wrap long editor lines' },
    { id: 'send-on-enter', label: 'Desktop send on Enter', description: 'Desktop composer send shortcut' },
    { id: 'auto-updates', label: 'Automatic update downloads', description: 'Download releases after an update check' },
    { id: 'open-empty-chat', label: 'Open empty chat on launch', description: 'Start desktop with a fresh conversation' },
    { id: 'kanban-ai', label: 'Kanban AI planning', description: 'Allow AI-assisted Kanban planning' },
  ]
  const selectedId = await helpers.select<CliSettingId | CliDefaultModelSettingId>({
    title: 'TideCode Settings',
    items: items.map((item) => ({
      value: item.id,
      label: item.label,
      description: `${item.description} · Current: ${isCliDefaultModelSettingId(item.id)
        ? getCliDefaultModelSettingValue(item.id, settings)
        : getCurrentValue(item.id, settings, state)}`,
    })),
    pageSize: 10,
    footer: 'These values are shared with the desktop app',
  })
  if (!selectedId) return

  if (isCliDefaultModelSettingId(selectedId)) {
    await runCliDefaultModelSetting(selectedId, helpers)
    return
  }

  const currentValue = getCurrentValue(selectedId, settings, state)
  const selectedValue = await helpers.select<string>({
    title: items.find((item) => item.id === selectedId)?.label ?? 'Setting',
    items: getSettingChoices(selectedId).map((choice) => ({
      value: choice.value,
      label: choice.label,
      isCurrent: choice.value === currentValue,
    })),
    initialIndex: Math.max(0, getSettingChoices(selectedId).findIndex((choice) => choice.value === currentValue)),
    pageSize: 5,
  })
  if (selectedValue === null) return

  const nextSettings = await updateStoredSettings(buildCliSettingsPatch(selectedId, selectedValue))
  state.followUpBehavior = nextSettings.followUpBehavior
  state.terminalExecutionMode = nextSettings.terminalExecutionMode
  helpers.renderSuccess(`${items.find((item) => item.id === selectedId)?.label ?? 'Setting'} saved.`)
}
