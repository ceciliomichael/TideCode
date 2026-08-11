export const DEFAULT_SCROLL_BOTTOM_THRESHOLD_PX = 48
export const SCROLL_FOLLOW_RESUME_THRESHOLD_PX = 48
export const SCROLL_DIRECTION_EPSILON_PX = 1

export interface ScrollContainerMetricsSource {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

export interface ScrollContainerMetrics {
  distanceFromBottom: number
  maxScrollTop: number
}

export interface ScrollContainerSnapshot extends ScrollContainerMetrics {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

export interface ResolveScrollFollowingInput {
  current: ScrollContainerSnapshot
  isFollowingLatest: boolean
  previous: ScrollContainerSnapshot
}

export function getScrollContainerMetrics(container: ScrollContainerMetricsSource): ScrollContainerMetrics {
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const distanceFromBottom = Math.max(0, maxScrollTop - container.scrollTop)

  return {
    distanceFromBottom,
    maxScrollTop,
  }
}

export function getScrollContainerSnapshot(container: ScrollContainerMetricsSource): ScrollContainerSnapshot {
  return {
    ...getScrollContainerMetrics(container),
    clientHeight: container.clientHeight,
    scrollHeight: container.scrollHeight,
    scrollTop: container.scrollTop,
  }
}

export function isNearScrollBottom(
  container: ScrollContainerMetricsSource,
  thresholdPx = DEFAULT_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  return getScrollContainerMetrics(container).distanceFromBottom <= thresholdPx
}

export function isScrollingUp(
  previousScrollTop: number,
  currentScrollTop: number,
  epsilonPx = SCROLL_DIRECTION_EPSILON_PX,
): boolean {
  return currentScrollTop < previousScrollTop - epsilonPx
}

export function isScrollingDown(
  previousScrollTop: number,
  currentScrollTop: number,
  epsilonPx = SCROLL_DIRECTION_EPSILON_PX,
): boolean {
  return currentScrollTop > previousScrollTop + epsilonPx
}

export function didScrollableRangeShrink(
  previous: ScrollContainerSnapshot,
  current: ScrollContainerSnapshot,
  epsilonPx = SCROLL_DIRECTION_EPSILON_PX,
): boolean {
  return current.maxScrollTop < previous.maxScrollTop - epsilonPx
}

export function resolveScrollFollowing({
  current,
  isFollowingLatest,
  previous,
}: ResolveScrollFollowingInput): boolean {
  const movedUp = isScrollingUp(previous.scrollTop, current.scrollTop)

  if (movedUp && !didScrollableRangeShrink(previous, current)) {
    return false
  }

  if (
    !isFollowingLatest &&
    isScrollingDown(previous.scrollTop, current.scrollTop) &&
    current.distanceFromBottom <= SCROLL_FOLLOW_RESUME_THRESHOLD_PX
  ) {
    return true
  }

  return isFollowingLatest
}
