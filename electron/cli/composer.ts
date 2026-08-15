import type { TerminalInputAction } from './terminalInput'
import { visibleWidth, wrapVisible } from './terminalText'

export interface ComposerState {
  lines: string[]
  lineIndex: number
  column: number
  history: string[]
  historyIndex: number | null
}

export interface ComposerVisualLine {
  text: string
  sourceLineIndex: number
  sourceStartColumn: number
  sourceEndColumn: number
}

export interface ComposerCursorPosition {
  lineIndex: number
  column: number
}

export function createComposerState(history: readonly string[] = []): ComposerState {
  return {
    lines: [''],
    lineIndex: 0,
    column: 0,
    history: [...history],
    historyIndex: null,
  }
}

export function composerText(state: ComposerState): string {
  return state.lines.join('\n')
}

export function isComposerEmpty(state: ComposerState): boolean {
  return composerText(state).trim().length === 0
}

export function setComposerText(state: ComposerState, text: string): ComposerState {
  const lines = text.split('\n')
  return {
    ...state,
    lines: lines.length > 0 ? lines : [''],
    lineIndex: Math.max(0, lines.length - 1),
    column: lines.at(-1)?.length ?? 0,
    historyIndex: null,
  }
}

function updateCurrentLine(state: ComposerState, nextLine: string, nextColumn: number): ComposerState {
  const lines = [...state.lines]
  lines[state.lineIndex] = nextLine
  return { ...state, lines, column: Math.max(0, Math.min(nextColumn, nextLine.length)), historyIndex: null }
}

function moveToLine(state: ComposerState, lineIndex: number, column = state.column): ComposerState {
  const safeLineIndex = Math.max(0, Math.min(lineIndex, state.lines.length - 1))
  return {
    ...state,
    lineIndex: safeLineIndex,
    column: Math.max(0, Math.min(column, state.lines[safeLineIndex].length)),
    historyIndex: null,
  }
}

function moveWordLeft(state: ComposerState): ComposerState {
  let column = state.column
  const line = state.lines[state.lineIndex]
  while (column > 0 && /\s/.test(line[column - 1])) column -= 1
  while (column > 0 && !/\s/.test(line[column - 1])) column -= 1
  return { ...state, column, historyIndex: null }
}

function moveWordRight(state: ComposerState): ComposerState {
  const line = state.lines[state.lineIndex]
  let column = state.column
  while (column < line.length && /\s/.test(line[column])) column += 1
  while (column < line.length && !/\s/.test(line[column])) column += 1
  return { ...state, column, historyIndex: null }
}

function previousHistory(state: ComposerState): ComposerState {
  if (state.history.length === 0) return state
  const nextIndex = state.historyIndex === null
    ? state.history.length - 1
    : Math.max(0, state.historyIndex - 1)
  return { ...setComposerText(state, state.history[nextIndex]), historyIndex: nextIndex }
}

function nextHistory(state: ComposerState): ComposerState {
  if (state.historyIndex === null) return state
  const nextIndex = state.historyIndex + 1
  if (nextIndex >= state.history.length) return { ...setComposerText(state, ''), historyIndex: null }
  return { ...setComposerText(state, state.history[nextIndex]), historyIndex: nextIndex }
}

