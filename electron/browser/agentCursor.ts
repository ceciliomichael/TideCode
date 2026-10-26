import type { WebContents } from 'electron'

export interface AgentCursorPosition {
  x: number
  y: number
  kind?: string
  effect?: 'click' | 'drag'
  revision?: number
  motionRevision?: number
}

const positions = new WeakMap<WebContents, AgentCursorPosition>()
const observers = new WeakMap<WebContents, (position: AgentCursorPosition) => void>()

export function observeAgentCursor(contents: WebContents, callback: (position: AgentCursorPosition) => void) {
  observers.set(contents, callback)
}

export function moveAgentCursor(contents: WebContents, x: number, y: number, kind = 'default', effect?: 'click' | 'drag') {
  const previous = positions.get(contents)
  const position: AgentCursorPosition = {
    x, y, kind, effect,
    revision: (previous?.revision ?? 0) + 1,
    motionRevision: (previous?.motionRevision ?? 0)
      + (!previous || previous.x !== x || previous.y !== y ? 1 : 0),
  }
  positions.set(contents, position)
  observers.get(contents)?.(position)
  return position
}

export function getAgentCursor(contents: WebContents): AgentCursorPosition | null {
  return positions.get(contents) ?? null
}
