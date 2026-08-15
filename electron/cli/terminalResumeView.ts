import { colors } from './renderer'
import { padVisible, truncateVisible, visibleWidth } from './terminalText'
import type { ResumeConversationItem } from './resumeCatalog'

export type ResumeFilterScope = 'cwd' | 'all'
export type ResumeSortMode = 'updated' | 'created'
export type ResumePage = 'active' | 'archived'

export interface TerminalResumeViewOptions {
  items: readonly ResumeConversationItem[]
  projectLabel: string
  query: string
  selectedIndex: number
  pageSize: number
  filterScope: ResumeFilterScope
  sortMode: ResumeSortMode
  page: ResumePage
}

export function formatResumeRelativeTime(timestamp: number, now = Date.now()): string {
  const differenceSeconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (differenceSeconds < 60) return `${differenceSeconds}s ago`

  const differenceMinutes = Math.floor(differenceSeconds / 60)
  if (differenceMinutes < 60) return `${differenceMinutes}m ago`

  const differenceHours = Math.floor(differenceMinutes / 60)
  if (differenceHours < 24) return `${differenceHours}h ago`

  const differenceDays = Math.floor(differenceHours / 24)
  if (differenceDays < 30) return `${differenceDays}d ago`

  const differenceMonths = Math.floor(differenceDays / 30)
  if (differenceMonths < 12) return `${differenceMonths}mo ago`

  return `${Math.floor(differenceMonths / 12)}y ago`
}

function renderFullRow(content: string, width: number, selected = false): string {
  const contentWidth = Math.max(1, width - 1)
  const clipped = truncateVisible(content, contentWidth)
  if (!selected) return padVisible(` ${clipped}`, width)

  // Reapply the row background after each foreground reset so the highlight
  // remains continuous across the row's independently colored fields.
  const highlighted = clipped.replaceAll(colors.reset, `${colors.reset}${colors.bgContainer}`)
  const body = padVisible(highlighted, contentWidth)
  return ` ${colors.bgContainer}${body}${colors.reset}`
}

function renderHeader(options: TerminalResumeViewOptions, width: number): string {
  const contentWidth = Math.max(1, width - 1)
  const searchText = options.query.length > 0
    ? `${colors.subtle}Search:${colors.reset} ${colors.foreground}${options.query}${colors.reset}`
    : `${colors.subtle}Type to search${colors.reset}`
  const cwdLabel = options.filterScope === 'cwd'
    ? `${colors.accent}[Cwd]${colors.reset}`
    : `${colors.subtle}Cwd${colors.reset}`
  const allLabel = options.filterScope === 'all'
    ? `${colors.accent}[All]${colors.reset}`
    : `${colors.subtle}All${colors.reset}`
  const updatedLabel = options.sortMode === 'updated'
    ? `${colors.accent}[Updated]${colors.reset}`
    : `${colors.subtle}Updated${colors.reset}`
  const createdLabel = options.sortMode === 'created'
    ? `${colors.accent}[Created]${colors.reset}`
    : `${colors.subtle}Created${colors.reset}`
  const right = `Filter: ${cwdLabel}  ${allLabel}    Sort: ${updatedLabel} ${createdLabel}`
  const activePage = options.page === 'active'
    ? `${colors.accent}[Active]${colors.reset}`
    : `${colors.subtle}Active${colors.reset}`
  const archivedPage = options.page === 'archived'
    ? `${colors.accent}[Archived]${colors.reset}`
    : `${colors.subtle}Archived${colors.reset}`
  const pageHeader = `View: ${activePage} ${archivedPage}    `
  const controls = `${pageHeader}${right}`
  const renderedRight = truncateVisible(controls, Math.max(1, contentWidth - 4))
  const leftWidth = Math.max(1, contentWidth - visibleWidth(renderedRight) - 2)
  return ` ${padVisible(truncateVisible(searchText, leftWidth), leftWidth)}  ${renderedRight}`
}

function renderFooter(
  options: TerminalResumeViewOptions,
  width: number,
  visibleEnd: number,
): string {
  const contentWidth = Math.max(1, width - 1)
  const hasMore = visibleEnd < options.items.length
  const archiveHint = options.page === 'active' ? 'Space archive' : 'Space unarchive'
  const hint = hasMore
    ? `↓ more  ←→ page · ↑↓ move · Enter resume · ${archiveHint} · F filter · S sort · Esc cancel`
    : `←→ page · ↑↓ move · Enter resume · ${archiveHint} · F filter · S sort · Esc cancel`
  const selectedPosition = options.items.length === 0 ? 0 : options.selectedIndex + 1
  const progress = options.items.length <= 1
    ? 0
    : Math.round((options.selectedIndex / (options.items.length - 1)) * 100)
  const status = `${selectedPosition} / ${options.items.length}  ${progress}%`
  const statusWidth = visibleWidth(status)
  const hintWidth = Math.max(1, contentWidth - statusWidth - 2)
  return ` ${padVisible(truncateVisible(`${colors.subtle}${hint}${colors.reset}`, hintWidth), hintWidth)}  ${status}`
}

export function buildTerminalResumeLines(options: TerminalResumeViewOptions, width: number): string[] {
  const safeWidth = Math.max(40, width)
  const pageSize = Math.max(1, options.pageSize)
  const pageItems = options.items.filter((item) => options.page === 'archived' ? item.isArchived : !item.isArchived)
  const selectedIndex = Math.max(0, Math.min(options.selectedIndex, Math.max(0, pageItems.length - 1)))
  const visibleCount = Math.min(pageItems.length, pageSize)
  const visibleStart = Math.max(0, Math.min(
    selectedIndex - Math.floor(visibleCount / 2),
    Math.max(0, pageItems.length - visibleCount),
  ))
  const visibleEnd = visibleStart + visibleCount
  const visibleItems = pageItems.slice(visibleStart, visibleEnd)
  const timeColumnWidth = 9
  const titleWidth = Math.max(1, safeWidth - timeColumnWidth - 5)

  const lines = [renderHeader({ ...options, selectedIndex }, safeWidth)]

  if (visibleItems.length === 0) {
    const emptyText = options.query.length > 0
      ? `No conversations match “${options.query}”.`
      : options.filterScope === 'cwd'
        ? `No conversations saved for ${options.projectLabel}. Press F for all projects.`
        : 'No saved conversations found.'
    lines.push(renderFullRow(`${colors.subtle}${emptyText}${colors.reset}`, safeWidth))
  } else {
    visibleItems.forEach((item, relativeIndex) => {
      const actualIndex = visibleStart + relativeIndex
      const selected = actualIndex === selectedIndex
      const cursor = selected ? `${colors.accent}›${colors.reset}` : ' '
      const project = options.filterScope === 'all'
        ? ` ${colors.subtle}[${item.projectLabel}]${colors.reset}`
        : ''
      const title = truncateVisible(`${item.title}${project}`, titleWidth)
      const timestamp = options.sortMode === 'created' ? item.createdAt : item.updatedAt
      const row = `${cursor} ${colors.subtle}${padVisible(formatResumeRelativeTime(timestamp), timeColumnWidth)}${colors.reset}  ${selected ? colors.bold : ''}${colors.foreground}${title}${colors.reset}`
      lines.push(renderFullRow(row, safeWidth, selected))
    })
  }

  lines.push(renderFooter({ ...options, items: pageItems, selectedIndex }, safeWidth, visibleEnd))
  return lines
}
