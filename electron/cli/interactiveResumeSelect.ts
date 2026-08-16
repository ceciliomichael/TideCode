import readline from 'node:readline'
import { getTerminalWidth } from './renderer'
import { clearTerminalRegion, updateTerminalRegion } from './terminalRedraw'
import { ensureKeypressEvents } from './terminalLifecycle'
import type { InteractiveResizeHost } from './interactiveResize'
import {
  buildTerminalResumeLines,
  type ResumeFilterScope,
  type ResumePage,
  type ResumeSortMode,
} from './terminalResumeView'
import {
  filterResumeConversationItems,
  type ResumeConversationItem,
} from './resumeCatalog'

export interface InteractiveResumeSelectOptions {
  items: readonly ResumeConversationItem[]
  workspacePath: string
  projectLabel: string
  pageSize?: number
  page?: ResumePage
}

export type ResumeSelectionResult =
  | { kind: 'resume'; conversationId: string }
  | { kind: 'archive'; conversationId: string }
  | { kind: 'unarchive'; conversationId: string }

export function getResumeSelectionItems(
  items: readonly ResumeConversationItem[],
  workspacePath: string,
  scope: ResumeFilterScope,
  query: string,
  sortMode: ResumeSortMode,
  page: ResumePage = 'active',
): ResumeConversationItem[] {
  const scopedItems = scope === 'cwd'
    ? filterResumeConversationItems(items, workspacePath)
    : [...items]
  const pageItems = scopedItems.filter((item) => page === 'archived' ? item.isArchived : !item.isArchived)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredItems = normalizedQuery.length === 0
    ? pageItems
    : pageItems.filter((item) => (
      `${item.title} ${item.preview} ${item.projectLabel}`.toLocaleLowerCase().includes(normalizedQuery)
    ))

  return [...filteredItems].sort((left, right) => {
    const leftTimestamp = sortMode === 'updated' ? left.updatedAt : left.createdAt
    const rightTimestamp = sortMode === 'updated' ? right.updatedAt : right.createdAt
    return rightTimestamp - leftTimestamp || right.updatedAt - left.updatedAt || left.title.localeCompare(right.title)
  })
}

function getDefaultPageSize(): number {
  return Math.max(5, (process.stdout.rows || 24) - 4)
}

