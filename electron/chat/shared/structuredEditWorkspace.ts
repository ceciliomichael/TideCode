import { promises as fs } from 'node:fs'
import { normalizeContentLineEndings } from './applyPatchMatcher'
import { findExactMatchOffsets, findIndentationTolerantMatchOffsets, type TextMatch } from './tools/textReplacementMatching'
import { enqueueWorkspaceMutations } from './tools/workspaceMutationQueue'
import { preserveExistingTextFormat } from './tools/workspaceMutationSafety'
import { commitStagedFiles } from './applyPatchWorkspace'
import type { ApplyPatchTargetPath } from './applyPatchTypes'

export interface StructuredReplacement {
  path: string
  oldText: string
  newText: string
  replace_all?: boolean
  line?: number
  before?: string
  after?: string
}

function candidateLine(content: string, offset: number) {
  return content.slice(0, offset).split('\n').length
}

function resolveEditMatches(content: string, change: StructuredReplacement, oldText: string): { matches: TextMatch[]; tolerant: boolean } {
  let matches = findExactMatchOffsets(content, oldText)
  let tolerant = false
  if (matches.length === 0) {
    matches = findIndentationTolerantMatchOffsets(content, oldText).filter((match) => {
      const actualLines = content.slice(match.startOffset, match.endOffset).trimEnd().split('\n')
      const expectedLines = oldText.trimEnd().split('\n')
      return actualLines.length === expectedLines.length && actualLines.every(
        (line, index) => line.trim() === expectedLines[index]!.trim(),
      )
    })
    tolerant = matches.length > 0
  }
  if (change.line !== undefined) {
    matches = matches.filter((match) => candidateLine(content, match.startOffset) === change.line)
  }
  if (change.before !== undefined) {
    const before = normalizeContentLineEndings(change.before)
    matches = matches.filter((match) => content.slice(0, match.startOffset).endsWith(before))
  }
  if (change.after !== undefined) {
    const after = normalizeContentLineEndings(change.after)
    matches = matches.filter((match) => content.slice(match.endOffset).startsWith(after))
  }
  return { matches, tolerant }
}

function preserveReplacementIndentation(actual: string, expected: string, replacement: string) {
  const actualLines = actual.split('\n')
  const expectedLines = expected.split('\n')
  const replacementLines = replacement.split('\n')
  if (actualLines.length !== expectedLines.length) return replacement
  // Recover a single consistent indentation shift, never arbitrary whitespace differences.
  const shifts = actualLines.map((line, index) => {
    const expectedLine = expectedLines[index]!
    if (line.trim() !== expectedLine.trim()) return null
    return { actual: line.match(/^[\t ]*/u)![0], expected: expectedLine.match(/^[\t ]*/u)![0] }
  })
  if (shifts.some((shift) => shift === null)) return replacement
  return replacementLines.map((line, index) => {
    if (line.trim().length === 0) return line
    const reference = shifts[Math.min(index, shifts.length - 1)]!
    const indentation = line.match(/^[\t ]*/u)![0]
    if (!indentation.startsWith(reference.expected)) return line
    return reference.actual + indentation.slice(reference.expected.length) + line.slice(indentation.length)
  }).join('\n')
}

interface StagedEdit {
  target: ApplyPatchTargetPath
  original: string
  content: string
  matches: number
}

/** All matching and staging takes place under the same per-path queue as patch/write. */
export async function applyStructuredEdits(
  changes: readonly StructuredReplacement[],
  resolveTarget: (path: string) => ApplyPatchTargetPath,
  beforeCommit: (absolutePath: string) => Promise<void>,
) {
  if (changes.length === 0) throw new Error('edit requires at least one change.')
  const targets = changes.map((change) => resolveTarget(change.path))
  return enqueueWorkspaceMutations(targets.map((target) => target.absolutePath), async () => {
    const staged = new Map<string, StagedEdit>()
    for (const [index, change] of changes.entries()) {
      const target = targets[index]
      if (typeof change.oldText !== 'string' || change.oldText.length === 0) {
        throw new Error(`Change ${index + 1}: oldText must be a non-empty string.`)
      }
      if (typeof change.newText !== 'string') {
        throw new Error(`Change ${index + 1}: newText must be a string.`)
      }
      const existing = staged.get(target.absolutePath)
      const bytes = existing ? null : await fs.readFile(target.absolutePath)
      const original = existing?.original ?? bytes!.toString('utf8')
      if (
        (bytes && !Buffer.from(original, 'utf8').equals(bytes))
        || Buffer.byteLength(original, 'utf8') > 16 * 1024 * 1024
        || original.includes('\0')
        || change.newText.includes('\0')
      ) {
        throw new Error(`Change ${index + 1} in ${target.relativePath}: edit requires valid UTF-8 text no larger than 16 MiB.`)
      }
      // Read returns LF-separated lines. Match the same normalized text as patch,
      // then restore the file's original line endings when committing.
      const current = existing?.content ?? normalizeContentLineEndings(original)
      const oldText = normalizeContentLineEndings(change.oldText)
      const newText = normalizeContentLineEndings(change.newText)
      if (change.line !== undefined && (!Number.isSafeInteger(change.line) || change.line < 1)) {
        throw new Error(`Change ${index + 1} in ${target.relativePath}: line must be a positive integer.`)
      }
      const { matches, tolerant } = resolveEditMatches(current, change, oldText)
      const count = matches.length
      if (count === 0) {
        if (existing && normalizeContentLineEndings(original).includes(oldText)) {
          throw new Error(`Change ${index + 1} in ${target.relativePath}: oldText was removed or modified by an earlier change in this batch. Make the replacements non-overlapping or match the updated text.`)
        }
        throw new Error(`Change ${index + 1} in ${target.relativePath}: oldText not found${change.line !== undefined || change.before !== undefined || change.after !== undefined ? ' at the specified line/context' : ''}. Reread the file and retry.`)
      }
      if (count > 1 && change.replace_all !== true) {
        const lines = matches.slice(0, 10).map((match) => candidateLine(current, match.startOffset)).join(', ')
        throw new Error(`Change ${index + 1} in ${target.relativePath}: ${count} matches (lines ${lines}${count > 10 ? ', ...' : ''}). Supply line, before/after context, more specific oldText, or set replace_all: true.`)
      }
      let updated = current
      for (const match of [...matches].reverse()) {
        const actual = current.slice(match.startOffset, match.endOffset)
        const replacement = tolerant ? preserveReplacementIndentation(actual, oldText, newText) : newText
        updated = updated.slice(0, match.startOffset) + replacement + updated.slice(match.endOffset)
      }
      if (Buffer.byteLength(updated, 'utf8') > 16 * 1024 * 1024) {
        throw new Error(`Change ${index + 1} in ${target.relativePath}: edited file exceeds 16 MiB.`)
      }
      staged.set(target.absolutePath, {
        target,
        original,
        content: updated,
        matches: (existing?.matches ?? 0) + (change.replace_all === true ? count : 1),
      })
    }
    const mutations = new Map<string, { target: ApplyPatchTargetPath; content: string | null }>()
    for (const entry of staged.values()) {
      if (entry.original === entry.content) continue
      mutations.set(entry.target.absolutePath, {
        target: entry.target,
        content: preserveExistingTextFormat(entry.content, entry.original),
      })
    }
    for (const absolutePath of mutations.keys()) await beforeCommit(absolutePath)
    await commitStagedFiles(mutations)
    return [...staged.values()].map((entry) => ({
      path: entry.target.relativePath,
      original: entry.original,
      content: entry.content,
      matches: entry.matches,
    }))
  })
}
