import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const WORKSPACE_INSTRUCTIONS_REPO_PATH = 'AGENTS.md'

function resolveWorkspaceInstructionsPath(workspaceRootPath?: string) {
  const workspacePath = workspaceRootPath?.trim()
  if (!workspacePath) return null
  const candidatePath = path.join(workspacePath, WORKSPACE_INSTRUCTIONS_REPO_PATH)
  return existsSync(candidatePath) ? candidatePath : null
}

function readWorkspaceInstructionsContent(workspaceRootPath?: string) {
  const sourcePath = resolveWorkspaceInstructionsPath(workspaceRootPath)
  if (sourcePath) {
    try {
      return readFileSync(sourcePath, 'utf8')
    } catch (error) {
      console.error(`Failed to read workspace instructions from ${sourcePath}:`, error)
      return null
    }
  }

  return null
}

const cachedWorkspaceInstructionsBlocks = new Map<string, string | null>()

export function buildWorkspaceInstructionsBlock(workspaceRootPath?: string) {
  const cacheKey = workspaceRootPath?.trim() || ''
  if (cachedWorkspaceInstructionsBlocks.has(cacheKey)) {
    return cachedWorkspaceInstructionsBlocks.get(cacheKey) ?? null
  }

  const content = readWorkspaceInstructionsContent(workspaceRootPath)
  if (!content) {
    cachedWorkspaceInstructionsBlocks.set(cacheKey, null)
    return null
  }

  const block = [
    '<user_specific_instructions description="follow all user say because user is boss">',
    content,
    '</user_specific_instructions>',
  ].join('\n')

  cachedWorkspaceInstructionsBlocks.set(cacheKey, block)
  return block
}
