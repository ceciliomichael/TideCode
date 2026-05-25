import { jsonSchema, tool, type ToolSet } from 'ai'
import { KANBAN_COLUMN_IDS, type KanbanColumnId } from '../../../../src/lib/kanban'
import type { AgentToolContext, AgentToolExecutionResult } from '../toolTypes'
import {
  createKanbanBoardCard,
  getKanbanBoardData,
  getKanbanCard,
  moveKanbanBoardCard,
  readKanbanBoardColumn,
  updateKanbanBoardCardContent,
} from '../../../kanban/store'
import { captureKanbanBoardSnapshotIfNeeded } from '../../../kanban/checkpoints'

const KANBAN_COLUMN_ENUM = [...KANBAN_COLUMN_IDS]

function createKanbanToolErrorResult(error: unknown, fallbackSummary: string): AgentToolExecutionResult {
  return {
    status: 'error',
    summary: error instanceof Error && error.message.trim().length > 0 ? error.message : fallbackSummary,
  }
}

function createKanbanToolSuccessResult(summary: string, bodyValue: unknown): AgentToolExecutionResult {
  return {
    body: JSON.stringify(bodyValue, null, 2),
    semantics: {
      kind: 'kanban',
    },
    status: 'success',
    summary,
  }
}

export function createKanbanToolSet(context: Pick<AgentToolContext, 'checkpointId' | 'workspaceRootPath'>): ToolSet {
  async function captureKanbanSnapshotBeforeMutation() {
    const checkpointId = context.checkpointId?.trim()
    if (!checkpointId) {
      return
    }

    const boardData = await getKanbanBoardData({ workspacePath: context.workspaceRootPath })
    await captureKanbanBoardSnapshotIfNeeded({
      boardData,
      checkpointId,
      workspacePath: context.workspaceRootPath,
    })
  }

  async function runKanbanMutation<T>(mutation: () => Promise<T>) {
    await captureKanbanSnapshotBeforeMutation()
    return mutation()
  }

  return {
    read_board: tool({
      description: 'Read the cards within a specific Kanban column for the current workspace.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          columnId: {
            enum: KANBAN_COLUMN_ENUM,
            type: 'string',
          },
          cursor: {
            type: 'string',
          },
          includeCounts: {
            type: 'boolean',
          },
          limit: {
            maximum: 50,
            minimum: 1,
            type: 'number',
          },
        },
        required: ['columnId'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as {
          columnId: KanbanColumnId
          cursor?: string
          includeCounts?: boolean
          limit?: number
        }

        try {
          const result = await readKanbanBoardColumn({
            columnId: inputValue.columnId,
            cursor: inputValue.cursor,
            includeCounts: inputValue.includeCounts,
            limit: inputValue.limit,
            workspacePath: context.workspaceRootPath,
          })

          return createKanbanToolSuccessResult(
            `Read ${result.cards.length} ${result.column.title} task${result.cards.length === 1 ? '' : 's'}.`,
            result,
          )
        } catch (error) {
          return createKanbanToolErrorResult(error, 'Unable to read kanban board column.')
        }
      },
    }),
    read_card: tool({
      description: 'Read the details of a specific Kanban card by its ID.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          cardId: {
            minLength: 1,
            type: 'string',
          },
        },
        required: ['cardId'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as { cardId: string }

        try {
          const card = await getKanbanCard({
            cardId: inputValue.cardId,
            workspacePath: context.workspaceRootPath,
          })

          return createKanbanToolSuccessResult(card ? `Read task: ${card.card.title}` : 'Task not found.', { card })
        } catch (error) {
          return createKanbanToolErrorResult(error, 'Unable to read kanban card.')
        }
      },
    }),
    create_card: tool({
      description: 'Create a new Kanban card in the workspace.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          columnId: {
            enum: KANBAN_COLUMN_ENUM,
            type: 'string',
          },
          description: {
            type: 'string',
          },
          parentCardId: {
            type: 'string',
          },
          sourceMessageId: {
            type: 'string',
          },
          title: {
            minLength: 1,
            type: 'string',
          },
        },
        required: ['title'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as {
          columnId?: KanbanColumnId
          description?: string
          parentCardId?: string
          sourceMessageId?: string
          title: string
        }

        try {
          const card = await runKanbanMutation(() =>
            createKanbanBoardCard({
              columnId: inputValue.columnId,
              description: inputValue.description,
              parentCardId: inputValue.parentCardId,
              sourceMessageId: inputValue.sourceMessageId,
              title: inputValue.title,
              workspacePath: context.workspaceRootPath,
            }),
          )

          return createKanbanToolSuccessResult(`Created task in ${card.columnId}: ${card.title}`, { card })
        } catch (error) {
          return createKanbanToolErrorResult(error, 'Unable to create kanban card.')
        }
      },
    }),
    update_card: tool({
      description: 'Update the title, description, or parent card relationship of a Kanban card.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          cardId: {
            minLength: 1,
            type: 'string',
          },
          description: {
            type: 'string',
          },
          parentCardId: {
            type: 'string',
          },
          title: {
            type: 'string',
          },
        },
        required: ['cardId'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as { cardId: string; description?: string; parentCardId?: string; title?: string }

        try {
          const card = await runKanbanMutation(() =>
            updateKanbanBoardCardContent({
              cardId: inputValue.cardId,
              description: inputValue.description,
              parentCardId: inputValue.parentCardId,
              title: inputValue.title,
              workspacePath: context.workspaceRootPath,
            }),
          )

          return createKanbanToolSuccessResult(`Updated task: ${card.title}`, { card })
        } catch (error) {
          return createKanbanToolErrorResult(error, 'Unable to update kanban card.')
        }
      },
    }),
    move_card: tool({
      description: 'Move a Kanban card to a different workflow column (backlog, in-progress, blocked, or done).',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          cardId: {
            minLength: 1,
            type: 'string',
          },
          targetColumnId: {
            enum: KANBAN_COLUMN_ENUM,
            type: 'string',
          },
        },
        required: ['cardId', 'targetColumnId'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as { cardId: string; targetColumnId: KanbanColumnId }

        try {
          const card = await runKanbanMutation(() =>
            moveKanbanBoardCard({
              cardId: inputValue.cardId,
              targetColumnId: inputValue.targetColumnId,
              workspacePath: context.workspaceRootPath,
            }),
          )

          return createKanbanToolSuccessResult(`Moved task to ${card.columnId}: ${card.title}`, { card })
        } catch (error) {
          return createKanbanToolErrorResult(error, 'Unable to move kanban card.')
        }
      },
    }),
  }
}
