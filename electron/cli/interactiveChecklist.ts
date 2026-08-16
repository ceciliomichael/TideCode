import readline from 'node:readline'
import { getTerminalWidth } from './renderer'
import { clearTerminalRegion, updateTerminalRegion } from './terminalRedraw'
import { ensureKeypressEvents } from './terminalLifecycle'
import { buildSelectionLines, type SelectionViewItem } from './terminalSelectionView'
import type { InteractiveResizeHost } from './interactiveResize'

export interface ChecklistItem<T = string> {
  value: T
  label: string
  description?: string
  enabled: boolean
  readOnly?: boolean
}

export interface ChecklistOptions<T = string> {
  title: string
  items: readonly ChecklistItem<T>[]
  pageSize?: number
  footer?: string
}

export function buildChecklistViewItems<T>(
  items: readonly ChecklistItem<T>[],
  enabledIndices: ReadonlySet<number>,
): SelectionViewItem<T>[] {
  return items.map((item, index) => ({
    value: item.value,
    label: `[${enabledIndices.has(index) ? 'x' : ' '}] ${item.label}`,
    description: item.readOnly
      ? `${item.description ? `${item.description} · ` : ''}read-only`
      : item.description,
  }))
}

export async function interactiveChecklist<T>(
  options: ChecklistOptions<T>,
  resizeHost?: InteractiveResizeHost,
): Promise<T[] | null> {
  const { items, pageSize = 10, footer } = options
  if (items.length === 0) return []
  const enabledIndices = new Set(items.flatMap((item, index) => item.enabled ? [index] : []))

  if (!process.stdin.isTTY) {
    return items.filter((_item, index) => enabledIndices.has(index)).map((item) => item.value)
  }

  return new Promise((resolve) => {
    let selectedIndex = 0
    let renderedLines: string[] = []
    let initialized = false
    let finished = false

    process.stdout.write('\x1b[?25l')
    process.stdin.setRawMode(true)
    process.stdin.resume()

    const cleanup = () => {
      if (finished) return
      finished = true
      clearTerminalRegion(renderedLines.length)
      process.stdout.write('\x1b[?25h')
      process.stdin.removeListener('keypress', onKeypress)
      resizeHost?.registerResizeHandler(null)
      try {
        process.stdin.setRawMode(false)
      } catch {
        // Raw mode may already be disabled during shutdown.
      }
    }

    const render = () => {
      const lines = buildSelectionLines({
        title: options.title,
        items: buildChecklistViewItems(items, enabledIndices),
        pageSize,
        footer,
        navigationHint: 'Up/Down navigate · Space toggle · Enter save · Esc cancel',
      }, selectedIndex, getTerminalWidth())
      if (!initialized) {
        process.stdout.write(lines.join('\n'))
        renderedLines = lines
        initialized = true
        readline.moveCursor(process.stdout, 0, -(lines.length - 1))
        readline.cursorTo(process.stdout, 0)
        return
      }
      updateTerminalRegion(renderedLines, lines)
      renderedLines = lines
    }

    const redrawAfterResize = () => {
      if (finished) return
      resizeHost?.redrawBackground()
      renderedLines = []
      initialized = false
      render()
    }

    const onKeypress = (input: string, key: readline.Key) => {
      if (input === '\u0003' || (key.ctrl && key.name === 'c')) {
        cleanup()
        process.stdout.write('\n')
        process.exit(0)
      }
      if (input === '\u001b' || key.name === 'escape') {
        cleanup()
        resolve(null)
        return
      }
      if (key.name === 'up' || key.name === 'down') {
        const offset = key.name === 'up' ? -1 : 1
        selectedIndex = (selectedIndex + offset + items.length) % items.length
        render()
        return
      }
      if (key.name === 'pageup' || key.name === 'pagedown') {
        const offset = key.name === 'pageup' ? -pageSize : pageSize
        selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + offset))
        render()
        return
      }
      if (key.name === 'home' || key.name === 'end') {
        selectedIndex = key.name === 'home' ? 0 : items.length - 1
        render()
        return
      }
      if (key.name === 'space' || input === ' ') {
        if (!items[selectedIndex]?.readOnly) {
          if (enabledIndices.has(selectedIndex)) enabledIndices.delete(selectedIndex)
          else enabledIndices.add(selectedIndex)
          render()
        }
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        const values = items
          .filter((_item, index) => enabledIndices.has(index))
          .map((item) => item.value)
        cleanup()
        resolve(values)
      }
    }

    ensureKeypressEvents()
    process.stdin.on('keypress', onKeypress)
    resizeHost?.registerResizeHandler(redrawAfterResize)
    render()
  })
}
