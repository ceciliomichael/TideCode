import type { WebContents } from 'electron'
import { withAgentViewport } from './agentPageCapture'
import type { CdpSend } from './agentCdpSession'
import type { AgentViewport } from './agentViewport'
import { locateBrowserElement } from './agentPageStructure'
import { moveAgentCursor } from './agentCursor'
import { clearAgentObservation } from './agentObservation'
import { setTimeout as delay } from 'node:timers/promises'

export type AgentBrowserInteraction =
  | { action: 'click'; element_ref?: string; x?: number; y?: number; button?: 'left' | 'right' | 'middle' }
  | { action: 'hover'; element_ref?: string; x?: number; y?: number }
  | { action: 'double_click'; element_ref?: string; x?: number; y?: number }
  | { action: 'drag'; element_ref?: string; x?: number; y?: number; to_x: number; to_y: number }
  | { action: 'stroke'; points: Array<{ x: number; y: number }> }
  | { action: 'fill'; element_ref: string; text: string }
  | { action: 'type'; text: string }
  | { action: 'key'; key: string }
  | { action: 'scroll'; x?: number; y?: number; delta_x?: number; delta_y?: number }

export interface BrowserActionReport {
  action: string
  target: string
  method: 'element_ref' | 'coordinates' | 'viewport' | 'keyboard'
  x?: number
  y?: number
  to_x?: number
  to_y?: number
  detail?: string
}

const MAX_POINTER_SPACING = 12
const MAX_POINTER_MOVES = 800
const POINTER_INTERVAL_MS = 6

function interpolatePointerPath(points: ReadonlyArray<{ x: number; y: number }>) {
  const moves: Array<{ x: number; y: number }> = []
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1]
    const end = points[i]
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / MAX_POINTER_SPACING))
    if (moves.length + steps > MAX_POINTER_MOVES) {
      throw new Error('The browser stroke is too long. Use fewer points or split the path into shorter strokes.')
    }
    for (let j = 1; j <= steps; j += 1) {
      moves.push({
        x: start.x + (end.x - start.x) * j / steps,
        y: start.y + (end.y - start.y) * j / steps,
      })
    }
  }
  return moves
}

async function dispatchPointerPath(
  contents: WebContents,
  send: CdpSend,
  points: ReadonlyArray<{ x: number; y: number }>,
  signal?: AbortSignal,
  startPositioned = false,
) {
  const moves = interpolatePointerPath(points)
  const start = points[0]
  let last = start
  if (!startPositioned) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y })
  }
  let pressed = false
  let releaseError: unknown = null
  try {
    // A failed response can still mean Chromium received the press.
    pressed = true
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1,
    })
    moveAgentCursor(contents, start.x, start.y, 'grabbing')
    for (const point of moves) {
      if (signal?.aborted) throw new Error('Browser operation cancelled.')
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1,
      })
      last = point
      moveAgentCursor(contents, point.x, point.y, 'grabbing', 'drag')
      await delay(POINTER_INTERVAL_MS, undefined, { signal })
    }
  } finally {
    if (pressed) {
      const release = {
        type: 'mouseReleased', x: last.x, y: last.y, button: 'left', clickCount: 1,
      }
      try {
        await send('Input.dispatchMouseEvent', release)
      } catch (error) {
        if (!signal?.aborted || contents.isDestroyed?.() || !contents.debugger?.isAttached?.()) {
          releaseError = error
        } else {
          // Cancellation can abort the scoped CDP budget; release without that signal.
          try {
            await contents.debugger.sendCommand('Input.dispatchMouseEvent', release)
          } catch (fallbackError) {
            releaseError = fallbackError
          }
        }
      } finally {
        moveAgentCursor(contents, last.x, last.y, 'grab')
      }
    }
  }
  if (releaseError !== null) throw releaseError
  return last
}

const KEY_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Space: 32,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34,
}
const KEY_ALIASES: Record<string, string> = { Esc: 'Escape', ' ': 'Space', Return: 'Enter' }
const NORMALIZED_KEYS = new Map(
  [...Object.keys(KEY_CODES), ...Object.keys(KEY_ALIASES)].map((key) => [key.toLowerCase(), key]),
)

export function normalizeBrowserKey(input: string): string {
  if (input === ' ') {
    return 'Space'
  }
  return input.split('+').map((part, index, parts) => {
    const value = part.trim()
    if (index < parts.length - 1) {
      const modifier = { ctrl: 'Ctrl', control: 'Control', shift: 'Shift', alt: 'Alt', meta: 'Meta' }[value.toLowerCase()]
      return modifier ?? value
    }
    const known = NORMALIZED_KEYS.get(value.toLowerCase())
    return known ? KEY_ALIASES[known] ?? known : value
  }).join('+')
}

function assertCoordinate(value: number, max: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value >= max) {
    throw new Error(label + ' must be a number from 0 to ' + (max - 1) + '.')
  }
}

