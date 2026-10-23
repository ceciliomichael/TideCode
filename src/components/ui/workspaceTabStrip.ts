import type { WheelEvent } from 'react'

// The action divider overlaps a tab's right border and paints above clipped tabs.
export const WORKSPACE_TAB_ACTIONS_CLASS_NAME = 'relative z-10 -ml-px flex shrink-0 items-center gap-1 border-l border-border bg-background px-2'

export function handleWorkspaceTabStripWheel(event: WheelEvent<HTMLDivElement>) {
  const viewport = event.currentTarget
  if (viewport.scrollWidth <= viewport.clientWidth) {
    return
  }
  const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
  if (delta === 0) {
    return
  }
  event.preventDefault()
  viewport.scrollLeft += delta
}
