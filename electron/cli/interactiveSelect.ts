import readline from 'node:readline'
import { getTerminalWidth } from './renderer'
import { clearTerminalRegion, updateTerminalRegion } from './terminalRedraw'
import { ensureKeypressEvents } from './terminalLifecycle'
import { buildSelectionLines } from './terminalSelectionView'
import { cycleSelectionSectionIndex } from './selectionNavigation'

export interface SelectItem<T = string> {
  value: T
  label: string
  description?: string
  badge?: string
  isCurrent?: boolean
}

export interface SelectSection<T = string> {
  emptyMessage: string
  items: SelectItem<T>[]
  label: string
}

interface SelectOptionsBase {
  title: string
  initialIndex?: number
  pageSize?: number
  footer?: string
}

export type SelectOptions<T = string> = SelectOptionsBase & (
  | { items: SelectItem<T>[]; sections?: never; initialSectionIndex?: never }
  | { items?: never; sections: SelectSection<T>[]; initialSectionIndex?: number }
)

export async function interactiveSelect<T = string>(options: SelectOptions<T>): Promise<T | null> {
  const { title, initialIndex = 0, pageSize = 6, footer } = options
  const sections = options.sections ?? null
  let sectionIndex = sections
    ? Math.max(0, Math.min(options.initialSectionIndex ?? 0, sections.length - 1))
    : 0
  const selectedIndices = sections?.map(() => 0) ?? []
  const getItems = () => sections?.[sectionIndex]?.items ?? options.items ?? []
  const initialItems = getItems()
  let selectedIndex = Math.max(0, Math.min(initialIndex, initialItems.length - 1))
  const getSelectedIndex = () => sections ? selectedIndices[sectionIndex] ?? 0 : selectedIndex
  const setSelectedIndex = (nextIndex: number) => {
    if (sections) selectedIndices[sectionIndex] = nextIndex
    else selectedIndex = nextIndex
  }
  if (sections) selectedIndices[sectionIndex] = selectedIndex

  if (!sections && initialItems.length === 0) {
    return null
  }

  if (!process.stdin.isTTY) {
    console.log(`\n--- ${title} ---`)
    const fallbackItems = initialItems.length > 0
      ? initialItems
      : sections?.flatMap((section) => section.items) ?? []
    fallbackItems.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.label}${item.description ? ` (${item.description})` : ''}`)
    })
    return fallbackItems[0]?.value ?? null
  }

  return new Promise((resolve) => {
    let totalRenderedLines = 0
    let renderedLines: string[] = []
    let isInitialized = false
    let isFinished = false

    // Hide terminal cursor
    process.stdout.write('\x1b[?25l')
    process.stdin.setRawMode(true)
    process.stdin.resume()

    const cleanup = () => {
      if (isFinished) return
      isFinished = true

      clearTerminalRegion(totalRenderedLines)

      // Restore terminal cursor
      process.stdout.write('\x1b[?25h')
      process.stdin.removeListener('keypress', onKeypress)
      try {
        process.stdin.setRawMode(false)
      } catch {
        // Ignore raw mode errors
      }
    }

    const render = () => {
      if (isFinished) return
      const items = getItems()
      const selectedIndex = getSelectedIndex()
      const currentSection = sections?.[sectionIndex]
      const lines = buildSelectionLines({
        title,
        items,
        pageSize,
        footer,
        emptyMessage: currentSection?.emptyMessage,
        sectionNavigation: sections
          ? {
              labels: sections.map((section) => `${section.label} (${section.items.length})`),
              selectedIndex: sectionIndex,
            }
          : undefined,
      }, selectedIndex, getTerminalWidth())

      if (!isInitialized) {
        // First draw: print frame
        process.stdout.write(lines.join('\n'))
        totalRenderedLines = lines.length
        renderedLines = lines
        isInitialized = true
        // Park cursor back at row 0 of the box
        readline.moveCursor(process.stdout, 0, -(totalRenderedLines - 1))
        readline.cursorTo(process.stdout, 0)
      } else {
        updateTerminalRegion(renderedLines, lines)
        totalRenderedLines = lines.length
        renderedLines = lines
      }
    }

    const onKeypress = (_str: string, key: readline.Key) => {
      // Handle Ctrl+C: immediately exit
      if (_str === '\u0003' || (key && key.ctrl && key.name === 'c')) {
        cleanup()
        process.stdout.write('\n')
        process.exit(0)
      }

      if (!key && !_str) return

      // Handle Escape: cancel interactive selection
      if ((key && key.name === 'escape') || _str === '\u001b') {
        cleanup()
        resolve(null)
        return
      }

      // Up arrow
      if (key && key.name === 'up') {
        const items = getItems()
        if (items.length === 0) return
        setSelectedIndex((getSelectedIndex() - 1 + items.length) % items.length)
        render()
        return
      }

      // Down arrow
      if (key && key.name === 'down') {
        const items = getItems()
        if (items.length === 0) return
        setSelectedIndex((getSelectedIndex() + 1) % items.length)
        render()
        return
      }

      if (sections && key && (key.name === 'left' || key.name === 'right')) {
        sectionIndex = cycleSelectionSectionIndex(sectionIndex, key.name === 'left' ? -1 : 1, sections.length)
        render()
        return
      }

      // PageUp / PageDown
      if (key && key.name === 'pageup') {
        setSelectedIndex(Math.max(0, getSelectedIndex() - pageSize))
        render()
        return
      }
      if (key && key.name === 'pagedown') {
        setSelectedIndex(Math.max(0, Math.min(getItems().length - 1, getSelectedIndex() + pageSize)))
        render()
        return
      }

      // Home / End
      if (key && key.name === 'home') {
        setSelectedIndex(0)
        render()
        return
      }
      if (key && key.name === 'end') {
        setSelectedIndex(Math.max(0, getItems().length - 1))
        render()
        return
      }

      // Enter / Return: select current item
      if (key && (key.name === 'return' || key.name === 'enter')) {
        const selectedItem = getItems()[getSelectedIndex()]
        if (!selectedItem) return
        cleanup()
        resolve(selectedItem.value)
        return
      }
    }

    ensureKeypressEvents()
    process.stdin.on('keypress', onKeypress)
    render()
  })
}

export async function interactiveConfirm(question: string, defaultYes = true): Promise<boolean> {
  const result = await interactiveSelect<boolean>({
    title: question,
    items: [
      { value: true, label: defaultYes ? 'Yes (Confirm)' : 'Yes' },
      { value: false, label: !defaultYes ? 'No (Cancel)' : 'No' },
    ],
    initialIndex: defaultYes ? 0 : 1,
    pageSize: 2,
  })

  return result ?? false
}
