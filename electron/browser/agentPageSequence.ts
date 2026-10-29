import type { WebContents } from 'electron'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { captureAgentPageInViewport, withAgentViewport } from './agentPageCapture'
import type { CdpSend } from './agentCdpSession'
import { getAgentViewport, type AgentViewport } from './agentViewport'
import { interactWithAgentPageInViewport, validateBrowserInteraction, type AgentBrowserInteraction, type BrowserActionReport } from './agentPageInput'
import { formatBrowserElements, readBrowserStructureInViewport } from './agentPageStructure'
import { requireBrowserUrl } from './agentTabs'
import { addAgentCursorToScreenshot } from './agentScreenshotCursor'
import { getAgentCursor } from './agentCursor'

export type AgentBrowserStep = (AgentBrowserInteraction
  | { action: 'wait'; duration_ms?: number; ms?: number }
  | { action: 'wait_for'; selector?: string; url_contains?: string; timeout_ms?: number }
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
  width: number
  height: number
  completed_steps: number
  failed_step?: number
  error?: string
  elapsed_ms: number
  captures: BrowserSequenceCapture[]
  actions: Array<{ step: number; status: 'completed'; report: BrowserActionReport }>
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
      const duration = step.duration_ms ?? step.ms
      if ((step.duration_ms !== undefined && step.ms !== undefined)
        || !Number.isInteger(duration) || duration! < 0 || duration! > 5000) {
        throw new Error('Browser waits require duration_ms or ms (not both), from 0 to 5000.')
      }
      waitMs += duration!
    } else if (step.action === 'wait_for') {
      const hasSelector = typeof step.selector === 'string' && step.selector.trim().length > 0
      const hasUrl = typeof step.url_contains === 'string' && step.url_contains.trim().length > 0
      if (hasSelector === hasUrl || (hasSelector && step.selector!.length > 512)
        || (hasUrl && step.url_contains!.length > 512)
        || (step.timeout_ms !== undefined && (!Number.isInteger(step.timeout_ms)
          || step.timeout_ms < 0 || step.timeout_ms > 5000))) {
        throw new Error('wait_for requires one selector or url_contains and timeout_ms from 0 to 5000.')
      }
      waitMs += step.timeout_ms ?? 3000
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
export async function executeAgentBrowserSequence(contents: WebContents, steps: AgentBrowserStep[], signal?: AbortSignal) {
  validateBrowserSequence(steps)
  return withAgentViewport(contents, (send, viewport) =>
    executeAgentBrowserSequenceInViewport(contents, steps, send, viewport, signal), getAgentViewport(contents), signal)
}

export async function executeAgentBrowserSequenceInViewport(
  contents: WebContents,
  steps: AgentBrowserStep[],
  send: CdpSend,
  viewport: Readonly<AgentViewport>,
  signal?: AbortSignal,
): Promise<BrowserSequenceResult> {
  validateBrowserSequence(steps)
  // Validate viewport-dependent scroll anchors before any earlier input is sent.
  for (const step of steps) {
    if (step.action === 'stroke' && step.points.some((point) =>
      point.x >= viewport.width || point.y >= viewport.height)) {
      throw new Error('Stroke path is outside the current browser viewport.')
    }
    if (step.action === 'scroll' && ((step.x !== undefined && step.x >= viewport.width)
      || (step.y !== undefined && step.y >= viewport.height))) {
      throw new Error('Scroll anchor is outside the current browser viewport.')
    }
  }
  const startedAt = performance.now()
  const elapsed = () => Math.round(performance.now() - startedAt)
  const result: BrowserSequenceResult = {
    width: viewport.width, height: viewport.height,
    completed_steps: 0, elapsed_ms: 0, captures: [], actions: [],
  }
  let imageBytes = 0
  for (const [index, step] of steps.entries()) {
    try {
      if (signal?.aborted) throw new Error('Browser operation cancelled.')
      if (elapsed() >= 20_000) {
        throw new Error('Browser sequence exhausted its 20-second time budget.')
      }
      if (contents.isDestroyed()) {
        throw new Error('The browser tab was closed during the sequence.')
      }
      requireBrowserUrl(contents.getURL())
      if (step.action === 'wait') {
        const remainingMs = 20_000 - elapsed()
        const duration = (step.duration_ms ?? step.ms)!
        await delay(Math.min(duration, remainingMs), undefined, { signal })
        if (duration > remainingMs) {
          throw new Error('Browser sequence exhausted its 20-second time budget during a wait.')
        }
      } else if (step.action === 'wait_for') {
        const end = performance.now() + (step.timeout_ms ?? 3000)
        let matched = false
        let firstAttempt = true
        while (firstAttempt || (performance.now() < end && elapsed() < 20_000)) {
          if (signal?.aborted) throw new Error('Browser operation cancelled.')
          firstAttempt = false
          if (contents.isDestroyed()) throw new Error('The browser tab closed while waiting.')
          if (step.url_contains !== undefined) {
            matched = contents.getURL().includes(step.url_contains)
          } else {
            try {
              const response = await send('Runtime.evaluate', {
                expression: `Boolean(document.querySelector(${JSON.stringify(step.selector)}))`,
                returnByValue: true,
              }) as { result?: { value?: boolean }; exceptionDetails?: unknown }
              if (response.exceptionDetails) throw new Error('The wait_for CSS selector is invalid.')
              matched = response.result?.value === true
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              if (!/execution context was destroyed|cannot find (?:execution )?context|frame was detached/iu.test(message)) {
                throw error
              }
              // Navigation replaced the old document; the next read is safe to retry.
            }
          }
          if (matched) break
          if (performance.now() >= end || elapsed() >= 20_000) break
          await delay(100, undefined, { signal })
        }
        if (!matched) {
          throw new Error('The page did not meet the requested wait_for condition before the timeout.')
        }
      } else if (step.action === 'read') {
        const startedMs = elapsed()
        const view = step.view ?? 'combined'
        const raw = view !== 'structure' ? await captureAgentPageInViewport(send, viewport) : null
        const png = raw ? await addAgentCursorToScreenshot(raw, viewport, getAgentCursor(contents)) : null
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
        const report = await interactWithAgentPageInViewport(contents, step, send, viewport, signal)
        if (report) {
          result.actions.push({ step: index + 1, status: 'completed', report })
        }
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