export async function interactWithAgentPage(contents: WebContents, action: AgentBrowserInteraction, signal?: AbortSignal) {
  validateBrowserInteraction(action)
  const result = await withAgentViewport(contents, async (send, viewport) => ({
    report: await interactWithAgentPageInViewport(contents, action, send, viewport, signal),
    width: viewport.width,
    height: viewport.height,
  }), undefined, signal)
  return {
    action: action.action,
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    ...result,
  }
}

/** Dispatch input using the caller's existing viewport and protocol budget. */
export async function interactWithAgentPageInViewport(
  contents: WebContents,
  action: AgentBrowserInteraction,
  send: CdpSend,
  viewport: Readonly<AgentViewport>,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error('Browser operation cancelled.')
  validateBrowserInteraction(action)
  const pointing = action.action === 'click' || action.action === 'hover'
    || action.action === 'double_click' || action.action === 'drag'
  if (action.action === 'stroke') {
    for (const point of action.points) {
      assertCoordinate(point.x, viewport.width, 'stroke x')
      assertCoordinate(point.y, viewport.height, 'stroke y')
    }
    const start = action.points[0]
    clearAgentObservation(contents)
    const last = await dispatchPointerPath(contents, send, action.points, signal)
    return {
      action: 'stroke', target: 'Viewport path', method: 'coordinates',
      x: start.x, y: start.y, to_x: last.x, to_y: last.y,
      detail: action.points.length + ' connected points',
    } as BrowserActionReport
  }
  const resolved = (pointing || action.action === 'fill') && action.element_ref
    ? await locateBrowserElement(contents, action.element_ref, send)
    : null
  if (pointing || action.action === 'fill') {
    if (signal?.aborted) throw new Error('Browser operation cancelled.')
    if (action.action === 'fill' && !resolved?.editable) {
      throw new Error('The selected element is not an editable field.')
    }
    if (!resolved && (!pointing || action.x === undefined || action.y === undefined)) {
      throw new Error('Provide an element_ref or viewport coordinates for this browser action.')
    }
    const x = resolved?.x ?? (pointing ? action.x! : 0)
    const y = resolved?.y ?? (pointing ? action.y! : 0)
    assertCoordinate(x, viewport.width, 'x')
    assertCoordinate(y, viewport.height, 'y')
    moveAgentCursor(contents, x, y)
    const button = action.action === 'click' ? action.button ?? 'left' : 'left'
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    let cursorKind = 'default'
    try {
      const cursorResponse = await send('Runtime.evaluate', {
        expression: `getComputedStyle(document.elementFromPoint(${JSON.stringify(x)},${JSON.stringify(y)}) || document.body).cursor`,
        returnByValue: true,
      }) as { result?: { value?: string } }
      cursorKind = cursorResponse.result?.value || 'default'
    } catch {
      // Cursor display must never prevent browser input.
    }
    moveAgentCursor(contents, x, y, cursorKind)
    if (action.action === 'drag') {
      assertCoordinate(action.to_x, viewport.width, 'to_x')
      assertCoordinate(action.to_y, viewport.height, 'to_y')
      clearAgentObservation(contents)
      await dispatchPointerPath(contents, send, [
        { x, y }, { x: action.to_x, y: action.to_y },
      ], signal, true)
    } else if (action.action !== 'hover') {
      clearAgentObservation(contents)
      const clicks = action.action === 'double_click' ? 2 : 1
      for (let count = 1; count <= clicks; count += 1) {
        if (signal?.aborted) throw new Error('Browser operation cancelled.')
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: count })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: count })
        moveAgentCursor(contents, x, y, cursorKind, 'click')
      }
    }
    if (action.action === 'fill') {
      // Ctrl+A selects the current field contents without touching the clipboard.
      const modifier = process.platform === 'darwin' ? 4 : 2
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: modifier, windowsVirtualKeyCode: 65 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: modifier, windowsVirtualKeyCode: 65 })
      await send('Input.insertText', { text: action.text })
    }
    return {
      action: action.action,
      target: resolved?.name || action.element_ref || 'Viewport position',
      method: resolved ? 'element_ref' : 'coordinates',
      x, y,
      ...(action.action === 'drag' ? { to_x: action.to_x, to_y: action.to_y } : {}),
      ...(action.action === 'fill' ? { detail: action.text.length + ' characters entered' } : {}),
    } as BrowserActionReport
  } else if (action.action === 'type') {
    await send('Input.insertText', { text: action.text })
    return { action: 'type', target: 'Focused field', method: 'keyboard', detail: action.text.length + ' characters entered' } as BrowserActionReport
  } else if (action.action === 'key') {
    const params = browserKeyParameters(action.key)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
    return { action: 'key', target: 'Focused page', method: 'keyboard', detail: action.key } as BrowserActionReport
  } else if (action.action === 'scroll') {
    clearAgentObservation(contents)
    const x = action.x ?? viewport.width / 2
    const y = action.y ?? viewport.height / 2
    assertCoordinate(x, viewport.width, 'x')
    assertCoordinate(y, viewport.height, 'y')
    const deltaX = action.delta_x ?? 0
    const deltaY = action.delta_y ?? 500
    if (![deltaX, deltaY].every((value) => Number.isFinite(value) && Math.abs(value) <= 10_000)) {
      throw new Error('Scroll delta must be finite and no greater than 10,000 pixels.')
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, pointerType: 'mouse' })
    moveAgentCursor(contents, x, y)
    return { action: 'scroll', target: 'Viewport', method: 'viewport', x, y, detail: 'Scroll ' + deltaX + ', ' + deltaY + ' pixels' } as BrowserActionReport
  }
}

