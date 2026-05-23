import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const WORKSPACE_INSTRUCTIONS_REPO_PATH = 'AGENTS.md'

function resolveWorkspaceInstructionsPath(workspaceRootPath?: string) {
  const appRoot = process.env.APP_ROOT?.trim()
  const searchRoots = [workspaceRootPath, appRoot, process.cwd()].filter((value): value is string => Boolean(value))

  for (const root of searchRoots) {
    const candidatePath = path.join(root, WORKSPACE_INSTRUCTIONS_REPO_PATH)
    if (existsSync(candidatePath)) {
      return candidatePath
    }
  }

  return null
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
    '<user_specific_instructions>',
    content,
    '</user_specific_instructions>',
  ].join('\n')

  cachedWorkspaceInstructionsBlocks.set(cacheKey, block)
  return block
}
