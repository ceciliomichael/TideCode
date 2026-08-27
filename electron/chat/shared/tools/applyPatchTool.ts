import { jsonSchema, tool } from 'ai'
import path from 'node:path'
import type { AgentToolExecutionResult } from '../toolTypes'
import { applyPatchInWorkspace } from '../applyPatchWorkspace'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import {
  aggregateFileChangeItems,
  buildFileChangeResult,
  captureCheckpointFileStateIfNeeded,
} from './workspaceToolResults'
import type { WorkspaceToolContext } from './workspaceTools'
import { resolveReadableTargetPath } from './workspaceToolPaths'
import { notifyWorkspaceExplorerChange } from '../../../workspace/explorerNotifications'

const APPLY_PATCH_DESCRIPTION = [
  'Apply a Codex patch as an array of complete patch lines: one array item per line, starting with *** Begin Patch and ending with *** End Patch. Every removed or added source line must be complete; never use a prefix or suffix as an anchor.',
  'Use a standard patch beginning with *** Begin Patch and ending with *** End Patch.',
  'Supported hunks are *** Add File, *** Update File, *** Move to, and *** Delete File.',
  'Update hunks use @@ context followed by lines prefixed with a space, -, or +.',
  'Put hunks for each file in source top-to-bottom order. The patch is verified completely before any file is changed; matching tolerates line-ending and indentation whitespace differences while preserving actual source context.',
  'Use the latest read content as context and include unchanged lines around each change. Do not use this for an unchanged patch.',
].join(' ')

const APPLY_PATCH_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    patch: {
      description: 'Array of complete patch lines. Use one item per line and do not include a markdown fence.',
      items: { type: 'string' },
      minItems: 1,
      type: 'array',
    },
  },
  required: ['patch'],
  type: 'object',
} as const

interface ApplyPatchInput {
  patch: string[]
}

type PatchFileChangeInput = Parameters<typeof aggregateFileChangeItems>[0][number]

function displayPath(workspaceRootPath: string, absolutePath: string) {
  const relativePath = path.relative(workspaceRootPath, absolutePath)
  if (relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath
  }
  return absolutePath
}

function getOuterPatchMarkerKind(line: string) {
  const compactMarker = line.trim().replace(/\*/g, '').replace(/\s+/g, '')
  if (compactMarker === 'BeginPatch') return 'begin'
  if (compactMarker === 'EndPatch') return 'end'
  return null
}

function normalizePatchInput(value: unknown) {
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((line) => typeof line === 'string')
  ) {
    const lines = [...value]

    let leadingMarkerCount = 0
    let hasCanonicalBegin = false
    while (leadingMarkerCount < lines.length && getOuterPatchMarkerKind(lines[leadingMarkerCount]) === 'begin') {
      hasCanonicalBegin ||= lines[leadingMarkerCount]?.trim() === '*** Begin Patch'
      leadingMarkerCount += 1
    }
    if (hasCanonicalBegin && leadingMarkerCount > 0) {
      lines.splice(0, leadingMarkerCount, '*** Begin Patch')
    }

    let trailingMarkerStart = lines.length
    let hasCanonicalEnd = false
    while (trailingMarkerStart > 0 && getOuterPatchMarkerKind(lines[trailingMarkerStart - 1]) === 'end') {
      hasCanonicalEnd ||= lines[trailingMarkerStart - 1]?.trim() === '*** End Patch'
      trailingMarkerStart -= 1
    }
    if (hasCanonicalEnd && trailingMarkerStart < lines.length) {
      lines.splice(trailingMarkerStart, lines.length - trailingMarkerStart, '*** End Patch')
    }

    return lines.join('\n')
  }

  return null
}

