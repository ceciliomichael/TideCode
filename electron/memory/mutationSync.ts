import type { WorkspaceToolContext } from '../chat/shared/tools/workspaceToolPaths'
import { captureCheckpointFileStateIfNeeded } from '../chat/shared/tools/workspaceToolResults'
import { classifyWorkspaceMemoryPath, refreshWorkspaceMemoryIndex } from './service'

export async function syncMemoryAfterMutation(
  context: Pick<WorkspaceToolContext, 'workspaceRootPath' | 'checkpointId'>,
  absolutePaths: readonly string[],
) {
  const memoryPaths = absolutePaths.filter((absolutePath) => (
    classifyWorkspaceMemoryPath(absolutePath, context.workspaceRootPath)?.kind === 'entry'
  ))
  if (memoryPaths.length === 0) {
    return
  }
  try {
    await refreshWorkspaceMemoryIndex(context.workspaceRootPath, (absolutePath) => (
      captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath)
    ), memoryPaths)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Memory detail changes were saved, but MEMORY.md could not be refreshed: ${detail}`)
  }
}
