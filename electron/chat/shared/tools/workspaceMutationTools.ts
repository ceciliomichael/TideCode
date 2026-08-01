import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_WORKSPACE_RELATIVE_PATH } from '../../../workspace/paths'
import { applyPatchInWorkspace } from '../applyPatch'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { resolveReadableTargetPath } from './workspaceToolPaths'
import {
  aggregateAppliedPatchChanges,
  aggregateFileChangeItems,
  buildFileChangeResult,
  captureCheckpointFileStateIfNeeded,
  normalizeTextMutationContent,
} from './workspaceToolResults'

export async function createWholeFileWriteToolResult(
  context: WorkspaceToolContext,
  input: {
    content: string
    path: string
  },
) {
  const resolvedChange = {
    content: normalizeTextMutationContent(input.content),
    target: resolveReadableTargetPath(
      context.workspaceRootPath,
      input.path,
      context.terminalExecutionMode,
    ),
  }

  const previousContent = await fs.readFile(resolvedChange.target.absolutePath, 'utf8').catch(() => null)
  const rawFileChanges: Array<{ fileName: string; newContent: string; oldContent: string | null }> = []

  if (previousContent === null || normalizeTextMutationContent(previousContent) !== resolvedChange.content) {
    await captureCheckpointFileStateIfNeeded(context.checkpointId, resolvedChange.target.absolutePath)
    await fs.mkdir(path.dirname(resolvedChange.target.absolutePath), { recursive: true })
    await fs.writeFile(resolvedChange.target.absolutePath, resolvedChange.content, 'utf8')
    rawFileChanges.push({
      fileName: resolvedChange.target.displayPath,
      newContent: resolvedChange.content,
      oldContent: previousContent,
    })
  } else {
    throw new Error(`Write did not change ${resolvedChange.target.displayPath}`)
  }

  const fileChanges = aggregateFileChangeItems(rawFileChanges)

  const subjectPath = resolvedChange.target.displayPath
  return buildFileChangeResult(
    `Successfully wrote 1 file change`,
    fileChanges,
    'edit',
    subjectPath,
  )
}
export async function createApplyPatchToolResult(context: WorkspaceToolContext, patchText: string, basePath?: string) {
  const appliedPatch = await applyPatchInWorkspace(context.workspaceRootPath, patchText, {
    ...(basePath ? { basePath } : {}),
    onBeforeChange: async ({ absolutePath, nextAbsolutePath }) => {
      await captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath)
      if (nextAbsolutePath && nextAbsolutePath !== absolutePath) {
        await captureCheckpointFileStateIfNeeded(context.checkpointId, nextAbsolutePath)
      }
    },
    resolveTargetPath:
      context.terminalExecutionMode === 'full'
        ? (candidatePath) => {
            const target = resolveReadableTargetPath(context.workspaceRootPath, candidatePath, context.terminalExecutionMode)
            return {
              absolutePath: target.absolutePath,
              relativePath: target.displayPath,
            }
          }
        : undefined,
  })
  const changes = aggregateAppliedPatchChanges(appliedPatch.changes)
  const subjectPath = changes.length === 1 ? changes[0].fileName : DEFAULT_WORKSPACE_RELATIVE_PATH

  return buildFileChangeResult(
    `Patched ${changes.length} file${changes.length === 1 ? '' : 's'}`,
    changes,
    changes.length === 0 ? 'noop' : 'edit',
    subjectPath,
    changes.length === 0
      ? 'Patch parsed successfully, but no file content changed.'
      : 'Patch applied successfully. The files listed below were changed on disk.',
  )
}
