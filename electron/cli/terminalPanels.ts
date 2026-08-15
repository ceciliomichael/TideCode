import type { ChatMode } from '../../src/types/chat'
import { colors, getTerminalWidth } from './renderer'
import { padVisible, truncateVisible, visibleWidth } from './terminalText'
import type { CompletionItemView } from './terminalView'
import { formatCliImageReferenceInText } from './cliImageAttachments'

const LABEL_WIDTH = 10

export interface TerminalSessionPanelData {
  workspace: string
  model: string
  provider: string
  mode: ChatMode
  permissions?: string
}

export interface TerminalPromptPanelData {
  title?: string
  visualLines: readonly string[]
  placeholder: string
  completionItems: readonly CompletionItemView[]
  completionIndex: number
  composerWidth: number
  cursorColumn: number
  cursorRow: number
  statusLine?: string
}

export interface TerminalPromptPanel {
  lines: string[]
  cursorRow: number
  cursorColumn: number
}

export function getTerminalPanelWidth(): number {
  return Math.max(20, getTerminalWidth())
}

function borderLine(left: string, right: string, width: number, color: string): string {
  return `${color}${left}${'─'.repeat(Math.max(0, width - 2))}${right}${colors.reset}`
}

function titledBorder(title: string, width: number): string {
  const cleanTitle = truncateVisible(title, Math.max(1, width - 6))
  const prefix = `╭─ ${cleanTitle} `
  const fill = Math.max(0, width - visibleWidth(prefix) - 1)
  return `${colors.accent}${prefix}${'─'.repeat(fill)}╮${colors.reset}`
}

function panelRow(content: string, width: number, color = colors.separator): string {
  const innerWidth = Math.max(1, width - 2)
  const clipped = truncateVisible(content, innerWidth - 2)
  return `${color}│${colors.reset} ${padVisible(clipped, innerWidth - 2)} ${color}│${colors.reset}`
}

function detailRow(label: string, value: string, width: number, valueColor = colors.foreground): string {
  const innerWidth = Math.max(1, width - 2)
  const availableValueWidth = Math.max(1, innerWidth - LABEL_WIDTH - 3)
  const labelText = padVisible(truncateVisible(label, LABEL_WIDTH), LABEL_WIDTH)
  const valueText = truncateVisible(value, availableValueWidth)
  const content = `${colors.muted}${labelText}${colors.reset} ${valueColor}${valueText}${colors.reset}`
  return panelRow(content, width)
}

function modeValue(mode: ChatMode): string {
  return mode === 'plan'
    ? `${colors.warning}● plan${colors.reset}`
    : `${colors.accent}● agent${colors.reset}`
}

function providerDisplayName(provider: string): string {
  return provider.startsWith('custom:') ? 'custom' : provider
}

export function renderSessionPanel(session: TerminalSessionPanelData): string[] {
  const terminalWidth = getTerminalPanelWidth()
  const permission = session.permissions || 'sandboxed'
  const provider = providerDisplayName(session.provider)
  const sessionValue = `${modeValue(session.mode)} ${colors.subtle}·${colors.reset} ${colors.foreground}${session.model}${colors.reset} ${colors.subtle}[${truncateVisible(provider, 14)}]${colors.reset}`
  const widestValue = Math.max(
    visibleWidth(session.workspace),
    visibleWidth(sessionValue),
    visibleWidth(permission),
  )
  const fittedWidth = LABEL_WIDTH + 1 + widestValue + 4
  const width = Math.min(terminalWidth, Math.max(20, fittedWidth))
  return [
    titledBorder('TideCode', width),
    detailRow('workspace', session.workspace, width),
    detailRow('session', sessionValue, width),
    detailRow('access', permission, width, permission === 'full access' ? colors.success : colors.warning),
    borderLine('╰', '╯', width, colors.accent),
  ]
}

function promptRow(content: string, width: number, left = '│', right = '│'): string {
  const innerWidth = Math.max(1, width - 2)
  const clipped = truncateVisible(content, innerWidth - 2)
  return `${colors.separator}${left}${colors.reset} ${padVisible(clipped, innerWidth - 2)} ${colors.separator}${right}${colors.reset}`
}

function completionRow(item: CompletionItemView, index: number, selectedIndex: number, width: number): string {
  const marker = index === selectedIndex ? `${colors.accent}›${colors.reset}` : ' '
  const label = index === selectedIndex ? `${colors.bold}${colors.foreground}${item.label}${colors.reset}` : `${colors.foreground}${item.label}${colors.reset}`
  const description = item.description && width >= 64 ? ` ${colors.subtle}${item.description}${colors.reset}` : ''
  return promptRow(`${marker} ${label}${description}`, width)
}

export function renderPromptPanel(data: TerminalPromptPanelData): TerminalPromptPanel {
  const width = getTerminalPanelWidth()
  const composerWidth = Math.max(1, Math.min(data.composerWidth, width - 6))
  const hasText = data.visualLines.some((line) => line.length > 0)
  const bodyLines = data.visualLines.length > 0 ? data.visualLines : ['']
  const lines: string[] = [titledBorder(data.title || 'compose', width)]

  bodyLines.forEach((line, index) => {
    const prefix = index === 0 ? `${colors.accent}›${colors.reset} ` : '  '
    const body = hasText ? formatCliImageReferenceInText(line) : index === 0 ? `${colors.subtle}${data.placeholder}${colors.reset}` : line
    lines.push(promptRow(`${prefix}${truncateVisible(body, composerWidth)}`, width))
  })

  const cursorRow = 1 + Math.max(0, Math.min(data.cursorRow, bodyLines.length - 1))
  if (data.completionItems.length > 0) {
    lines.push(borderLine('├', '┤', width, colors.separator))
    const visibleItems = data.completionItems.slice(0, 6)
    visibleItems.forEach((item, index) => lines.push(completionRow(item, index, data.completionIndex, width)))
  }
  lines.push(borderLine('╰', '╯', width, colors.separator))
  if (data.statusLine) lines.push(data.statusLine)

  return {
    lines,
    cursorRow,
    cursorColumn: 4 + Math.min(Math.max(0, data.cursorColumn), composerWidth),
  }
}
