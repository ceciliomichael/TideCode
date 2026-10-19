/** Floating widgets in a tall iframe must fit its visible parent-chat region. */
export function getOverlayViewport(element: Element | null) {
  const visual = window.visualViewport
  const left = visual?.offsetLeft ?? 0
  const top = visual?.offsetTop ?? 0
  const fallback = { left, top, right: left + (visual?.width ?? window.innerWidth), bottom: top + (visual?.height ?? window.innerHeight) }
  const root = element?.getRootNode()
  if (!(root instanceof ShadowRoot)) return fallback
  const serialized = root.ownerDocument.documentElement.dataset.tidecodeViewport
  if (!serialized) return fallback
  try {
    const bounds = JSON.parse(serialized) as typeof fallback
    if (Object.values(bounds).length === 4 && Object.values(bounds).every(Number.isFinite) && bounds.right >= bounds.left && bounds.bottom >= bounds.top) return bounds
  } catch {
    return fallback
  }
  return fallback
}