export function applyComposerAction(state: ComposerState, action: TerminalInputAction): ComposerState {
  switch (action.type) {
    case 'insert':
      return updateCurrentLine(
        state,
        `${state.lines[state.lineIndex].slice(0, state.column)}${action.text}${state.lines[state.lineIndex].slice(state.column)}`,
        state.column + action.text.length,
      )
    case 'newline': {
      const line = state.lines[state.lineIndex]
      const lines = [...state.lines]
      lines.splice(state.lineIndex, 1, line.slice(0, state.column), line.slice(state.column))
      return { ...state, lines, lineIndex: state.lineIndex + 1, column: 0, historyIndex: null }
    }
    case 'backspace': {
      const line = state.lines[state.lineIndex]
      if (state.column > 0) {
        return updateCurrentLine(state, `${line.slice(0, state.column - 1)}${line.slice(state.column)}`, state.column - 1)
      }
      if (state.lineIndex === 0) return state
      const previous = state.lines[state.lineIndex - 1]
      const lines = [...state.lines]
      lines.splice(state.lineIndex - 1, 2, `${previous}${line}`)
      return { ...state, lines, lineIndex: state.lineIndex - 1, column: previous.length, historyIndex: null }
    }
    case 'delete': {
      const line = state.lines[state.lineIndex]
      if (state.column < line.length) {
        return updateCurrentLine(state, `${line.slice(0, state.column)}${line.slice(state.column + 1)}`, state.column)
      }
      if (state.lineIndex >= state.lines.length - 1) return state
      const lines = [...state.lines]
      lines.splice(state.lineIndex, 2, `${line}${state.lines[state.lineIndex + 1]}`)
      return { ...state, lines, historyIndex: null }
    }
    case 'move-left':
      if (state.column > 0) return { ...state, column: state.column - 1, historyIndex: null }
      return state.lineIndex > 0 ? moveToLine(state, state.lineIndex - 1, state.lines[state.lineIndex - 1].length) : state
    case 'move-right':
      if (state.column < state.lines[state.lineIndex].length) return { ...state, column: state.column + 1, historyIndex: null }
      return state.lineIndex < state.lines.length - 1 ? moveToLine(state, state.lineIndex + 1, 0) : state
    case 'move-up':
      return state.lineIndex > 0 ? moveToLine(state, state.lineIndex - 1) : previousHistory(state)
    case 'move-down':
      return state.lineIndex < state.lines.length - 1 ? moveToLine(state, state.lineIndex + 1) : nextHistory(state)
    case 'home':
      return { ...state, column: 0, historyIndex: null }
    case 'end':
      return { ...state, column: state.lines[state.lineIndex].length, historyIndex: null }
    case 'word-left':
      return moveWordLeft(state)
    case 'word-right':
      return moveWordRight(state)
    case 'history-previous':
      return previousHistory(state)
    case 'history-next':
      return nextHistory(state)
    default:
      return state
  }
}

export function recordComposerHistory(state: ComposerState, text: string): ComposerState {
  const trimmed = text.trim()
  if (!trimmed) return createComposerState(state.history)
  const history = state.history.at(-1) === trimmed ? state.history : [...state.history, trimmed].slice(-100)
  return createComposerState(history)
}

export function getComposerVisualLines(state: ComposerState, width: number): ComposerVisualLine[] {
  const safeWidth = Math.max(1, width)
  const visualLines: ComposerVisualLine[] = []

  state.lines.forEach((line, sourceLineIndex) => {
    if (line.length === 0) {
      visualLines.push({ text: '', sourceLineIndex, sourceStartColumn: 0, sourceEndColumn: 0 })
      return
    }

    let remaining = line
    let startColumn = 0
    while (remaining.length > 0) {
      const wrapped = wrapVisible(remaining, safeWidth)[0] ?? ''
      const chunk = wrapped.length > 0 ? wrapped : remaining.slice(0, 1)
      const endColumn = startColumn + chunk.length
      visualLines.push({ text: chunk, sourceLineIndex, sourceStartColumn: startColumn, sourceEndColumn: endColumn })
      remaining = remaining.slice(chunk.length)
      startColumn = endColumn
    }
  })

  return visualLines.length > 0 ? visualLines : [{ text: '', sourceLineIndex: 0, sourceStartColumn: 0, sourceEndColumn: 0 }]
}

export function getComposerCursorPosition(state: ComposerState, width: number): ComposerCursorPosition {
  const visualLines = getComposerVisualLines(state, width)
  const matching = visualLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.sourceLineIndex === state.lineIndex)

  const target = matching.find(({ line }) => state.column <= line.sourceEndColumn) ?? matching.at(-1)
  if (!target) return { lineIndex: 0, column: 0 }

  const relativeColumn = Math.max(0, Math.min(state.column - target.line.sourceStartColumn, target.line.text.length))
  return { lineIndex: target.index, column: Math.min(visibleWidth(target.line.text.slice(0, relativeColumn)), width - 1) }
}
