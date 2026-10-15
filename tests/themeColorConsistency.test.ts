import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { getThemeColorFallback, type ThemeColorTokenName } from '../src/lib/themeColorTokens'

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_CSS = readFileSync(path.join(REPOSITORY_ROOT, 'src', 'index.css'), 'utf8')

function hexRgb(value: string) {
  assert.match(value, /^#[0-9a-f]{6}$/i)
  return [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16))
}

function channelLuminance(channel: number) {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function luminance(value: string) {
  const [red, green, blue] = hexRgb(value)
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue)
}

function contrast(left: string, right: string) {
  const lighter = Math.max(luminance(left), luminance(right))
  const darker = Math.min(luminance(left), luminance(right))
  return (lighter + 0.05) / (darker + 0.05)
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listFiles(absolutePath)
    return /\.(ts|tsx)$/.test(entry.name) ? [absolutePath] : []
  })
}

test('dark and light palettes move surface contrast in opposite directions', () => {
  const lightBackground = getThemeColorFallback('--color-background', 'light')
  const lightSurface = getThemeColorFallback('--color-surface', 'light')
  const lightMuted = getThemeColorFallback('--color-surface-muted', 'light')
  const lightHover = getThemeColorFallback('--color-surface-hover', 'light')
  assert.ok(luminance(lightSurface) > luminance(lightBackground))
  assert.ok(luminance(lightBackground) > luminance(lightMuted))
  assert.ok(luminance(lightMuted) > luminance(lightHover))

  const darkBackground = getThemeColorFallback('--color-background', 'dark')
  const darkSurface = getThemeColorFallback('--color-surface', 'dark')
  const darkMuted = getThemeColorFallback('--color-surface-muted', 'dark')
  const darkRaised = getThemeColorFallback('--color-surface-raised', 'dark')
  const darkHover = getThemeColorFallback('--color-surface-hover', 'dark')
  assert.ok(luminance(darkBackground) < luminance(darkSurface))
  assert.ok(luminance(darkSurface) < luminance(darkMuted))
  assert.ok(luminance(darkMuted) < luminance(darkRaised))
  assert.ok(luminance(darkRaised) < luminance(darkHover))
})

test('core text and action pairs meet normal-text contrast targets', () => {
  for (const theme of ['light', 'dark'] as const) {
    assert.ok(contrast(
      getThemeColorFallback('--color-foreground', theme),
      getThemeColorFallback('--color-background', theme),
    ) >= 4.5)
    assert.ok(contrast(
      getThemeColorFallback('--color-muted-foreground', theme),
      getThemeColorFallback('--color-background', theme),
    ) >= 4.5)
    assert.ok(contrast(
      getThemeColorFallback('--color-action-foreground', theme),
      getThemeColorFallback('--color-action', theme),
    ) >= 4.5)
    assert.ok(contrast(
      getThemeColorFallback('--color-action-foreground', theme),
      getThemeColorFallback('--color-action-hover', theme),
    ) >= 4.5)
    assert.ok(contrast(
      getThemeColorFallback('--color-brand-soft-foreground', theme),
      getThemeColorFallback('--color-brand-soft', theme),
    ) >= 4.5)
  }
})

test('runtime fallback tokens are mirrored in the renderer theme source', () => {
  const tokens: ThemeColorTokenName[] = [
    '--color-background',
    '--color-foreground',
    '--color-muted-foreground',
    '--color-subtle-foreground',
    '--color-surface',
    '--color-surface-muted',
    '--color-surface-raised',
    '--color-surface-hover',
    '--color-sidebar',
    '--color-sidebar-muted',
    '--color-border',
    '--color-border-muted',
    '--color-brand',
    '--color-brand-soft',
    '--color-brand-soft-foreground',
    '--color-accent-hover',
    '--color-action',
    '--color-action-hover',
    '--color-action-foreground',
    '--color-switch-off-track',
    '--color-switch-off-thumb',
    '--color-success-foreground',
    '--color-warning-foreground',
    '--color-danger-foreground',
    '--color-info-foreground',
  ]

  for (const theme of ['light', 'dark'] as const) {
    for (const token of tokens) {
      assert.ok(
        INDEX_CSS.includes(`${token}: ${getThemeColorFallback(token, theme)};`),
        `${token} ${theme} fallback must exist in src/index.css`,
      )
    }
  }
})