function renderNonInteractive(options: InteractiveResumeSelectOptions): ResumeSelectionResult | null {
  const items = getResumeSelectionItems(options.items, options.workspacePath, 'cwd', '', 'updated')
  console.log(`\n--- Resume ${options.projectLabel} ---`)
  items.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.title} (${item.projectLabel})`)
  })
  return items[0] ? { kind: 'resume', conversationId: items[0].id } : null
}

export async function interactiveResumeSelect(
  options: InteractiveResumeSelectOptions,
  resizeHost?: InteractiveResizeHost,
): Promise<ResumeSelectionResult | null> {
  if (!process.stdin.isTTY) return renderNonInteractive(options)

  const getPageSize = () => options.pageSize ?? getDefaultPageSize()
  let scope: ResumeFilterScope = 'cwd'
  let sortMode: ResumeSortMode = 'updated'
  let page: ResumePage = options.page ?? 'active'
  let query = ''
  let selectedIndex = 0
  let totalRenderedLines = 0
  let renderedLines: string[] = []
  let isInitialized = false
  let isFinished = false

  return new Promise((resolve) => {
    const getItems = () => getResumeSelectionItems(options.items, options.workspacePath, scope, query, sortMode, page)

    const cleanup = (result: ResumeSelectionResult | null) => {
      if (isFinished) return
      isFinished = true
      clearTerminalRegion(totalRenderedLines)
      process.stdout.write('\x1b[?25h')
      process.stdin.removeListener('keypress', onKeypress)
      resizeHost?.registerResizeHandler(null)
      try {
        process.stdin.setRawMode(false)
      } catch {
        // Ignore raw mode errors from terminals that already restored input.
      }
      resolve(result)
    }

    const render = () => {
      if (isFinished) return
      const items = getItems()
      const pageSize = getPageSize()
      selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, items.length - 1)))
      const lines = buildTerminalResumeLines({
        items,
        projectLabel: options.projectLabel,
        query,
        selectedIndex,
        pageSize,
        filterScope: scope,
        sortMode,
        page,
      }, getTerminalWidth())

      if (!isInitialized) {
        process.stdout.write(lines.join('\n'))
        totalRenderedLines = lines.length
        renderedLines = lines
        isInitialized = true
        readline.moveCursor(process.stdout, 0, -(totalRenderedLines - 1))
        readline.cursorTo(process.stdout, 0)
        return
      }

      updateTerminalRegion(renderedLines, lines)
      totalRenderedLines = lines.length
      renderedLines = lines
    }

    const redrawAfterResize = () => {
      if (isFinished) return
      resizeHost?.redrawBackground()
      totalRenderedLines = 0
      renderedLines = []
      isInitialized = false
      render()
    }

    const moveSelection = (direction: -1 | 1) => {
      const items = getItems()
      if (items.length === 0) return
      selectedIndex = (selectedIndex + direction + items.length) % items.length
      render()
    }

    const onKeypress = (input: string, key: readline.Key = {}) => {
      if (input === '\u0003' || (key.ctrl && key.name === 'c')) {
        cleanup(null)
        process.stdout.write('\n')
        process.exit(0)
      }

      if (key.name === 'escape' || input === '\u001b') {
        cleanup(null)
        return
      }

      if (key.name === 'return' || key.name === 'enter') {
        const selected = getItems()[selectedIndex]
        if (selected) cleanup({ kind: 'resume', conversationId: selected.id })
        return
      }

      if (key.name === 'up') {
        moveSelection(-1)
        return
      }
      if (key.name === 'down') {
        moveSelection(1)
        return
      }

      if (key.name === 'left' || key.name === 'right') {
        page = page === 'active' ? 'archived' : 'active'
        selectedIndex = 0
        render()
        return
      }

      if (key.name === 'pageup') {
        selectedIndex = Math.max(0, selectedIndex - getPageSize())
        render()
        return
      }
      if (key.name === 'pagedown') {
        selectedIndex = Math.min(Math.max(0, getItems().length - 1), selectedIndex + getPageSize())
        render()
        return
      }
      if (key.name === 'home') {
        selectedIndex = 0
        render()
        return
      }
      if (key.name === 'end') {
        selectedIndex = Math.max(0, getItems().length - 1)
        render()
        return
      }

      if (key.ctrl && key.name === 'u') {
        query = ''
        selectedIndex = 0
        render()
        return
      }

      if (input === 'F') {
        scope = scope === 'cwd' ? 'all' : 'cwd'
        selectedIndex = 0
        render()
        return
      }
      if (input === 'S') {
        sortMode = sortMode === 'updated' ? 'created' : 'updated'
        selectedIndex = 0
        render()
        return
      }

      if ((key.name === 'space' || input === ' ') && page === 'active') {
        const selected = getItems()[selectedIndex]
        if (selected) cleanup({ kind: 'archive', conversationId: selected.id })
        return
      }
      if ((key.name === 'space' || input === ' ') && page === 'archived') {
        const selected = getItems()[selectedIndex]
        if (selected) cleanup({ kind: 'unarchive', conversationId: selected.id })
        return
      }

      if (key.name === 'backspace') {
        if (query.length > 0) {
          query = query.slice(0, -1)
          selectedIndex = 0
          render()
        }
        return
      }

      if (!key.ctrl && !key.meta && input.length > 0 && [...input].every((character) => character >= ' ')) {
        query += input
        selectedIndex = 0
        render()
      }
    }

    process.stdout.write('\x1b[?25l')
    process.stdin.setRawMode(true)
    process.stdin.resume()
    ensureKeypressEvents()
    process.stdin.on('keypress', onKeypress)
    resizeHost?.registerResizeHandler(redrawAfterResize)
    render()
  })
}
