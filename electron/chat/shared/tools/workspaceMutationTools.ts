import { promises as fs } from 'node:fs'
import { notifyWorkspaceExplorerChange } from '../../../workspace/explorerNotifications'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { resolveReadableTargetPath } from './workspaceToolPaths'
import { WorkspaceMutationError } from './workspaceMutationErrors'
import { enqueueWorkspaceMutation } from './workspaceMutationQueue'
import {
  computeContentRevision,
  preserveExistingTextFormat,
  writeTextFileAtomically,
} from './workspaceMutationSafety'
import {
  aggregateFileChangeItems,
  buildFileChangeResult,
  captureCheckpointFileStateIfNeeded,
  createSuccessResult,
  normalizeTextMutationContent,
} from './workspaceToolResults'

export async function createWholeFileWriteToolResult(
  context: WorkspaceToolContext,
  input: {
    content: string
    expectedRevision?: string
    path: string
  },
) {
  const target = resolveReadableTargetPath(
    context.workspaceRootPath,
    input.path,
    context.terminalExecutionMode,
  )

  return enqueueWorkspaceMutation(target.absolutePath, () =>
    createWholeFileWriteToolResultInternal(context, input, target),
  )
}

async function createWholeFileWriteToolResultInternal(
  context: WorkspaceToolContext,
  input: { content: string; expectedRevision?: string; path: string },
  target: ReturnType<typeof resolveReadableTargetPath>,
) {
  let previousBytes: Buffer | null = null
  try {
    previousBytes = await fs.readFile(target.absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  if (input.expectedRevision !== undefined) {
    if (previousBytes === null || computeContentRevision(previousBytes) !== input.expectedRevision) {
      throw new WorkspaceMutationError(
        'REVISION_CONFLICT',
        'REVISION_CHECK',
        `Revision conflict for "${target.displayPath}". The file changed or no longer exists since the latest read. Reread it and retry the write.`,
      )
    }
  }

  const previousContent = previousBytes?.toString('utf8') ?? null
  const previousNormalized = previousContent === null ? null : normalizeTextMutationContent(previousContent)
  const newNormalized = normalizeTextMutationContent(input.content)

  if (previousNormalized === newNormalized) {
    return createSuccessResult({
      body: `No changes were made to "${target.displayPath}" because the complete file content is unchanged.`,
      semantics: {
        changed_paths: [],
        operation: 'noop',
        reason: 'write_content_unchanged',
        updated_path_count: 0,
      },
      subject: { kind: 'file', path: target.displayPath },
      summary: `Skipped unchanged write for ${target.displayPath}`,
    })
  }

  const serializedContent = previousContent === null
    ? input.content
    : preserveExistingTextFormat(newNormalized, previousContent)

  await captureCheckpointFileStateIfNeeded(context.checkpointId, target.absolutePath)
  try {
    await writeTextFileAtomically(target.absolutePath, serializedContent)
  } catch (error) {
    const stage = error instanceof Error && error.message.includes('Post-write verification failed')
      ? 'POST_WRITE_VERIFY'
      : 'FILESYSTEM_WRITE'
    const detail = error instanceof Error ? error.message : String(error)
    throw new WorkspaceMutationError(
      'WRITE_FAILED',
      stage,
      `Write failed while persisting "${target.displayPath}": ${detail}`,
    )
  }
  notifyWorkspaceExplorerChange(context.workspaceRootPath)

  const fileChanges = aggregateFileChangeItems([{
    fileName: target.displayPath,
    newContent: newNormalized,
    oldContent: previousNormalized,
  }])

  return buildFileChangeResult(
    previousContent === null ? 'Created 1 file' : 'Wrote 1 file',
    fileChanges,
    'write',
    target.displayPath,
  )
}
