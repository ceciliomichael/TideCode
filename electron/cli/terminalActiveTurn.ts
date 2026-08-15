import { colors } from './renderer'
import { getTerminalPanelWidth, renderPromptPanel, type TerminalPromptPanel } from './terminalPanels'
import { formatInlineMarkdown } from './terminalMarkdown'
import { visibleWidth, wrapVisible } from './terminalText'
import type { ActiveTurnFollowUpView, CompletionItemView, TerminalActivityView, TranscriptEntry } from './terminalView'
import { renderTerminalToolRowText } from './terminalToolRow'
import { renderTerminalActivityLine } from './terminalActivity'
import { getThinkingSpinnerFrame } from './thinkingIndicator'

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

function renderUserMessage(text: string, width: number): string[] {
  const firstPrefix = `${colors.accent}›${colors.reset} `
  const continuationPrefix = '  '
  const availableWidth = Math.max(1, width - visibleWidth(continuationPrefix))
  const lines: string[] = []
  let isFirstVisualLine = true

  for (const logicalLine of text.split(/\r?\n/u)) {
    for (const visualLine of wrapVisible(logicalLine, availableWidth)) {
      lines.push(`${isFirstVisualLine ? firstPrefix : continuationPrefix}${visualLine}`)
      isFirstVisualLine = false
    }
  }

  return lines
}

function renderTurnEntry(entry: TranscriptEntry, width: number): string[] {
  if (entry.kind === 'thought') {
    const label = entry.durationSeconds === undefined ? 'Thought' : 'Thought for'
    const duration = entry.durationSeconds === undefined ? '' : ` ${entry.durationSeconds.toFixed(1)}s`
    return [`  ${colors.subtle}› ${label}${duration}${colors.reset}`]
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

function isAssistantToolBoundary(previousEntry: TranscriptEntry | undefined, entry: TranscriptEntry): boolean {
  return (
    (previousEntry?.kind === 'assistant' && entry.kind === 'tool') ||
    (previousEntry?.kind === 'tool' && entry.kind === 'assistant')
  )
}

function isThoughtOutputBoundary(previousEntry: TranscriptEntry | undefined, entry: TranscriptEntry): boolean {
  return previousEntry?.kind === 'thought' && (entry.kind === 'assistant' || entry.kind === 'tool')
}

function renderTurnEntries(entries: readonly TranscriptEntry[], width: number): string[] {
  const lines: string[] = []
  let previousEntry: TranscriptEntry | undefined

  for (const entry of entries) {
    if (isAssistantToolBoundary(previousEntry, entry) || isThoughtOutputBoundary(previousEntry, entry)) lines.push('')
    lines.push(...renderTurnEntry(entry, width))
    previousEntry = entry
  }

  return lines
}

export function renderCommittedTurn(entries: readonly TranscriptEntry[]): string[] {
  const width = getTerminalPanelWidth()
  const lines = renderTurnEntries(entries, width)
  return lines.length > 0 ? ['', ...lines] : ['', `  ${colors.subtle}Turn completed without response text.${colors.reset}`]
}

export function renderConversationHistory(entries: readonly TranscriptEntry[]): string[] {
  const width = getTerminalPanelWidth()
  const lines: string[] = []
  let previousEntry: TranscriptEntry | undefined

  for (const entry of entries) {
    if (entry.kind === 'user') {
      lines.push(...(lines.length === 0 ? [''] : ['', '']))
      lines.push(...renderUserMessage(entry.text, width))
      lines.push('')
    } else {
      if (
        isAssistantToolBoundary(previousEntry, entry) ||
        isThoughtOutputBoundary(previousEntry, entry) ||
        (entry.kind === 'assistant' && entry.section === 'answer' && previousEntry?.kind !== 'user')
      ) {
        lines.push('')
      }
      lines.push(...renderTurnEntry(entry, width))
    }
    previousEntry = entry
  }

  return lines
}

export function renderActiveTurn(data: ActiveTurnRenderData): ActiveTurnRender {
  const width = getTerminalPanelWidth()
  const outputLines: string[] = []
  outputLines.push(...renderTurnEntries(data.entries, width))
  let activityRow: number | null = null
  const thinkingFrame = data.thinkingFrame ?? getThinkingSpinnerFrame(0)
  if (data.activity.kind !== 'idle') {
    activityRow = outputLines.length
    outputLines.push(renderTerminalActivityLine(data.activity, width, thinkingFrame))
  }
  if (data.maxOutputLines && outputLines.length > data.maxOutputLines) {
    const hiddenLineCount = outputLines.length - data.maxOutputLines + 1
    outputLines.splice(0, hiddenLineCount, `  ${colors.subtle}↑ ${hiddenLineCount} earlier live lines${colors.reset}`)
    if (activityRow !== null) activityRow = Math.max(0, activityRow - hiddenLineCount + 1)
  }
  if (data.followUps?.length) {
    if (outputLines.length > 0) outputLines.push('')
    for (const followUp of data.followUps) outputLines.push(...renderActiveFollowUp(followUp, width))
  }

  const panel = data.panel
  const spacedOutputLines = ['', ...outputLines]
  if (activityRow !== null) activityRow += 1
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
