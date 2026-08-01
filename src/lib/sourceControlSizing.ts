export const DEFAULT_SOURCE_CONTROL_HISTORY_RATIO = 0.4
export const MIN_SOURCE_CONTROL_HISTORY_HEIGHT = 140
export const MIN_SOURCE_CONTROL_REMAINDER_HEIGHT = 160

export function clampSourceControlHistoryHeight(nextHeight: number, containerHeight: number) {
  const maxHistoryHeight = Math.max(MIN_SOURCE_CONTROL_HISTORY_HEIGHT, containerHeight - MIN_SOURCE_CONTROL_REMAINDER_HEIGHT)
  return Math.min(maxHistoryHeight, Math.max(MIN_SOURCE_CONTROL_HISTORY_HEIGHT, Math.round(nextHeight)))
}

export function getDefaultSourceControlHistoryHeight(containerHeight: number) {
  return clampSourceControlHistoryHeight(Math.round(containerHeight * DEFAULT_SOURCE_CONTROL_HISTORY_RATIO), containerHeight)
}
