import type { AppSettings } from '../../src/types/chat'
import { FOLLOW_UP_BEHAVIOR_OPTIONS } from '../../src/lib/appSettings'
import { getStoredSettings, updateStoredSettings } from '../settings/store'
import {
  CLI_DEFAULT_MODEL_SETTINGS,
  getCliDefaultModelSettingValue,
  isCliDefaultModelSettingId,
  runCliDefaultModelSetting,
  type CliDefaultModelSettingId,
} from './cliDefaultModelSettings'
import type { CliSessionState, SlashCommandHelpers } from './types'

type CliSettingId = 'follow-up' | 'terminal-access' | 'kanban-ai'

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
    case 'kanban-ai':
      return booleanChoices()
  }
}

function getCurrentValue(id: CliSettingId, settings: AppSettings, state: CliSessionState): string {
  switch (id) {
    case 'follow-up': return settings.followUpBehavior
    case 'terminal-access': return state.terminalExecutionMode
    case 'kanban-ai': return String(settings.kanbanAiPlanningEnabled)
  }
}

export function buildCliSettingsPatch(id: CliSettingId, value: string): Partial<AppSettings> {
  switch (id) {
    case 'follow-up': return { followUpBehavior: value === 'steer' ? 'steer' : 'queue' }
    case 'terminal-access': return { terminalExecutionMode: value === 'sandbox' ? 'sandbox' : 'full' }
    case 'kanban-ai': return { kanbanAiPlanningEnabled: value === 'true' }
  }
}

export async function runCliSettingsCommand(state: CliSessionState, helpers: SlashCommandHelpers): Promise<void> {
  const settings = await getStoredSettings('cli')
  const items: Array<{ id: CliSettingId | CliDefaultModelSettingId; label: string; description: string }> = [
    ...CLI_DEFAULT_MODEL_SETTINGS,
    { id: 'follow-up', label: 'Follow-up keys', description: 'CLI Enter/Tab behavior' },
    { id: 'terminal-access', label: 'Terminal access', description: 'CLI execution access for this client' },
    { id: 'kanban-ai', label: 'Kanban AI planning', description: 'Shared across TideCode' },
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
    footer: 'CLI preferences stay in CLI · Shared service settings are labeled',
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

  const nextSettings = await updateStoredSettings(buildCliSettingsPatch(selectedId, selectedValue), 'cli')
  state.followUpBehavior = nextSettings.followUpBehavior
  state.terminalExecutionMode = nextSettings.terminalExecutionMode
  helpers.renderSuccess(`${items.find((item) => item.id === selectedId)?.label ?? 'Setting'} saved.`)
}
