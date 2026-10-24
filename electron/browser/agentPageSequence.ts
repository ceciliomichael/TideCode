import type { WebContents } from 'electron'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { captureAgentPageInViewport, withAgentViewport } from './agentPageCapture'
import type { CdpSend } from './agentCdpSession'
import { getAgentViewport, type AgentViewport } from './agentViewport'
import { interactWithAgentPageInViewport, validateBrowserInteraction, type AgentBrowserInteraction } from './agentPageInput'
import { formatBrowserElements, readBrowserStructureInViewport } from './agentPageStructure'
import { requireBrowserUrl } from './agentTabs'

export type AgentBrowserStep = (AgentBrowserInteraction
  | { action: 'wait'; duration_ms: number }
  | { action: 'read'; view?: 'visual' | 'structure' | 'combined'; offset?: number; limit?: number }
) & { label?: string }

export interface BrowserSequenceCapture {
  step: number
  label: string
  started_ms: number
  completed_ms: number
  body: string
  imageBase64?: string
}

export interface BrowserSequenceResult {
  completed_steps: number
  failed_step?: number
  error?: string
  elapsed_ms: number
  captures: BrowserSequenceCapture[]
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function validateBrowserSequence(input: unknown): asserts input is AgentBrowserStep[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 32) {
    throw new Error('Browser sequences require between 1 and 32 steps.')
  }
  let waitMs = 0
  let images = 0
  for (const step of input) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new Error('Each browser sequence step must be an action object.')
    }
    if (step.label !== undefined && (typeof step.label !== 'string' || step.label.length > 120)) {
      throw new Error('Browser step labels must be at most 120 characters.')
    }
    if (step.action === 'wait') {
      if (!Number.isInteger(step.duration_ms) || step.duration_ms < 0 || step.duration_ms > 5000) {
        throw new Error('Browser waits must be integers from 0 to 5000 milliseconds.')
      }
      waitMs += step.duration_ms
    } else if (step.action === 'read') {
      if (step.view !== undefined && !['visual', 'structure', 'combined'].includes(step.view)) {
        throw new Error('Sequence reads support visual, structure, or combined views.')
      }
      if ((step.offset !== undefined && (!Number.isSafeInteger(step.offset) || step.offset < 0))
        || (step.limit !== undefined && (!Number.isInteger(step.limit) || step.limit < 1 || step.limit > 200))) {
        throw new Error('Sequence read offset must be nonnegative and limit must be from 1 to 200.')
      }
      if (step.view !== 'structure') {
        images += 1
      }
    } else {
      validateBrowserInteraction(step)
    }
  }
  if (waitMs > 5000) {
    throw new Error('Browser sequence waits may total at most 5000 milliseconds.')
  }
  if (images > 8) {
    throw new Error('Browser sequences may capture at most 8 screenshots.')
  }
}

/** The caller holds the tab queue; input and captures share one rendering surface. */
export async function executeAgentBrowserSequence(contents: WebContents, steps: AgentBrowserStep[]) {
  validateBrowserSequence(steps)
  return withAgentViewport(contents, (send, viewport) =>
    executeAgentBrowserSequenceInViewport(contents, steps, send, viewport), getAgentViewport(contents))
}

export async function executeAgentBrowserSequenceInViewport(
  contents: WebContents,
  steps: AgentBrowserStep[],
  send: CdpSend,
  viewport: Readonly<AgentViewport>,
): Promise<BrowserSequenceResult> {
  validateBrowserSequence(steps)
  // Validate viewport-dependent scroll anchors before any earlier input is sent.
  for (const step of steps) {
    if (step.action === 'scroll' && ((step.x !== undefined && step.x >= viewport.width)
      || (step.y !== undefined && step.y >= viewport.height))) {
      throw new Error('Scroll anchor is outside the current browser viewport.')
    }
  }
  const startedAt = performance.now()
  const elapsed = () => Math.round(performance.now() - startedAt)
  const result: BrowserSequenceResult = { completed_steps: 0, elapsed_ms: 0, captures: [] }
  let imageBytes = 0
  for (const [index, step] of steps.entries()) {
    try {
      if (elapsed() >= 20_000) {
        throw new Error('Browser sequence exhausted its 20-second time budget.')
      }
      if (contents.isDestroyed()) {
        throw new Error('The browser tab was closed during the sequence.')
      }
      requireBrowserUrl(contents.getURL())
      if (step.action === 'wait') {
        const remainingMs = 20_000 - elapsed()
        await delay(Math.min(step.duration_ms, remainingMs))
        if (step.duration_ms > remainingMs) {
          throw new Error('Browser sequence exhausted its 20-second time budget during a wait.')
        }
      } else if (step.action === 'read') {
        const startedMs = elapsed()
        const view = step.view ?? 'combined'
        const png = view !== 'structure' ? await captureAgentPageInViewport(send, viewport) : null
        const screenshotCompletedMs = elapsed()
        if (png) {
          imageBytes += png.length
          if (imageBytes > MAX_IMAGE_BYTES) {
            throw new Error('Browser sequence screenshots exceed the total 8 MiB limit.')
          }
        }
        const offset = step.offset ?? 0
        const structure = view !== 'visual'
          ? await readBrowserStructureInViewport(contents, send, offset, step.limit ?? 80, viewport)
          : null
        const body = [
          'URL: ' + contents.getURL(),
          'Title: ' + contents.getTitle(),
          'Viewport: ' + viewport.width + 'x' + viewport.height,
          ...(png ? ['Screenshot request: ' + startedMs + '–' + screenshotCompletedMs + 'ms after sequence start.'] : []),
          ...(structure ? [
            formatBrowserElements(structure.elements, structure.total, offset),
            ...structure.pageText,
          ] : []),
        ].join('\n\n')
        result.captures.push({
          step: index + 1, label: step.label ?? 'Step ' + (index + 1),
          started_ms: startedMs, completed_ms: elapsed(), body,
          ...(png ? { imageBase64: png.toString('base64') } : {}),
        })
      } else {
        await interactWithAgentPageInViewport(contents, step, send, viewport)
      }
      result.completed_steps += 1
    } catch (error) {
      result.failed_step = index + 1
      result.error = error instanceof Error ? error.message : String(error)
      break
    }
  }
  result.elapsed_ms = elapsed()
  return result
}