test('primary actions and checked switches match the selected conversation accent in both themes', () => {
  const lightAction = getThemeColorFallback('--color-action', 'light')
  const darkAction = getThemeColorFallback('--color-action', 'dark')
  const lightText = getThemeColorFallback('--color-action-foreground', 'light')
  const darkText = getThemeColorFallback('--color-action-foreground', 'dark')

  assert.equal(lightAction, '#d9e9e6')
  assert.equal(lightText, '#315f59')
  assert.equal(darkAction, '#223630')
  assert.equal(darkText, '#ffffff')
  assert.ok(luminance(lightText) < luminance(lightAction))
  assert.ok(luminance(darkText) > luminance(darkAction))

  for (const theme of ['light', 'dark'] as const) {
    const action = getThemeColorFallback('--color-action', theme)
    const actionForeground = getThemeColorFallback('--color-action-foreground', theme)
    assert.equal(action, getThemeColorFallback('--color-brand-soft', theme))
    if (theme === 'light') {
      assert.equal(actionForeground, getThemeColorFallback('--color-brand-soft-foreground', theme))
    } else {
      assert.equal(actionForeground, '#ffffff')
    }
    assert.equal(getThemeColorFallback('--color-action-hover', theme), getThemeColorFallback('--color-accent-hover', theme))
    assert.ok(contrast(action, actionForeground) >= 4.5)
    assert.ok(contrast(
      getThemeColorFallback('--color-switch-off-track', theme),
      getThemeColorFallback('--color-surface', theme),
    ) >= 3)
    assert.ok(contrast(
      getThemeColorFallback('--color-switch-off-thumb', theme),
      getThemeColorFallback('--color-switch-off-track', theme),
    ) >= 3)
  }

  const switchSource = readFileSync(path.join(REPOSITORY_ROOT, 'src', 'components', 'ui', 'Switch.tsx'), 'utf8')
  const historySource = readFileSync(path.join(REPOSITORY_ROOT, 'src', 'components', 'sidebar', 'ConversationHistoryItem.tsx'), 'utf8')
  const mcpCardSource = readFileSync(path.join(REPOSITORY_ROOT, 'src', 'components', 'settings', 'mcp', 'McpServerCard.tsx'), 'utf8')
  assert.match(historySource, /bg-\[var\(--sidebar-item-active-surface\)\]/)
  assert.match(INDEX_CSS, /--sidebar-item-active-surface: var\(--color-brand-soft\)/)
  assert.match(switchSource, /checked \? 'bg-action' : 'bg-switch-off-track'/)
  assert.match(switchSource, /checked \? 'bg-action-foreground' : 'bg-switch-off-thumb'/)
  assert.match(INDEX_CSS, /\.provider-primary-action-button\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--sidebar-item-active-border\)/s)
  assert.match(INDEX_CSS, /button\.bg-action\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--sidebar-item-active-border\)/s)
  assert.doesNotMatch(mcpCardSource, /backgroundColor:\s*['"]var\(--color-brand-action\)/)
  assert.match(mcpCardSource, /bg-action text-action-foreground hover:bg-action-hover/)
})

test('Commit split action uses one shared outline and one dropdown divider', () => {
  const source = readFileSync(path.join(REPOSITORY_ROOT, 'src', 'components', 'sourceControl', 'SourceControlChangesSection.tsx'), 'utf8')
  const start = source.indexOf('ref={commitActionControlsRef}')
  const end = source.indexOf('{isCommitActionMenuOpen ? (', start)
  assert.ok(start >= 0 && end > start)
  const splitButtons = source.slice(start, end)

  assert.match(splitButtons, /overflow-hidden rounded-lg border border-\[var\(--sidebar-item-active-border\)\]/)
  assert.match(splitButtons, /border-l border-\[var\(--commit-action-divider\)\]/)
  assert.match(INDEX_CSS, /--commit-action-divider: var\(--sidebar-item-active-border\);/)
  assert.match(INDEX_CSS, /--commit-action-divider: rgb\(255 255 255 \/ 0\.26\);/)
  assert.equal((splitButtons.match(/border-l /g) ?? []).length, 1)
  assert.equal((splitButtons.match(/bg-transparent/g) ?? []).length, 2)
  assert.doesNotMatch(splitButtons, /chat-send-button-(?:enabled|disabled)/)
})

