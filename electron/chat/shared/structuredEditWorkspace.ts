import { promises as fs } from 'node:fs'
import { enqueueWorkspaceMutations } from './tools/workspaceMutationQueue'
import { preserveExistingTextFormat } from './tools/workspaceMutationSafety'
import { commitStagedFiles } from './applyPatchWorkspace'
import type { ApplyPatchTargetPath } from './applyPatchTypes'

export interface StructuredReplacement {
  path: string
  oldText: string
  newText: string
  replace_all?: boolean
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
      const current = existing?.content ?? original
      const count = current.split(change.oldText).length - 1
      if (count === 0) {
        throw new Error(`Change ${index + 1} in ${target.relativePath}: oldText not found. Reread the file and retry.`)
      }
      if (count > 1 && change.replace_all !== true) {
        throw new Error(`Change ${index + 1} in ${target.relativePath}: ${count} matches. Supply more specific oldText or set replace_all: true.`)
      }
      const updated = change.replace_all === true
        ? current.split(change.oldText).join(change.newText)
        : current.replace(change.oldText, () => change.newText)
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
