import { colors } from './renderer'
import { padVisible, truncateVisible, visibleWidth } from './terminalText'

export interface SelectionViewItem<T = unknown> {
  value: T
  label: string
  description?: string
  badge?: string
  isCurrent?: boolean
}

export interface SelectionViewOptions<T = unknown> {
  title: string
  items: readonly SelectionViewItem<T>[]
  pageSize: number
  footer?: string
  emptyMessage?: string
  sectionNavigation?: {
    labels: readonly string[]
    selectedIndex: number
  }
  navigationHint?: string
}

function borderTitle(title: string, width: number): string {
  const cleanTitle = truncateVisible(title, Math.max(1, width - 6))
  const prefix = `┌─ ${cleanTitle} `
  return `${colors.separator}${prefix}${'─'.repeat(Math.max(0, width - visibleWidth(prefix) - 1))}┐${colors.reset}`
}

function borderRow(left: string, right: string, width: number): string {
  return `${colors.separator}${left}${'─'.repeat(Math.max(0, width - 2))}${right}${colors.reset}`
}

function contentRow(content: string, width: number): string {
  const contentWidth = Math.max(1, width - 6)
  const clipped = truncateVisible(content, contentWidth)
  return `${colors.separator}│${colors.reset}  ${padVisible(clipped, contentWidth)}  ${colors.separator}│${colors.reset}`
}

export function buildSelectionLines<T>(options: SelectionViewOptions<T>, selectedIndex: number, width: number): string[] {
  const safeWidth = Math.max(20, width)
  const count = Math.max(1, Math.min(options.items.length, options.pageSize))
  const visibleStart = Math.max(0, Math.min(selectedIndex - Math.floor(count / 2), options.items.length - count))
  const visibleEnd = visibleStart + count
  const visibleItems = options.items.slice(visibleStart, visibleEnd)
  const navigationHint = options.navigationHint ?? (options.sectionNavigation
    ? 'Use Left/Right for Active or Archived, Up/Down to navigate, Enter to select, Esc to cancel'
    : 'Use Up/Down to navigate, Enter to select, Esc to cancel')
  const lines: string[] = [
    borderTitle(options.title, safeWidth),
    ...(options.sectionNavigation
      ? [contentRow(options.sectionNavigation.labels.map((label, index) => (
          index === options.sectionNavigation?.selectedIndex
            ? `${colors.accent}${colors.bold}[ ${label} ]${colors.reset}`
            : `${colors.subtle}${label}${colors.reset}`
        )).join(`  ${colors.separator}│${colors.reset}  `), safeWidth)]
      : []),
    contentRow(`${colors.subtle}${navigationHint}${colors.reset}`, safeWidth),
    borderRow('├', '┤', safeWidth),
  ]

  visibleItems.forEach((item, relativeIndex) => {
    const actualIndex = visibleStart + relativeIndex
    const isSelected = actualIndex === selectedIndex
    const cursor = isSelected ? `${colors.accent}›${colors.reset}` : ' '
    const badge = item.badge ? ` ${item.badge}` : ''
    const currentMarker = item.isCurrent ? ` ${colors.success}[active]${colors.reset}` : ''
    const label = isSelected ? `${colors.bold}${colors.foreground}${item.label}${colors.reset}` : `${colors.foreground}${item.label}${colors.reset}`
    const description = item.description ? ` ${colors.subtle}– ${item.description}${colors.reset}` : ''
    lines.push(contentRow(`${cursor} ${label}${badge}${currentMarker}${description}`, safeWidth))
  })

  if (visibleItems.length === 0) {
    lines.push(contentRow(`${colors.subtle}${options.emptyMessage ?? 'No options available.'}${colors.reset}`, safeWidth))
  }

  if (options.items.length > count) {
    lines.push(contentRow(`${colors.subtle}(Showing ${visibleStart + 1}-${visibleEnd} of ${options.items.length} options)${colors.reset}`, safeWidth))
  }
  if (options.footer) lines.push(contentRow(`${colors.subtle}${options.footer}${colors.reset}`, safeWidth))
  lines.push(borderRow('└', '┘', safeWidth))
  return lines
}
