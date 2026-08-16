import type { Message } from '../../src/types/chat'
import { isSameTurnSteerMessage } from '../../src/lib/chatMessageMetadata'
import { getStoredUserMessageCheckpointHistory } from '../history/store'
import {
  createWorkspaceRedoCheckpointFromSources,
  restoreWorkspaceCheckpoint,
  restoreWorkspaceCheckpointSequence,
} from '../workspace/checkpoints'

export interface CliUndoCheckpointPlan {
  checkpointIds: string[]
  targetUserIndex: number
  targetUserMessageId: string
}

interface CliUndoCheckpointDependencies {
  getCheckpointHistory?: typeof getStoredUserMessageCheckpointHistory
}

interface CliUndoWorkspaceDependencies {
  createRedoCheckpoint?: typeof createWorkspaceRedoCheckpointFromSources
  restoreCheckpoint?: typeof restoreWorkspaceCheckpoint
  restoreCheckpointSequence?: typeof restoreWorkspaceCheckpointSequence
}

function isIndependentUserTurn(message: Message): boolean {
  return message.role === 'user' && !isSameTurnSteerMessage(message)
}

function resolveUndoTargetIndex(messages: readonly Message[], selectedMessageId: string): number {
  const selectedIndex = messages.findIndex(
    (message) => message.id === selectedMessageId && message.role === 'user',
  )
  if (selectedIndex < 0) {
    throw new Error(`Message not found: ${selectedMessageId}`)
  }

  if (!isSameTurnSteerMessage(messages[selectedIndex])) {
    return selectedIndex
  }

  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    if (isIndependentUserTurn(messages[index])) {
      return index
    }
  }

  throw new Error(`Same-turn steer message does not have a parent user turn: ${selectedMessageId}`)
}

async function resolveCheckpointId(
  conversationId: string,
  message: Message,
  getCheckpointHistory: typeof getStoredUserMessageCheckpointHistory,
): Promise<string> {
  const directCheckpointId = message.runCheckpoint?.id?.trim()
  if (directCheckpointId) {
    return directCheckpointId
  }

  const checkpointHistory = await getCheckpointHistory(conversationId, message.id)
  const historicalCheckpointId = checkpointHistory.at(-1)?.id?.trim() ?? checkpointHistory[0]?.id?.trim()
  if (historicalCheckpointId) {
    return historicalCheckpointId
  }

  throw new Error(`This message does not have a workspace checkpoint: ${message.id}`)
}

export async function resolveCliUndoCheckpointPlan(
  conversationId: string,
  messages: readonly Message[],
  selectedMessageId: string,
  dependencies: CliUndoCheckpointDependencies = {},
): Promise<CliUndoCheckpointPlan> {
  const getCheckpointHistory = dependencies.getCheckpointHistory ?? getStoredUserMessageCheckpointHistory
  const targetUserIndex = resolveUndoTargetIndex(messages, selectedMessageId)
  const targetUserMessage = messages[targetUserIndex]
  const checkpointIds: string[] = []

  for (let index = targetUserIndex; index < messages.length; index += 1) {
    const message = messages[index]
    if (!isIndependentUserTurn(message)) {
      continue
    }
    checkpointIds.push(await resolveCheckpointId(conversationId, message, getCheckpointHistory))
  }

  if (checkpointIds.length === 0) {
    throw new Error('This message and later user messages do not have a workspace checkpoint.')
  }

  return {
    checkpointIds,
    targetUserIndex,
    targetUserMessageId: targetUserMessage.id,
  }
}

export async function runWithCliUndoWorkspaceReverted<T>(
  plan: CliUndoCheckpointPlan,
  operation: () => Promise<T>,
  dependencies: CliUndoWorkspaceDependencies = {},
): Promise<T> {
  const createRedoCheckpoint = dependencies.createRedoCheckpoint ?? createWorkspaceRedoCheckpointFromSources
  const restoreCheckpoint = dependencies.restoreCheckpoint ?? restoreWorkspaceCheckpoint
  const restoreCheckpointSequence = dependencies.restoreCheckpointSequence ?? restoreWorkspaceCheckpointSequence
  const redoCheckpoint = await createRedoCheckpoint(plan.checkpointIds)
  let workspaceRevertStarted = false

  try {
    workspaceRevertStarted = true
    await restoreCheckpointSequence(plan.checkpointIds)
    return await operation()
  } catch (error) {
    if (workspaceRevertStarted) {
      try {
        await restoreCheckpoint(redoCheckpoint.id)
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'Could not apply /undo and could not restore the pre-undo workspace snapshot.',
        )
      }
    }
    throw error
  }
}
