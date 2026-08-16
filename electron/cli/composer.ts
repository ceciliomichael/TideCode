import type { TerminalInputAction } from './terminalInput'
import { visibleWidth } from './terminalText'
import type { ChatAttachment } from '../../src/types/chat'
import {
  findChatImageReferenceForDeletion,
  findChatImageReferenceMatches,
  getChatImageAttachments,
  insertChatImageReferences,
  removeChatImageReference,
} from '../../src/lib/chatImageReferences'

function snapCursorLeftOfImageReferences(cursorIndex: number, text: string, imageCount: number): number {
  const matches = findChatImageReferenceMatches(text, imageCount)
  for (const match of matches) {
    if (cursorIndex > match.start && cursorIndex <= match.end) {
      return match.start
    }
  }
  return cursorIndex
}

function snapCursorRightOfImageReferences(cursorIndex: number, text: string, imageCount: number): number {
  const matches = findChatImageReferenceMatches(text, imageCount)
  for (const match of matches) {
    if (cursorIndex >= match.start && cursorIndex < match.end) {
      return match.end
    }
  }
  return cursorIndex
}

function snapCursorOutsideImageReferences(cursorIndex: number, text: string, imageCount: number): number {
  const matches = findChatImageReferenceMatches(text, imageCount)
  for (const match of matches) {
    if (cursorIndex > match.start && cursorIndex < match.end) {
      return match.start
    }
  }
  return cursorIndex
}

export function setComposerCursorIndex(state: ComposerState, cursorIndex: number): ComposerState {
  const images = getChatImageAttachments(state.attachments)
  const safeCursorIndex = images.length > 0
    ? snapCursorOutsideImageReferences(Math.max(0, cursorIndex), composerText(state), images.length)
    : Math.max(0, cursorIndex)
  let remaining = safeCursorIndex
  for (let i = 0; i < state.lines.length; i++) {
    const lineLength = state.lines[i].length
    if (remaining <= lineLength || i === state.lines.length - 1) {
      return {
        ...state,
        lineIndex: i,
        column: Math.min(remaining, lineLength),
        historyIndex: null,
      }
    }
    remaining -= lineLength + 1
  }
  return state
}

