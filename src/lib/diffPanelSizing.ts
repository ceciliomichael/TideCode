export const DEFAULT_DIFF_PANEL_WIDTH = 448
export const MIN_DIFF_PANEL_WIDTH = 100
export const MAX_DIFF_PANEL_WIDTH = 760

export function getMinDiffPanelWidth(parentWidth: number) {
  return Math.max(MIN_DIFF_PANEL_WIDTH, Math.round(parentWidth * 0.20))
}

export function getMaxDiffPanelWidth(parentWidth: number) {
  return Math.max(getMinDiffPanelWidth(parentWidth), Math.min(MAX_DIFF_PANEL_WIDTH, Math.round(parentWidth * 0.75)))
}

export function clampStoredDiffPanelWidth(diffPanelWidth: number) {
  return Math.max(MIN_DIFF_PANEL_WIDTH, Math.round(diffPanelWidth))
}
