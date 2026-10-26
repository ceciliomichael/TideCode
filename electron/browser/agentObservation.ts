import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { AgentViewport } from './agentViewport'

interface AgentObservation {
  id: string
  url: string
  width: number
  height: number
}

const observations = new WeakMap<WebContents, AgentObservation>()

export function rememberAgentObservation(contents: WebContents, viewport: AgentViewport) {
  const observation: AgentObservation = {
    id: randomUUID(),
    url: contents.getURL(),
    width: viewport.width,
    height: viewport.height,
  }
  observations.set(contents, observation)
  return observation.id
}

export function clearAgentObservation(contents: WebContents) {
  observations.delete(contents)
}

export function assertAgentObservation(contents: WebContents, id: string | undefined, viewport: AgentViewport) {
  const previous = observations.get(contents)
  if (!id || !previous || previous.id !== id || previous.url !== contents.getURL()
    || previous.width !== viewport.width || previous.height !== viewport.height) {
    throw new Error('The coordinate target is stale. Read the page again and use its latest observation_id.')
  }
}