export interface ComposerState {
  lines: string[]
  lineIndex: number
  column: number
  history: string[]
  historyIndex: number | null
  attachments: ChatAttachment[]
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

export function createComposerState(
  history: readonly string[] = [],
  attachments: readonly ChatAttachment[] = [],
): ComposerState {
  return {
    lines: [''],
    lineIndex: 0,
    column: 0,
    history: [...history],
    historyIndex: null,
    attachments: [...attachments],
  }
}

export function composerText(state: ComposerState): string {
  return state.lines.join('\n')
}

export function isComposerEmpty(state: ComposerState): boolean {
  return composerText(state).trim().length === 0
}

export function setComposerText(
  state: ComposerState,
  text: string,
  attachments: readonly ChatAttachment[] = state.attachments,
): ComposerState {
  const lines = text.split('\n')
  return {
    ...state,
    lines: lines.length > 0 ? lines : [''],
    lineIndex: Math.max(0, lines.length - 1),
    column: lines.at(-1)?.length ?? 0,
    historyIndex: null,
    attachments: [...attachments],
  }
}

export function getComposerCursorIndex(state: ComposerState): number {
  return (
    state.lines
      .slice(0, state.lineIndex)
      .reduce((total, line) => total + line.length + 1, 0) + state.column
  )
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

export function attachImagesToComposer(
  state: ComposerState,
  newAttachments: readonly ChatAttachment[],
): ComposerState {
  if (newAttachments.length === 0) return state
  const nextAttachments = [...state.attachments, ...newAttachments]
  const currentImages = getChatImageAttachments(state.attachments)
  const newImages = getChatImageAttachments(newAttachments)
  if (newImages.length === 0) {
    return { ...state, attachments: nextAttachments }
  }

  const fullText = composerText(state)
  const cursorIndex = getComposerCursorIndex(state)
  const insertion = insertChatImageReferences({
    count: newImages.length,
    firstImageNumber: currentImages.length + 1,
    position: cursorIndex,
    text: fullText,
  })

  const nextState = setComposerText(state, insertion.text, nextAttachments)
  return setComposerCursorIndex(nextState, insertion.cursorPosition)
}

export function removeAttachmentFromComposer(
  state: ComposerState,
  imageNumber: number,
): ComposerState {
  const fullText = composerText(state)
  const removed = removeChatImageReference({
    attachments: state.attachments,
    imageNumber,
    text: fullText,
  })
  return setComposerText(state, removed.text, removed.attachments)
}

export function insertTextIntoComposer(state: ComposerState, text: string): ComposerState {
  if (!text) return state
  if (!text.includes('\n')) {
    return applyComposerAction(state, { type: 'insert', text })
  }
  const linesToInsert = text.split(/\r?\n/)
  const currentLine = state.lines[state.lineIndex]
  const before = currentLine.slice(0, state.column)
  const after = currentLine.slice(state.column)

  const updatedLines = [...state.lines]
  if (linesToInsert.length === 1) {
    updatedLines[state.lineIndex] = `${before}${linesToInsert[0]}${after}`
    return {
      ...state,
      lines: updatedLines,
      column: state.column + linesToInsert[0].length,
      historyIndex: null,
    }
  }

  const firstLine = `${before}${linesToInsert[0]}`
  const lastLine = `${linesToInsert[linesToInsert.length - 1]}${after}`
  const middleLines = linesToInsert.slice(1, -1)
  const newLines = [firstLine, ...middleLines, lastLine]

  updatedLines.splice(state.lineIndex, 1, ...newLines)
  return {
    ...state,
    lines: updatedLines,
    lineIndex: state.lineIndex + linesToInsert.length - 1,
    column: linesToInsert[linesToInsert.length - 1].length,
    historyIndex: null,
  }
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
      const images = getChatImageAttachments(state.attachments)
      if (images.length > 0) {
        const fullText = composerText(state)
        const cursorIndex = getComposerCursorIndex(state)
        const ref = findChatImageReferenceForDeletion({
          imageCount: images.length,
          key: 'Backspace',
          selectionEnd: cursorIndex,
          selectionStart: cursorIndex,
          text: fullText,
        })
        if (ref) {
          const removed = removeChatImageReference({
            attachments: state.attachments,
            imageNumber: ref.imageNumber,
            text: fullText,
          })
          const nextState = setComposerText(state, removed.text, removed.attachments)
          return setComposerCursorIndex(nextState, Math.min(ref.start, removed.text.length))
        }
      }
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
      const images = getChatImageAttachments(state.attachments)
      if (images.length > 0) {
        const fullText = composerText(state)
        const cursorIndex = getComposerCursorIndex(state)
        const ref = findChatImageReferenceForDeletion({
          imageCount: images.length,
          key: 'Delete',
          selectionEnd: cursorIndex,
          selectionStart: cursorIndex,
          text: fullText,
        })
        if (ref) {
          const removed = removeChatImageReference({
            attachments: state.attachments,
            imageNumber: ref.imageNumber,
            text: fullText,
          })
          const nextState = setComposerText(state, removed.text, removed.attachments)
          return setComposerCursorIndex(nextState, Math.min(ref.start, removed.text.length))
        }
      }
      const line = state.lines[state.lineIndex]
      if (state.column < line.length) {
        return updateCurrentLine(state, `${line.slice(0, state.column)}${line.slice(state.column + 1)}`, state.column)
      }
      if (state.lineIndex >= state.lines.length - 1) return state
      const lines = [...state.lines]
      lines.splice(state.lineIndex, 2, `${line}${state.lines[state.lineIndex + 1]}`)
      return { ...state, lines, historyIndex: null }
    }
    case 'move-left': {
      const images = getChatImageAttachments(state.attachments)
      if (images.length > 0) {
        const fullText = composerText(state)
        const cursorIndex = getComposerCursorIndex(state)
        if (cursorIndex > 0) {
          const snapped = snapCursorLeftOfImageReferences(cursorIndex - 1, fullText, images.length)
          return setComposerCursorIndex(state, snapped)
        }
        return state
      }
      if (state.column > 0) return { ...state, column: state.column - 1, historyIndex: null }
      return state.lineIndex > 0 ? moveToLine(state, state.lineIndex - 1, state.lines[state.lineIndex - 1].length) : state
    }
    case 'move-right': {
      const images = getChatImageAttachments(state.attachments)
      if (images.length > 0) {
        const fullText = composerText(state)
        const cursorIndex = getComposerCursorIndex(state)
        if (cursorIndex < fullText.length) {
          const snapped = snapCursorRightOfImageReferences(cursorIndex + 1, fullText, images.length)
          return setComposerCursorIndex(state, snapped)
        }
        return state
      }
      if (state.column < state.lines[state.lineIndex].length) return { ...state, column: state.column + 1, historyIndex: null }
      return state.lineIndex < state.lines.length - 1 ? moveToLine(state, state.lineIndex + 1, 0) : state
    }
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

export function sanitizeComposerHistoryText(text: string): string {
  const trimmed = text.trim()
  const parts = trimmed.split(/\s+/u)
  const command = parts[0]?.toLowerCase()
  const action = parts[1]?.toLowerCase()
  if ((command === '/provider' || command === '/p') && (action === 'add' || action === 'new') && parts.length >= 5) {
    return [...parts.slice(0, 4), '[redacted]'].join(' ')
  }
  return trimmed
}

export function recordComposerHistory(state: ComposerState, text: string): ComposerState {
  const trimmed = sanitizeComposerHistoryText(text)
  if (!trimmed) return createComposerState(state.history)
  const history = state.history.at(-1) === trimmed ? state.history : [...state.history, trimmed].slice(-100)
  return createComposerState(history)
}

interface ComposerWrapChunk {
  text: string
  renderedLength: number
  consumedLength: number
}

function getComposerWrapChunk(text: string, maxWidth: number): ComposerWrapChunk {
  let rendered = ''
  let renderedWidth = 0
  let renderedLength = 0
  let consumedLength = 0

  for (const token of text.split(/(\s+)/)) {
    if (token.length === 0) continue
    const tokenWidth = visibleWidth(token)

    if (tokenWidth > maxWidth) {
      for (const character of token) {
        const characterWidth = visibleWidth(character)
        if (renderedWidth + characterWidth > maxWidth && rendered.length > 0) {
          return { text: rendered, renderedLength, consumedLength }
        }
        rendered += character
        renderedWidth += characterWidth
        renderedLength += character.length
        consumedLength += character.length
      }
      continue
    }

    if (renderedWidth + tokenWidth > maxWidth && rendered.length > 0) {
      if (/^\s+$/.test(token)) consumedLength += token.length
      return { text: rendered, renderedLength, consumedLength }
    }

    rendered += token
    renderedWidth += tokenWidth
    renderedLength += token.length
    consumedLength += token.length
  }

  return { text: rendered, renderedLength, consumedLength }
}

export function getComposerVisualLines(state: ComposerState, width: number): ComposerVisualLine[] {
  const safeWidth = Math.max(1, width)
  const visualLines: ComposerVisualLine[] = []

  state.lines.forEach((line, sourceLineIndex) => {
    if (line.length === 0) {
      visualLines.push({ text: '', sourceLineIndex, sourceStartColumn: 0, sourceEndColumn: 0 })
      return
    }

    let startColumn = 0
    while (startColumn < line.length) {
      const chunk = getComposerWrapChunk(line.slice(startColumn), safeWidth)
      const renderedEndColumn = startColumn + chunk.renderedLength
      visualLines.push({
        text: chunk.text,
        sourceLineIndex,
        sourceStartColumn: startColumn,
        sourceEndColumn: renderedEndColumn,
      })
      startColumn += chunk.consumedLength
    }
  })

  return visualLines.length > 0 ? visualLines : [{ text: '', sourceLineIndex: 0, sourceStartColumn: 0, sourceEndColumn: 0 }]
}

export function getComposerCursorPosition(state: ComposerState, width: number): ComposerCursorPosition {
  const visualLines = getComposerVisualLines(state, width)
  const matching = visualLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.sourceLineIndex === state.lineIndex)

  const target = matching.find(({ line }) => (
    state.column >= line.sourceStartColumn && state.column <= line.sourceEndColumn
  )) ?? matching.find(({ line }) => state.column < line.sourceStartColumn) ?? matching.at(-1)
  if (!target) return { lineIndex: 0, column: 0 }

  const relativeColumn = Math.max(0, Math.min(state.column - target.line.sourceStartColumn, target.line.text.length))
  return { lineIndex: target.index, column: Math.min(visibleWidth(target.line.text.slice(0, relativeColumn)), width - 1) }
}
