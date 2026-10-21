import { syncMemoryAfterMutation } from '../../../memory/mutationSync'
import { jsonSchema, tool } from 'ai'
import path from 'node:path'
import { applyStructuredEdits, type StructuredReplacement } from '../structuredEditWorkspace'
import { resolveMutableTargetPath } from './workspaceToolPaths'
import type { WorkspaceToolContext } from './workspaceTools'
import type { PlanRuntimeState } from './planRuntimeState'
import { isPlanRelativePath, normalizePlanRelativePath, getPlanIdFromRelativePath } from '../../../../src/lib/planContracts'
import { createPlanToolResult } from './planToolResult'
import { extractPlanTitle } from '../../../../src/lib/planContracts'
import { captureCheckpointFileStateIfNeeded, aggregateFileChangeItems, buildFileChangeResult } from './workspaceToolResults'
import { notifyWorkspaceExplorerChange } from '../../../workspace/explorerNotifications'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createEditTool(context: WorkspaceToolContext, runtimeState?: PlanRuntimeState) {
  return tool({
    description: 'Precise text replacement, matching exact text first and recovering a unique indentation-only mismatch. Use optional line (1-based start line), before, and after to disambiguate duplicates. Ambiguous matches reject without writing; replace_all intentionally replaces every candidate. Sequential changes may target earlier replacements. For complex contextual hunks use tools.patch.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['changes'],
      properties: {
        changes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'oldText', 'newText'],
            properties: {
              path: { type: 'string', minLength: 1 },
              oldText: { type: 'string', minLength: 1 },
              newText: { type: 'string' },
              replace_all: { type: 'boolean' },
              line: { type: 'integer', minimum: 1 },
              before: { type: 'string' },
              after: { type: 'string' },
            },
          },
        },
      },
    }),
    execute: async (rawInput) => {
      try {
        const input = rawInput as { changes?: StructuredReplacement[] }
        if (!Array.isArray(input.changes) || input.changes.length === 0) {
          throw new Error('edit requires a non-empty changes array.')
        }
        const activePlan = runtimeState?.planMode ? runtimeState.activePlanPath : null
        if (runtimeState?.planMode && (!activePlan || !isPlanRelativePath(activePlan))) {
          throw new Error('Plan Mode edit requires an active plan.')
        }
        const planPath = activePlan ? normalizePlanRelativePath(activePlan) : null
        const targetPlan = planPath ? resolveMutableTargetPath(context.workspaceRootPath, planPath, context.terminalExecutionMode) : null
        const changed = await applyStructuredEdits(
          input.changes,
          (candidate) => {
            const target = resolveMutableTargetPath(context.workspaceRootPath, candidate, context.terminalExecutionMode)
            if (targetPlan && path.resolve(target.absolutePath) !== path.resolve(targetPlan.absolutePath)) {
              throw new Error('Plan Mode edit may only modify the active plan.')
            }
            return { absolutePath: target.absolutePath, relativePath: target.displayPath }
          },
          (absolutePath) => captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath),
        )
        const affected = changed.filter((entry) => entry.content !== entry.original)
        const affectedPaths = affected.map((entry) => (
          resolveMutableTargetPath(context.workspaceRootPath, entry.path, context.terminalExecutionMode).absolutePath
        ))
        await syncMemoryAfterMutation(context, affectedPaths)
        if (affected.length) notifyWorkspaceExplorerChange(context.workspaceRootPath)
        if (targetPlan && planPath) {
          const planId = getPlanIdFromRelativePath(planPath)
          const entry = changed.at(-1)
          if (!planId || !entry) throw new Error('Invalid active plan.')
          return createPlanToolResult({
            content: entry.content,
            fileName: path.posix.basename(planPath),
            operation: 'updated',
            planId,
            relativePath: planPath,
            title: extractPlanTitle(entry.content),
            updatedAt: Date.now(),
          })
        }
        const fileChanges = aggregateFileChangeItems(affected.map((entry) => ({
          fileName: entry.path,
          kind: 'update' as const,
          oldContent: entry.original,
          newContent: entry.content,
        })))
        const count = changed.reduce((sum, entry) => sum + entry.matches, 0)
        const result = buildFileChangeResult(
          `Edited ${fileChanges.length} file(s), ${count} replacement(s)`,
          fileChanges,
          'edit',
          fileChanges.length === 1 ? fileChanges[0].fileName : 'workspace',
        )
        return { ...result, resultPresentation: { kind: 'change_diff' as const, changes: fileChanges } }
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Edit failed.'))
      }
    },
  })
}
