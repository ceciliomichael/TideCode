import type { WebContents } from 'electron'
import { requireBrowserUrl } from './agentTabs'
import { withAgentViewport } from './agentPageCapture'
import type { CdpSend } from './agentCdpSession'
import type { AgentViewport } from './agentViewport'
import { locateBrowserElement } from './agentPageStructure'

export type AgentBrowserInteraction =
  | { action: 'click'; element_ref: string; button?: 'left' | 'right' | 'middle' }
  | { action: 'fill'; element_ref: string; text: string }
  | { action: 'type'; text: string }
  | { action: 'key'; key: string }
  | { action: 'scroll'; x?: number; y?: number; delta_x?: number; delta_y?: number }
  | { action: 'navigate'; url: string }
  | { action: 'back' | 'forward' | 'reload' }

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

async function navigate(contents: WebContents, action: AgentBrowserInteraction) {
  if (action.action === 'navigate') {
    const url = requireBrowserUrl(action.url)
    void contents.loadURL(url).catch(() => undefined)
    return
  }
  if (action.action === 'back') {
    if (!contents.navigationHistory.canGoBack()) {
      throw new Error('This tab cannot navigate backward.')
    }
    contents.navigationHistory.goBack()
  } else if (action.action === 'forward') {
    if (!contents.navigationHistory.canGoForward()) {
      throw new Error('This tab cannot navigate forward.')
    }
    contents.navigationHistory.goForward()
  } else if (action.action === 'reload') {
    contents.reload()
  }
}

export async function interactWithAgentPage(contents: WebContents, action: AgentBrowserInteraction) {
  validateBrowserInteraction(action)
  if (['navigate', 'back', 'forward', 'reload'].includes(action.action)) {
    await navigate(contents, action)
  } else {
    await withAgentViewport(contents, (send, viewport) =>
      interactWithAgentPageInViewport(contents, action, send, viewport))
  }
  return {
    action: action.action,
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
  }
}

/** Dispatch input using the caller's existing viewport and protocol budget. */
export async function interactWithAgentPageInViewport(
  contents: WebContents,
  action: AgentBrowserInteraction,
  send: CdpSend,
  viewport: Readonly<AgentViewport>,
) {
  validateBrowserInteraction(action)
  if (['navigate', 'back', 'forward', 'reload'].includes(action.action)) {
    await navigate(contents, action)
    return
  }

  const resolved = (action.action === 'click' || action.action === 'fill') && action.element_ref
    ? await locateBrowserElement(contents, action.element_ref, send)
    : null
  if (action.action === 'click' || action.action === 'fill') {
    if (action.action === 'fill' && !resolved?.editable) {
      throw new Error('The selected element is not an editable field.')
    }
    if (!resolved) {
      throw new Error('The browser interaction requires an element_ref.')
    }
    const { x, y } = resolved
    const button = action.action === 'click' ? action.button ?? 'left' : 'left'
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 })
    if (action.action === 'fill') {
      // Ctrl+A selects the current field contents without touching the clipboard.
      const modifier = process.platform === 'darwin' ? 4 : 2
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: modifier, windowsVirtualKeyCode: 65 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: modifier, windowsVirtualKeyCode: 65 })
      await send('Input.insertText', { text: action.text })
    }
  } else if (action.action === 'type') {
    await send('Input.insertText', { text: action.text })
  } else if (action.action === 'key') {
    const params = browserKeyParameters(action.key)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  } else if (action.action === 'scroll') {
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
  }
}

/** Validate without dispatching input so a bad later step cannot partially execute a chain. */
export function validateBrowserInteraction(action: AgentBrowserInteraction) {
  if (!action || !['click', 'fill', 'type', 'key', 'scroll', 'navigate', 'back', 'forward', 'reload'].includes(action.action)) {
    throw new Error('Unknown browser interaction.')
  }
  if (action.action === 'click'
    && (typeof action.element_ref !== 'string' || !action.element_ref.trim() || 'x' in action || 'y' in action)) {
    throw new Error('Browser clicks require an element_ref and do not accept x or y.')
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
  if (action.action === 'navigate') {
    requireBrowserUrl(action.url)
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
