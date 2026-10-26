import type { WebContents } from 'electron'

export interface AgentViewport {
  width: number
  height: number
}

export const DEFAULT_AGENT_VIEWPORT: Readonly<AgentViewport> = Object.freeze({ width: 1440, height: 900 })
const viewports = new WeakMap<WebContents, Readonly<AgentViewport>>()

export function resolveAgentViewport(input: { width?: unknown; height?: unknown } = {}): Readonly<AgentViewport> {
  const width = input.width === undefined ? DEFAULT_AGENT_VIEWPORT.width : input.width
  const height = input.height === undefined ? DEFAULT_AGENT_VIEWPORT.height : input.height
  for (const [name, value] of [['width', width], ['height', height]] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4096) {
      throw new Error(`Browser viewport ${name} must be an integer between 1 and 4096 pixels.`)
    }
  }
  return Object.freeze({ width: width as number, height: height as number })
}

export function getAgentViewport(contents: WebContents): Readonly<AgentViewport> {
  return viewports.get(contents) ?? DEFAULT_AGENT_VIEWPORT
}

export function rememberAgentViewport(contents: WebContents, viewport: AgentViewport) {
  viewports.set(contents, resolveAgentViewport(viewport))
}
