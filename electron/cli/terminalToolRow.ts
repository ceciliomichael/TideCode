import { colors } from './renderer'
import { truncateVisible, visibleWidth } from './terminalText'
import { splitTerminalToolLabel } from './terminalToolLabel'

export type TerminalToolStatus = 'completed' | 'failed' | 'running'

function normalizeTerminalToolDisplayText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

export function renderTerminalToolRowText(
  label: string,
  status: TerminalToolStatus,
  detail?: string,
  maxWidth?: number,
): string {
  const normalizedLabel = normalizeTerminalToolDisplayText(label)
  const { action, subject } = splitTerminalToolLabel(normalizedLabel)
  const actionColor = status === 'failed'
    ? colors.danger
    : status === 'completed'
      ? colors.success
      : colors.warning
  const subjectText = subject ? ` ${colors.muted}${subject}${colors.reset}` : ''
  const normalizedDetail = detail ? normalizeTerminalToolDisplayText(detail) : ''
  const visibleDetail = normalizedDetail.toLowerCase() === 'failed' ? '' : normalizedDetail
  const detailText = visibleDetail ? ` ${colors.subtle}· ${visibleDetail}${colors.reset}` : ''
  const actionText = `${colors.bold}${actionColor}[${action}]${colors.reset}`
  const fullText = `${actionText}${subjectText}${detailText}`

  if (maxWidth === undefined || visibleWidth(fullText) <= maxWidth) return fullText

  const actionWidth = visibleWidth(`[${action}]`)
  if (maxWidth <= actionWidth) return truncateVisible(`[${action}]`, maxWidth)

  const plainTail = `${subject ? ` ${subject}` : ''}${visibleDetail ? ` · ${visibleDetail}` : ''}`
  const clippedTail = truncateVisible(plainTail, Math.max(0, maxWidth - actionWidth))
  return `${actionText}${clippedTail ? `${colors.muted}${clippedTail}${colors.reset}` : ''}`
}
