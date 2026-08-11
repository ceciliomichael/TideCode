export interface VariableSizeVirtualRange {
  endIndex: number
  startIndex: number
}

export interface CalculateVariableSizeVirtualRangeInput {
  itemHeights: readonly number[]
  offsets: readonly number[]
  overscanPx: number
  scrollTop: number
  viewportHeight: number
}

export const DEFAULT_INITIAL_VIRTUAL_VIEWPORT_HEIGHT_PX = 720

export function resolveVirtualViewportHeight(
  measuredViewportHeight: number,
  fallbackViewportHeight = DEFAULT_INITIAL_VIRTUAL_VIEWPORT_HEIGHT_PX,
) {
  if (Number.isFinite(measuredViewportHeight) && measuredViewportHeight > 0) {
    return measuredViewportHeight
  }

  return Math.max(1, fallbackViewportHeight)
}

export function calculateVariableSizeVirtualRange({
  itemHeights,
  offsets,
  overscanPx,
  scrollTop,
  viewportHeight,
}: CalculateVariableSizeVirtualRangeInput): VariableSizeVirtualRange {
  const normalizedScrollTop = Math.max(0, scrollTop)
  const normalizedOverscan = Math.max(0, overscanPx)
  const normalizedViewportHeight = Math.max(1, viewportHeight)
  const minVisibleTop = Math.max(0, normalizedScrollTop - normalizedOverscan)
  const maxVisibleBottom = normalizedScrollTop + normalizedViewportHeight + normalizedOverscan
  let startIndex = 0

  while (
    startIndex < itemHeights.length &&
    (offsets[startIndex] ?? 0) + itemHeights[startIndex] < minVisibleTop
  ) {
    startIndex += 1
  }

  let endIndex = startIndex
  while (endIndex < itemHeights.length && (offsets[endIndex] ?? 0) < maxVisibleBottom) {
    endIndex += 1
  }

  return {
    endIndex,
    startIndex,
  }
}