/** Validate without dispatching input so a bad later step cannot partially execute a chain. */
export function validateBrowserInteraction(action: AgentBrowserInteraction) {
  if (!action || !['click', 'hover', 'double_click', 'drag', 'stroke', 'fill', 'type', 'key', 'scroll'].includes(action.action)) {
    throw new Error('Unknown browser interaction.')
  }
  if (action.action === 'stroke') {
    if (!Array.isArray(action.points) || action.points.length < 2 || action.points.length > 256
      || action.points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x < 0 || point.y < 0 || point.x >= 4096 || point.y >= 4096)) {
      throw new Error('Stroke requires 2 to 256 points with valid viewport x/y coordinates.')
    }
  }
  if (['click', 'hover', 'double_click', 'drag'].includes(action.action)) {
    const pointer = action as Extract<AgentBrowserInteraction, { action: 'click' }>
    const hasRef = typeof pointer.element_ref === 'string' && pointer.element_ref.trim().length > 0
    const hasCoords = pointer.x !== undefined || pointer.y !== undefined
    if (hasRef === hasCoords || (hasCoords && (
      !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)
      || pointer.x! < 0 || pointer.y! < 0 || pointer.x! >= 4096 || pointer.y! >= 4096
    ))) {
      throw new Error('Use either an element_ref or x and y viewport coordinates, not both.')
    }
    if (action.action === 'drag' && (
      !Number.isFinite(action.to_x) || !Number.isFinite(action.to_y)
      || action.to_x < 0 || action.to_y < 0 || action.to_x >= 4096 || action.to_y >= 4096
    )) {
      throw new Error('Drag requires valid to_x/to_y viewport coordinates.')
    }
  }

  if ((action.action === 'fill' && (typeof action.element_ref !== 'string' || !action.element_ref.trim()))
    || ((action.action === 'fill' || action.action === 'type') && (typeof action.text !== 'string' || action.text.length > 20_000))) {
    throw new Error('Fill requires an element_ref; input text must be at most 20,000 characters.')
  }
  if (action.action === 'click' && action.button !== undefined && !['left', 'right', 'middle'].includes(action.button)) {
    throw new Error('Unknown browser mouse button.')
  }
  if (action.action === 'key') {
    if (typeof action.key !== 'string') {
      throw new Error('A browser key is required.')
    }
    browserKeyParameters(action.key)
  }
  if (action.action === 'scroll') {
    for (const value of [action.delta_x ?? 0, action.delta_y ?? 500]) {
      if (!Number.isFinite(value) || Math.abs(value) > 10_000) {
        throw new Error('Scroll delta must be finite and no greater than 10,000 pixels.')
      }
    }
    for (const value of [action.x, action.y]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value >= 4096)) {
        throw new Error('Scroll anchors must be finite viewport coordinates.')
      }
    }
  }
}

function browserKeyParameters(keyInput: string) {
  const key = normalizeBrowserKey(keyInput)
  const parts = key.split('+')
  const modifierSet = new Set(parts.slice(0, -1))
  const last = parts.at(-1) ?? ''
  const supported = KEY_CODES[last] || (last.length === 1 ? last.toUpperCase().charCodeAt(0) : 0)
  if (!supported || [...modifierSet].some((part) => !['Ctrl', 'Control', 'Shift', 'Alt', 'Meta'].includes(part))) {
    throw new Error('Unsupported key. Use a character, Enter, Tab, Escape, navigation key, or Ctrl/Shift/Alt/Meta+key.')
  }
  const modifiers = (modifierSet.has('Alt') ? 1 : 0)
    | (modifierSet.has('Ctrl') || modifierSet.has('Control') ? 2 : 0)
    | (modifierSet.has('Meta') ? 4 : 0)
    | (modifierSet.has('Shift') ? 8 : 0)
  const text = last.length === 1 && modifiers === 0 ? last : undefined
  return { key: last === 'Space' ? ' ' : last, code: last, windowsVirtualKeyCode: supported, modifiers, ...(text ? { text } : {}) }
}
