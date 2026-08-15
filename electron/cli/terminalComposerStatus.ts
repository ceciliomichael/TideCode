import type { ChatMode, ReasoningEffort } from '../../src/types/chat'
import { colors } from './renderer'
import { padVisible, truncateVisible, visibleWidth } from './terminalText'

export interface TerminalComposerStatusData {
  mode: ChatMode
  model: string
  reasoningEffort: ReasoningEffort
  contextPercent: number
  codexUsage?: string
}

export function renderTerminalComposerStatus(data: TerminalComposerStatusData, width: number): string {
  const safePercent = Math.max(0, Math.min(100, data.contextPercent))
  const leftPlain = `${data.mode} · ${data.model} · ${data.reasoningEffort}`
  const rightPlain = [data.codexUsage, `Context ${safePercent.toFixed(1)}%`].filter(Boolean).join(' · ')
  const contentWidth = Math.max(1, width - 4)
  const rightWidth = Math.min(visibleWidth(rightPlain), Math.floor(contentWidth * 0.46))
  const gap = rightWidth > 0 ? 2 : 0
  const leftWidth = Math.max(1, contentWidth - rightWidth - gap)
  const left = truncateVisible(leftPlain, leftWidth)
  const right = truncateVisible(rightPlain, rightWidth)
  const spacing = ' '.repeat(Math.max(gap, contentWidth - visibleWidth(left) - visibleWidth(right)))
  return `  ${colors.subtle}${left}${colors.reset}${spacing}${colors.subtle}${right}${colors.reset}${padVisible('', Math.max(0, width - 2 - contentWidth))}`
}
