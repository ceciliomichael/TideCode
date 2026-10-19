export const DEFAULT_SIDEBAR_WIDTH = 336
export const MIN_SIDEBAR_WIDTH = DEFAULT_SIDEBAR_WIDTH

export function getMaxSidebarWidth(viewportWidth: number) {
  return DEFAULT_SIDEBAR_WIDTH + viewportWidth * 0.12
}

export function clampSidebarWidth(sidebarWidth: number, viewportWidth: number) {
  return Math.min(Math.max(sidebarWidth, MIN_SIDEBAR_WIDTH), getMaxSidebarWidth(viewportWidth))
}

export function getMaxSidebarWidthForContent(
  sidebarWidth: number,
  flexibleContentWidth: number,
  minimumContentWidth: number,
) {
  const availableGrowth = Math.max(0, Math.floor(flexibleContentWidth - minimumContentWidth - 8))
  return sidebarWidth + availableGrowth
}
