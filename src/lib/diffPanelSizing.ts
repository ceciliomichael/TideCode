import { MIN_CHAT_PANEL_WIDTH } from './chatPanelSizing'

export const DEFAULT_DIFF_PANEL_WIDTH = 448
export const MIN_DIFF_PANEL_WIDTH = 320
export const MAX_DIFF_PANEL_WIDTH = 760

export function getMinDiffPanelWidth(parentWidth: number) {
  return Math.max(
    0,
    Math.min(Math.max(MIN_DIFF_PANEL_WIDTH, Math.round(parentWidth * 0.30)), parentWidth - MIN_CHAT_PANEL_WIDTH),
  )
}

export function getMaxDiffPanelWidth(parentWidth: number) {
  return Math.max(
    getMinDiffPanelWidth(parentWidth),
    Math.min(MAX_DIFF_PANEL_WIDTH, Math.round(parentWidth * 0.75), parentWidth - MIN_CHAT_PANEL_WIDTH),
  )
}

export function clampStoredDiffPanelWidth(diffPanelWidth: number) {
  return Math.max(MIN_DIFF_PANEL_WIDTH, Math.round(diffPanelWidth))
}
