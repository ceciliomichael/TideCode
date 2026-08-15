import { colors } from './renderer'
import { truncateVisible, visibleWidth } from './terminalText'
import type { TerminalActivityView } from './terminalView'

export function renderTerminalActivityLine(
  activity: TerminalActivityView,
  width: number,
  thinkingFrame: string,
): string {
  const glyph = activity.kind === 'thinking' ? thinkingFrame : '◆'
  const glyphColor = activity.kind === 'thinking' ? colors.accent : colors.warning
  const contentWidth = Math.max(1, width - 2)
  const textWidth = Math.max(0, contentWidth - visibleWidth(glyph) - 1)
  const label = truncateVisible(activity.label, textWidth)
  const detailWidth = activity.detail
    ? textWidth - visibleWidth(activity.label) - visibleWidth(' · ')
    : 0
  const detail = activity.detail && detailWidth > 0 && label === activity.label
    ? ` ${colors.separator}·${colors.reset} ${colors.subtle}${truncateVisible(activity.detail, detailWidth)}${colors.reset}`
    : ''
  const content = `${glyphColor}${glyph}${colors.reset} ${colors.subtle}${label}${colors.reset}${detail}`
  return `  ${content}`
}
