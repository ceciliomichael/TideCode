import { visibleWidth } from './terminalText'
import { processTerminalOutput, type TerminalOutput } from './terminalOutput'

export interface TerminalRegionPatch {
  row: number
  text: string
  clearBeforeWrite: boolean
}

export type TerminalRegionUpdatePlan =
  | { kind: 'replace'; lines: readonly string[] }
  | { kind: 'patch'; patches: readonly TerminalRegionPatch[] }

/**
 * Erases a transient terminal region and leaves the cursor at its first row.
 *
 * Clearing line-by-line is more reliable across Windows terminal hosts than
 * relying on clearScreenDown, especially when the region was drawn without a
 * trailing newline and the active cursor is inside the region.
 */
export function clearTerminalRegion(renderedRows: number, cursorRow = 0, output: TerminalOutput = processTerminalOutput): void {
  if (renderedRows <= 0) return

  const topOffset = Math.max(0, Math.min(cursorRow, renderedRows - 1))
  output.moveCursor(0, -topOffset)
  output.cursorTo(0)

  for (let row = 0; row < renderedRows; row += 1) {
    output.cursorTo(0)
    output.write('\x1b[2K')
    if (row < renderedRows - 1) output.moveCursor(0, 1)
  }

  if (renderedRows > 1) output.moveCursor(0, -(renderedRows - 1))
  output.cursorTo(0)
}

export function getChangedTerminalRows(previousLines: readonly string[], nextLines: readonly string[]): number[] {
  const rowCount = Math.max(previousLines.length, nextLines.length)
  return Array.from({ length: rowCount }, (_, index) => index).filter((index) => previousLines[index] !== nextLines[index])
}

export function planTerminalRegionUpdate(previousLines: readonly string[], nextLines: readonly string[]): TerminalRegionUpdatePlan {
  if (previousLines.length !== nextLines.length) {
    return { kind: 'replace', lines: nextLines }
  }

  return {
    kind: 'patch',
    patches: getChangedTerminalRows(previousLines, nextLines).map((row) => ({
      row,
      text: nextLines[row],
      clearBeforeWrite: visibleWidth(nextLines[row]) < visibleWidth(previousLines[row]),
    })),
  }
}

/**
 * Updates a region without erasing and repainting the whole frame. Both
 * frames must be parked at row zero before calling this function.
 */
export function updateTerminalRegion(previousLines: readonly string[], nextLines: readonly string[], output: TerminalOutput = processTerminalOutput): void {
  const plan = planTerminalRegionUpdate(previousLines, nextLines)
  if (plan.kind === 'replace') {
    clearTerminalRegion(previousLines.length, 0, output)
    output.write(plan.lines.join('\n'))
    if (plan.lines.length > 1) output.moveCursor(0, -(plan.lines.length - 1))
    output.cursorTo(0)
    return
  }

  let currentRow = 0
  for (const patch of plan.patches) {
    const row = patch.row
    if (row > currentRow) output.moveCursor(0, row - currentRow)
    output.cursorTo(0)
    output.write(`${patch.clearBeforeWrite ? '\x1b[2K' : ''}${patch.text}`)
    currentRow = row
  }

  if (currentRow > 0) output.moveCursor(0, -currentRow)
  output.cursorTo(0)
}
