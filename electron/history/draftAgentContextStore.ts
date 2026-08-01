import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resetDirectoryContents } from './directoryContents'
import { getConversationAgentContextPath, getDraftAgentContextPath } from './paths'

let pendingDraftContextOperation: Promise<void> = Promise.resolve()

function runDraftContextOperation<T>(operation: () => Promise<T>) {
  const result = pendingDraftContextOperation.then(operation, operation)
  pendingDraftContextOperation = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export function ensureDraftAgentContextDirectory() {
  return runDraftContextOperation(async () => {
    const draftPath = getDraftAgentContextPath()
    await fs.mkdir(draftPath, { recursive: true })
    return draftPath
  })
}

export function cleanupDraftAgentContextDirectory() {
  return runDraftContextOperation(async () => {
    const draftPath = getDraftAgentContextPath()

    try {
      await resetDirectoryContents(draftPath)
    } catch (error) {
      console.warn('Failed to cleanup draft virtual agent context directory', error)
    }
  })
}

export function adoptDraftAgentContextDirectory(targetConversationId: string) {
  return runDraftContextOperation(async () => {
    const draftPath = getDraftAgentContextPath()
    const targetPath = getConversationAgentContextPath(targetConversationId)

    try {
      await Promise.all([
        fs.mkdir(draftPath, { recursive: true }),
        fs.mkdir(targetPath, { recursive: true }),
      ])
      const entries = await fs.readdir(draftPath, { withFileTypes: true })
      for (const entry of entries) {
        await fs.cp(path.join(draftPath, entry.name), path.join(targetPath, entry.name), {
          recursive: true,
        })
      }
      await resetDirectoryContents(draftPath)
    } catch (error) {
      console.warn(`Failed to adopt draft virtual agent context for conversation ${targetConversationId}`, error)
    }

    return targetPath
  })
}
