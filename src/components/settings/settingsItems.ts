export const SETTINGS_ITEMS = [
  {
    id: 'settings-item1',
    label: 'General',
    description: 'Language and application-wide preferences.',
  },
  {
    id: 'settings-item2',
    label: 'Providers',
    description: 'Configure AI providers and authentication.',
  },
  {
    id: 'settings-item3',
    label: 'Models',
    description: 'Choose which models are available per provider.',
  },
  {
    id: 'settings-item4',
    label: 'MCP Servers',
    description: 'Configure and connect external MCP servers.',
  },
  {
    id: 'settings-item5',
    label: 'Skills',
    description: 'Manage skills and instruction packs available to the assistant.',
  },
  {
    id: 'settings-item6',
    label: 'Configuration',
    description: 'Set default models for Agent, Plan, summarization, and Git/PR flows.',
  },
] as const

export type SettingsItem = (typeof SETTINGS_ITEMS)[number]
export type SettingsItemId = SettingsItem['id']

export const DEFAULT_SETTINGS_ITEM_ID: SettingsItemId = SETTINGS_ITEMS[0].id

export function getSettingsItem(itemId: SettingsItemId) {
  return SETTINGS_ITEMS.find((item) => item.id === itemId) ?? SETTINGS_ITEMS[0]
}
