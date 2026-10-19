import { validateTideUI } from './validate'
import type { TideDocument } from './types'

const EMPTY_STREAM: TideDocument = { nodes: [], errors: [], warnings: [] }
interface StreamingParseOptions {
  blockComplete?: boolean
}

function lineIndent(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * Streaming only commits syntactically complete declarations.
 *
 * Leaf controls are eligible only after their newline arrives, so labels,
 * messages and attributes can never visibly stream token-by-token.
 * Containers and child-driven widgets stay mounted while each completed child
 * declaration commits. Charts, tables and other widgets do not wait for their
 * entire subtree or the surrounding panel to finish.
 */
export function parseStreamingTideUI(
  source: string,
  options: StreamingParseOptions = {},
): TideDocument {
  const normalized = source.replace(/\r\n?/gu, '\n')
  const blockComplete = options.blockComplete === true
  const lastCompletedLine = normalized.lastIndexOf('\n')
  if (!blockComplete && lastCompletedLine < 0) return EMPTY_STREAM

  const eligibleSource = blockComplete
    ? normalized
    : normalized.slice(0, lastCompletedLine)
  let lines = eligibleSource.split('\n')
  if (lines.every(line => !line.trim())) return EMPTY_STREAM

  const maxAttempts = lines.length
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = validateTideUI(lines.join('\n'))
    if (result.errors.length === 0) {
      return {
        nodes: result.nodes,
        errors: [],
        warnings: result.warnings,
      }
    }

    const lineMatch = /^Line (\d+):/u.exec(result.errors[0])
    if (!lineMatch) return result
    const index = Number(lineMatch[1]) - 1
    const badLine = lines[index]
    if (badLine === undefined) return EMPTY_STREAM

    const indent = lineIndent(badLine)
    let end = index + 1
    while (end < lines.length) {
      const next = lines[end]
      if (next.trim() && lineIndent(next) <= indent) break
      end++
    }
    // Keep source positions intact: React uses these line numbers as keys for
    // nodes without explicit ids, including when the final document validates.
    lines = lines.map((line, lineIndex) => {
      if (lineIndex >= index && lineIndex < end) {
        return ''
      }
      return line
    })
    if (!lines.some(line => line.trim())) return EMPTY_STREAM
  }

  return EMPTY_STREAM
}
