import { colors } from './renderer'
import { getTerminalPanelWidth, renderPromptPanel, type TerminalPromptPanel } from './terminalPanels'
import { formatInlineMarkdown } from './terminalMarkdown'
import { visibleWidth, wrapVisible } from './terminalText'
import type { ActiveTurnFollowUpView, CompletionItemView, TerminalActivityView, TranscriptEntry } from './terminalView'
import { renderTerminalToolRowText } from './terminalToolRow'
import { renderTerminalActivityLine } from './terminalActivity'
import { getThinkingSpinnerFrame } from './thinkingIndicator'
import { formatCliImageReferenceInText } from './cliImageAttachments'
import { formatThoughtDuration } from './terminalDuration'

export interface ActiveTurnComposerData {
  composerWidth: number
  placeholder: string
  visualLines?: readonly string[]
  completionItems?: readonly CompletionItemView[]
  completionIndex?: number
  cursorColumn?: number
  cursorRow?: number
  queued?: boolean
  statusLine?: string
}

export interface ActiveTurnRenderData {
  activity: TerminalActivityView
  entries: readonly TranscriptEntry[]
  followUps?: readonly ActiveTurnFollowUpView[]
  panel: TerminalPromptPanel
  maxOutputLines?: number
  thinkingFrame?: string
  leadingSpacer?: boolean
}

function renderActiveFollowUp(followUp: ActiveTurnFollowUpView, width: number): string[] {
  const label = followUp.behavior === 'steer' ? 'Steer' : 'Queued'
  const labelColor = followUp.behavior === 'steer' ? colors.accent : colors.subtle
  return wrapPrefixed(
    `${labelColor}[${label}]${colors.reset} ${colors.foreground}${followUp.text}${colors.reset}`,
    '  ',
    width,
  )
}

export interface ActiveTurnRender {
  lines: string[]
  cursorRow: number
  cursorColumn: number
  activityRow: number | null
}

function wrapPrefixed(text: string, prefix: string, width: number): string[] {
  const availableWidth = Math.max(1, width - visibleWidth(prefix))
  return wrapVisible(text, availableWidth).map((line) => `${prefix}${line}`)
}

function renderUserMessage(text: string, width: number, isSelected = false): string[] {
  const marker = isSelected ? '▸' : '›'
  const firstPrefix = `${isSelected ? colors.bold : ''}${colors.accent}${marker}${colors.reset} `
  const continuationPrefix = '  '
  const availableWidth = Math.max(1, width - visibleWidth(continuationPrefix))
  const lines: string[] = []
  let isFirstVisualLine = true

  for (const logicalLine of text.split(/\r?\n/u)) {
    const formatted = formatCliImageReferenceInText(logicalLine)
    for (const visualLine of wrapVisible(formatted, availableWidth)) {
      lines.push(`${isFirstVisualLine ? firstPrefix : continuationPrefix}${visualLine}`)
      isFirstVisualLine = false
    }
  }

  return lines
}

function renderTurnEntry(entry: TranscriptEntry, width: number): string[] {
  if (entry.kind === 'thought') {
    const label = entry.durationSeconds === undefined ? 'Thought' : 'Thought for'
    const duration = entry.durationSeconds === undefined ? '' : ` ${formatThoughtDuration(entry.durationSeconds)}`
    return [`  ${colors.subtle}${label}${duration}${colors.reset}`]
  }

  if (entry.kind === 'compaction') {
    return [`  ${colors.success}✓${colors.reset} ${colors.subtle}Compacted${colors.reset}`]
  }

  if (entry.kind === 'tool') {
    const lines = wrapPrefixed(renderTerminalToolRowText(entry.label, entry.status, entry.detail), '  ', width)
    if (entry.diff) lines.push(...entry.diff.split(/\r?\n/).flatMap((line) => wrapPrefixed(line, '    ', width)))
    return lines
  }

  if (entry.kind === 'assistant') {
    if (!entry.text) return []
    return entry.text.split(/\r?\n/).flatMap((line) => wrapPrefixed(formatInlineMarkdown(line), '  ', width))
  }

  if (entry.kind === 'notice') {
    const color = entry.level === 'success' ? colors.success : entry.level === 'warning' ? colors.warning : entry.level === 'error' ? colors.danger : colors.accent
    return wrapPrefixed(`${color}${entry.text}${colors.reset}`, '  ', width)
  }

  return []
}

function appendBlankRow(lines: string[]): void {
  if (lines.at(-1) !== '') lines.push('')
}

function isVisibleTurnEntry(entry: TranscriptEntry): boolean {
  return entry.kind !== 'assistant' || entry.text.length > 0
}

function isTurnEntryBoundary(previousEntry: TranscriptEntry | undefined, entry: TranscriptEntry): boolean {
  if (!previousEntry || previousEntry.kind === 'user' || entry.kind === 'user') return false
  return previousEntry.kind !== entry.kind
}

