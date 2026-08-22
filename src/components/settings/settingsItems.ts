export const SETTINGS_ITEMS = [
  {
    id: 'settings-item1',
    label: 'General',
description: 'Theme, language, and preferences for this client.',
  },
  {
    id: 'settings-item2',
    label: 'Providers',
    description: 'Configure AI providers and authentication.',
  },
  {
    id: 'settings-item3',
    label: 'Models',
description: 'Choose shared model availability per provider.',
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
description: 'Set client chat defaults and shared task models.',
  },
  {
    id: 'settings-item8',
    label: 'Remote',
    description: 'Manage browser access, network addresses, port, and web login.',
  },
  {
    id: 'settings-item7',
    label: 'Updates',
    description: 'Check for new TideCode releases and download them when ready.',
  },
] as const

export type SettingsItem = (typeof SETTINGS_ITEMS)[number]
export type SettingsItemId = SettingsItem['id']

export const DEFAULT_SETTINGS_ITEM_ID: SettingsItemId = SETTINGS_ITEMS[0].id

export function getVisibleSettingsItems(surface: 'desktop' | 'web', hasRemoteHost: boolean) {
  return SETTINGS_ITEMS.filter((item) => {
    if (item.id === 'settings-item8') return surface === 'desktop' && hasRemoteHost
    if (item.id === 'settings-item7') return surface === 'desktop'
    return true
  })
}

export function getSettingsItem(itemId: SettingsItemId) {
  return SETTINGS_ITEMS.find((item) => item.id === itemId) ?? SETTINGS_ITEMS[0]
}
