import { stat } from 'node:fs/promises'
import path from 'node:path'
import {
  buildWorkspaceInstructionsTransition,
} from '../../../src/lib/hiddenUserContext'
import type { Message } from '../../../src/types/chat'

export async function resolveWorkspaceInstructionsTransition(input: {
  messages: readonly Message[]
  workspaceRootPath: string
}) {
  const fileStats = await stat(path.join(input.workspaceRootPath, 'AGENTS.md')).catch(() => null)
  const revision = fileStats?.isFile()
    ? `${fileStats.mtimeMs}:${fileStats.size}`
    : null
  return buildWorkspaceInstructionsTransition({ messages: input.messages, revision })
}