function renderTurnEntries(entries: readonly TranscriptEntry[], width: number): string[] {
  const lines: string[] = []
  let previousEntry: TranscriptEntry | undefined

  for (const entry of entries) {
    if (!isVisibleTurnEntry(entry)) continue
    if (isTurnEntryBoundary(previousEntry, entry)) appendBlankRow(lines)
    lines.push(...renderTurnEntry(entry, width))
    previousEntry = entry
  }

  return lines
}

export function renderCommittedTurn(
  entries: readonly TranscriptEntry[],
  options: { leadingSpacer?: boolean } = {},
): string[] {
  const width = getTerminalPanelWidth()
  const lines = renderTurnEntries(entries, width)
  const contentLines = lines.length > 0
    ? lines
    : [`  ${colors.subtle}Turn completed without response text.${colors.reset}`]
  const committedLines = options.leadingSpacer === false ? [...contentLines] : ['', ...contentLines]
  appendBlankRow(committedLines)
  return committedLines
}

export function renderConversationHistory(
  entries: readonly TranscriptEntry[],
  options: { selectedUserMessageId?: string | null; maxLines?: number } = {},
): string[] {
  const width = getTerminalPanelWidth()
  const lines: string[] = []
  let previousEntry: TranscriptEntry | undefined
  let selectedLineIndex: number | null = null

  for (const entry of entries) {
    if (entry.kind === 'user') {
      appendBlankRow(lines)
      if (entry.id === options.selectedUserMessageId) {
        selectedLineIndex = lines.length
      }
      lines.push(...renderUserMessage(entry.text, width, entry.id === options.selectedUserMessageId))
      appendBlankRow(lines)
    } else {
      if (!isVisibleTurnEntry(entry)) continue
      if (isTurnEntryBoundary(previousEntry, entry)) appendBlankRow(lines)
      lines.push(...renderTurnEntry(entry, width))
    }
    previousEntry = entry
  }

  if (lines.length > 0) appendBlankRow(lines)

  const maxLines = options.maxLines
  if (
    selectedLineIndex === null ||
    maxLines === undefined ||
    maxLines <= 0 ||
    lines.length <= maxLines
  ) {
    return lines
  }

  const visibleLineCount = Math.max(1, Math.floor(maxLines))
  const preferredContextAbove = Math.max(1, Math.floor(visibleLineCount * 0.4))
  let startIndex = Math.max(0, selectedLineIndex - preferredContextAbove)
  const endIndex = Math.min(lines.length, startIndex + visibleLineCount)
  if (endIndex - startIndex < visibleLineCount) {
    startIndex = Math.max(0, endIndex - visibleLineCount)
  }

  return lines.slice(startIndex, endIndex)
}

export function renderActiveTurn(data: ActiveTurnRenderData): ActiveTurnRender {
  const width = getTerminalPanelWidth()
  const outputLines: string[] = []
  outputLines.push(...renderTurnEntries(data.entries, width))
  let activityRow: number | null = null
  const thinkingFrame = data.thinkingFrame ?? getThinkingSpinnerFrame(0)
  if (data.activity.kind !== 'idle') {
    const lastVisibleEntry = [...data.entries].reverse().find(isVisibleTurnEntry)
    const activityEntryKind = data.activity.kind === 'thinking' ? 'thought' : 'tool'
    const startsNewWaitingPhase = data.activity.kind === 'thinking' && lastVisibleEntry?.kind === 'thought'
    if (lastVisibleEntry && (lastVisibleEntry.kind !== activityEntryKind || startsNewWaitingPhase)) {
      appendBlankRow(outputLines)
    }
    activityRow = outputLines.length
    outputLines.push(renderTerminalActivityLine(data.activity, width, thinkingFrame))
  }
  if (data.maxOutputLines && outputLines.length > data.maxOutputLines) {
    const hiddenLineCount = outputLines.length - data.maxOutputLines
    outputLines.splice(0, hiddenLineCount)
    if (activityRow !== null) activityRow = Math.max(0, activityRow - hiddenLineCount)
  }
  if (data.followUps?.length) {
    if (outputLines.length > 0) appendBlankRow(outputLines)
    for (const followUp of data.followUps) outputLines.push(...renderActiveFollowUp(followUp, width))
  }

  const panel = data.panel
  const spacedOutputLines = data.leadingSpacer === false ? [...outputLines] : ['', ...outputLines]
  if (activityRow !== null && data.leadingSpacer !== false) activityRow += 1
  return {
    lines: [...spacedOutputLines, '', ...panel.lines],
    cursorRow: spacedOutputLines.length + 1 + panel.cursorRow,
    cursorColumn: panel.cursorColumn,
    activityRow,
  }
}

export function createActiveTurnPromptPanel(data: ActiveTurnComposerData): TerminalPromptPanel {
  return renderPromptPanel({
    title: data.queued ? 'queued' : 'compose',
    visualLines: data.visualLines ?? [''],
    placeholder: data.placeholder,
    completionItems: data.completionItems ?? [],
    completionIndex: data.completionIndex ?? 0,
    composerWidth: data.composerWidth,
    cursorColumn: data.cursorColumn ?? 0,
    cursorRow: data.cursorRow ?? 0,
    statusLine: data.statusLine,
  })
}
