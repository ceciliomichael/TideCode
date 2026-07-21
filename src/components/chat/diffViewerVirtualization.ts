export interface VisibleDiffRangeInput {
  elementTop: number
  lineHeight: number
  overscanCount: number
  totalLineCount: number
  viewportHeight: number
  viewportTop: number
}

export interface VisibleDiffRange {
  endIndex: number
  startIndex: number
}

export function calculateVisibleDiffRange({
  elementTop,
  lineHeight,
  overscanCount,
  totalLineCount,
  viewportHeight,
  viewportTop,
}: VisibleDiffRangeInput): VisibleDiffRange {
  if (lineHeight <= 0 || totalLineCount <= 0) {
    return { endIndex: 0, startIndex: 0 }
  }

  const relativeViewportTop = Math.max(0, viewportTop - elementTop)
  const relativeViewportBottom = Math.max(0, viewportTop + Math.max(0, viewportHeight) - elementTop)
  const visibleStartIndex = Math.floor(relativeViewportTop / lineHeight)
  const visibleEndIndex = Math.ceil(relativeViewportBottom / lineHeight)

  return {
    endIndex: Math.min(totalLineCount, visibleEndIndex + Math.max(0, overscanCount)),
    startIndex: Math.max(0, visibleStartIndex - Math.max(0, overscanCount)),
  }
}