function createFileChanges(
  workspaceRootPath: string,
  changes: Awaited<ReturnType<typeof applyPatchInWorkspace>>['changes'],
) {
  const fileChangeInputs: PatchFileChangeInput[] = []

  for (const change of changes) {
    if (change.type === 'add') {
      fileChangeInputs.push({
        fileName: change.relativePath,
        kind: 'add',
        newContent: change.newContent,
        oldContent: null,
      })
      continue
    }

    if (change.type === 'delete') {
      fileChangeInputs.push({
        fileName: change.relativePath,
        kind: 'delete',
        newContent: '',
        oldContent: change.oldContent,
      })
      continue
    }

    if (change.nextAbsolutePath && change.nextAbsolutePath !== change.absolutePath) {
      fileChangeInputs.push(
        {
          fileName: displayPath(workspaceRootPath, change.absolutePath),
          kind: 'delete',
          newContent: '',
          oldContent: change.oldContent,
        },
        {
          fileName: change.relativePath,
          kind: 'add',
          newContent: change.newContent,
          oldContent: null,
        },
      )
      continue
    }

    fileChangeInputs.push({
      fileName: change.relativePath,
      kind: 'update',
      newContent: change.newContent,
      oldContent: change.oldContent,
    })
  }

  return aggregateFileChangeItems(fileChangeInputs)
}

function createPatchPresentationChanges(
  workspaceRootPath: string,
  result: Awaited<ReturnType<typeof applyPatchInWorkspace>>,
) {
  const presentationChanges: ReturnType<typeof aggregateFileChangeItems> = []

  for (let index = 0; index < result.changes.length; index += 1) {
    const change = result.changes[index]
    const hunk = result.parsedPatch.hunks[index]

    if (!hunk || hunk.type !== 'update' || hunk.movePath) {
      presentationChanges.push(...createFileChanges(workspaceRootPath, [change]))
      continue
    }

    for (const [chunkIndex, chunk] of hunk.chunks.entries()) {
      const oldContent = chunk.oldLines.join('\n')
      const newContent = chunk.newLines.join('\n')
      if (oldContent === newContent) {
        continue
      }

      const [chunkChange] = aggregateFileChangeItems([{
        fileName: change.relativePath,
        kind: 'update',
        newContent,
        oldContent,
      }])
      const startLineNumber = change.updateChunkStartLines?.[chunkIndex]
      if (startLineNumber !== undefined) {
        chunkChange.startLineNumber = startLineNumber
      }
      presentationChanges.push(chunkChange)
    }
  }

  return presentationChanges
}

export function createApplyPatchTool(context: WorkspaceToolContext) {
  return tool({
    description: APPLY_PATCH_DESCRIPTION,
    inputSchema: jsonSchema<ApplyPatchInput>(APPLY_PATCH_INPUT_SCHEMA),
    execute: async (rawInput): Promise<AgentToolExecutionResult> => {
      const input = rawInput as ApplyPatchInput
      const patchText = normalizePatchInput(input.patch)
      if (patchText === null) {
        return createToolErrorResult('patch requires a non-empty array of complete patch lines.')
      }

      try {
        const result = await applyPatchInWorkspace(context.workspaceRootPath, patchText, {
          resolveTargetPath: (candidatePath) => {
            const target = resolveReadableTargetPath(
              context.workspaceRootPath,
              candidatePath,
              context.terminalExecutionMode,
            )
            return {
              absolutePath: target.absolutePath,
              relativePath: target.displayPath,
            }
          },
          onBeforeChange: async ({ absolutePath, nextAbsolutePath }) => {
            await captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath)
            if (nextAbsolutePath) {
              await captureCheckpointFileStateIfNeeded(context.checkpointId, nextAbsolutePath)
            }
          },
        })

        notifyWorkspaceExplorerChange(context.workspaceRootPath)
        const fileChanges = createFileChanges(context.workspaceRootPath, result.changes)
        const patchResult = buildFileChangeResult(
          `Applied patch to ${fileChanges.length} file${fileChanges.length === 1 ? '' : 's'}`,
          fileChanges,
          'edit',
          fileChanges.length === 1 ? fileChanges[0].fileName : 'workspace',
          'Patch applied successfully.',
        )
        return {
          ...patchResult,
          resultPresentation: {
            changes: createPatchPresentationChanges(context.workspaceRootPath, result),
            kind: 'change_diff',
          },
        }
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Apply patch failed.'))
      }
    },
  })
}