test('green selected states show accent borders only in light mode', () => {
  const darkThemeBlock = INDEX_CSS.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)^\s*\}/m)?.[1]
  assert.ok(darkThemeBlock)
  assert.match(INDEX_CSS, /--color-brand-border: #789a93;/)
  assert.match(INDEX_CSS, /--sidebar-item-active-border: color-mix\(/)
  assert.match(darkThemeBlock, /--color-brand-border: transparent;/)
  assert.match(darkThemeBlock, /--sidebar-item-active-border: transparent;/)
  assert.match(darkThemeBlock, /--commit-action-divider: rgb\(255 255 255 \/ 0\.26\);/)
  assert.match(darkThemeBlock, /--color-action-foreground: #ffffff;/)

  const component = (filePath: string) => readFileSync(path.join(REPOSITORY_ROOT, 'src', 'components', filePath), 'utf8')
  assert.match(component('sidebar/ConversationHistoryItem.tsx'), /border-\[var\(--sidebar-item-active-border\)\] bg-\[var\(--sidebar-item-active-surface\)\]/)
  assert.match(component('sidebar/ConversationHistoryItem.tsx'), /bg-\[var\(--sidebar-item-active-surface\)\] shadow-sm/)
  assert.match(component('sidebar/ConversationHistoryItem.tsx'), /: 'border-transparent hover:bg-\[var\(--sidebar-hover-surface\)\]'/)
  assert.match(component('settings/SettingsSidebarPanel.tsx'), /border-\[var\(--sidebar-item-active-border\)\] bg-\[var\(--sidebar-item-active-surface\)\]/)
  assert.doesNotMatch(component('settings/general/GeneralSettingsPanel.tsx'), /selectedOptionClassName=/)
  assert.match(component('settings/providers/CodexAccountDropdown.tsx'), /<DropdownField/u)
  assert.match(component('settings/providers/CodexAccountsList.tsx'), /border-brand-border bg-brand-soft/)
  assert.match(component('settings/remote/RemoteSettingsPanel.tsx'), /border-brand-border bg-brand-soft/)
  assert.match(component('settings/remote/RemoteSettingsPanel.tsx'), /const PRIMARY_BUTTON_CLASS = '[^']*bg-action[^']*text-foreground/)
  assert.match(component('settings/updates/UpdatesSettingsPanel.tsx'), /className="[^"]*bg-action[^"]*text-foreground/)
  assert.match(component('chat/ChatImageReferenceLabel.tsx'), /border-\[var\(--sidebar-item-active-border\)\]/)
  assert.match(component('ChatInput.tsx'), /border-\[var\(--sidebar-item-active-border\)\] bg-action\/10/)
  const publishModal = component('sourceControl/PublishToGitHubModal.tsx')
  assert.equal((publishModal.match(/border-brand-border bg-brand\/10 text-foreground/g) ?? []).length, 2)
  assert.doesNotMatch(publishModal, /ring-1 ring-brand\/30/)
  assert.match(INDEX_CSS, /\.chat-send-button-enabled\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--sidebar-item-active-border\)/s)
  assert.match(INDEX_CSS, /\.provider-primary-action-button\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--sidebar-item-active-border\)/s)
  assert.match(INDEX_CSS, /\.chat-send-button-enabled\s*\{[^}]*color:\s*var\(--color-foreground\)/s)
  assert.match(INDEX_CSS, /\.provider-primary-action-button\s*\{[^}]*color:\s*var\(--color-foreground\)/s)
  assert.match(darkThemeBlock, /--color-foreground: #e9e9ea;/)
  assert.match(INDEX_CSS, /:root\[data-theme='dark'\] \.chat-send-button-enabled\s*\{[^}]*color:\s*var\(--color-foreground\)/s)
  assert.match(INDEX_CSS, /:root\[data-theme='dark'\] \.provider-primary-action-button\s*\{[^}]*color:\s*var\(--color-foreground\)/s)
  for (const filePath of ['models/ModelsSettingsPanel.tsx', 'mcp/McpServersSettingsPanel.tsx', 'skills/SkillsSettingsPanel.tsx']) {
    assert.match(component(`settings/${filePath}`), /provider-primary-action-button/u)
  }
  assert.match(component('workspaceExplorer/workspacePlanPreview/WorkspacePlanActionsMenu.tsx'), /border-l border-\[var\(--sidebar-item-active-border\)\]/)
})

test('Settings views do not bypass the semantic palette with raw theme variants', () => {
  const settingsRoot = path.join(REPOSITORY_ROOT, 'src', 'components', 'settings')
  const source = listFiles(settingsRoot).map((filePath) => readFileSync(filePath, 'utf8')).join('\n')
  assert.doesNotMatch(source, /\bdark:/)
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i)
  assert.doesNotMatch(source, /\b(?:bg|text|border)-(?:red|amber|emerald|blue|white|black|neutral|gray)-/)
})

test('app-owned overlays use the shared backdrop role', () => {
  const sourceRoot = path.join(REPOSITORY_ROOT, 'src')
  const source = listFiles(sourceRoot).map((filePath) => readFileSync(filePath, 'utf8')).join('\n')
  assert.doesNotMatch(source, /\bbg-black\/\d+/)
  assert.doesNotMatch(source, /surface-muted-hover/)
})

test('app-owned views do not reintroduce component-local light/dark palette utilities', () => {
  const sourceRoot = path.join(REPOSITORY_ROOT, 'src')
  const allowedRawUtilityFiles = new Set([
    path.join(sourceRoot, 'components', 'browser', 'BrowserPanel.tsx'),
    path.join(sourceRoot, 'components', 'sourceControl', 'PublishToGitHubModal.tsx'),
    path.join(sourceRoot, 'components', 'workspaceExplorer', 'workspacePdfPreview', 'WorkspacePdfPage.tsx'),
  ])
  const rawPalettePattern = /\b(?:bg|text|border|ring|fill|stroke)-(?:red|blue|green|yellow|amber|orange|slate|zinc|neutral|gray|stone|white|black|emerald|sky|indigo|purple|pink|rose|teal|cyan)(?:-\d{2,3})?(?:\/\d+)?\b/g

  for (const filePath of listFiles(sourceRoot)) {
    if (!filePath.endsWith('.tsx')) continue
    const source = readFileSync(filePath, 'utf8')
    assert.doesNotMatch(source, /\bdark:/, `theme-specific utility found in ${path.relative(REPOSITORY_ROOT, filePath)}`)
    if (!allowedRawUtilityFiles.has(filePath)) {
      assert.doesNotMatch(
        source,
        rawPalettePattern,
        `raw palette utility found in ${path.relative(REPOSITORY_ROOT, filePath)}`,
      )
    }
  }
})
