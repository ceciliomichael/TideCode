import { colors } from './renderer'
import { splitTerminalToolLabel } from './terminalToolLabel'

export type TerminalToolStatus = 'completed' | 'failed' | 'running'

export function renderTerminalToolRowText(
  label: string,
  status: TerminalToolStatus,
  detail?: string,
): string {
  const { action, subject } = splitTerminalToolLabel(label)
  const actionColor = status === 'failed'
    ? colors.danger
    : status === 'completed'
      ? colors.success
      : colors.warning
  const subjectText = subject ? ` ${colors.muted}${subject}${colors.reset}` : ''
  const visibleDetail = detail?.trim().toLowerCase() === 'failed' ? '' : detail?.trim()
  const detailText = visibleDetail ? ` ${colors.subtle}· ${visibleDetail}${colors.reset}` : ''

  return `${colors.bold}${actionColor}[${action}]${colors.reset}${subjectText}${detailText}`
}
