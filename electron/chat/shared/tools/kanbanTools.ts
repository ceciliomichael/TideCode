import { jsonSchema, tool, type ToolSet } from 'ai'
import {
  KANBAN_COLUMN_IDS,
  KANBAN_ISSUE_TYPE_IDS,
  KANBAN_PRIORITY_IDS,
  type KanbanColumnId,
  type KanbanIssueType,
  type KanbanPriority,
} from '../../../../src/lib/kanban'
import type { AgentToolContext, AgentToolExecutionResult } from '../toolTypes'
import {
  createKanbanBoardCard,
  createKanbanBoardTask,
  deleteKanbanBoardCard,
  getKanbanBoardData,
  getKanbanCard,
  moveKanbanBoardCard,
  readKanbanBoardColumn,
  reorderKanbanBoardCard,
  updateKanbanBoardCardContent,
} from '../../../kanban/store'
import { captureKanbanBoardSnapshotIfNeeded } from '../../../kanban/checkpoints'

const KANBAN_COLUMN_ENUM = [...KANBAN_COLUMN_IDS]
const KANBAN_ISSUE_TYPE_ENUM = [...KANBAN_ISSUE_TYPE_IDS]
const KANBAN_PRIORITY_ENUM = [...KANBAN_PRIORITY_IDS]

function createKanbanToolErrorResult(
  error: unknown,
  fallbackSummary: string,
): AgentToolExecutionResult {
  return {
    status: 'error',
    summary:
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : fallbackSummary,
  }
}

function createKanbanToolSuccessResult(
  summary: string,
  bodyValue: unknown,
): AgentToolExecutionResult {
  return {
    body: JSON.stringify(bodyValue, null, 2),
    semantics: {
      kind: 'kanban',
    },
    status: 'success',
    summary,
  }
}

export function createKanbanToolSet(
  context: Pick<AgentToolContext, 'checkpointId' | 'workspaceRootPath'>,
  options: { readOnly?: boolean } = {},
): ToolSet {
  async function captureKanbanSnapshotBeforeMutation() {
    const checkpointId = context.checkpointId?.trim()
    if (!checkpointId) {
      return
    }

    const boardData = await getKanbanBoardData({
      workspacePath: context.workspaceRootPath,
    })
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

  const tools: ToolSet = {
    read_board: tool({
      description:
        'Read the cards within a specific Kanban column for the current workspace.',
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
          return createKanbanToolErrorResult(
            error,
            'Unable to read kanban board column.',
          )
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

          return createKanbanToolSuccessResult(
            card ? `Read task: ${card.card.title}` : 'Task not found.',
            { card },
          )
        } catch (error) {
          return createKanbanToolErrorResult(
            error,
            'Unable to read kanban card.',
          )
        }
      },
    }),
    create_card: tool({
      description: 'Create a new Kanban card in the workspace.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          acceptanceCriteria: {
            items: {
              additionalProperties: false,
              properties: {
                completed: { type: 'boolean' },
                text: { minLength: 1, type: 'string' },
              },
              required: ['text'],
              type: 'object',
            },
            maxItems: 30,
            type: 'array',
          },
          assignee: {
            minLength: 1,
            type: 'string',
          },
          columnId: {
            enum: KANBAN_COLUMN_ENUM,
            type: 'string',
          },
          description: {
            type: 'string',
          },
          issueType: {
            enum: KANBAN_ISSUE_TYPE_ENUM,
            type: 'string',
          },
          labels: {
            items: { type: 'string' },
            maxItems: 12,
            type: 'array',
          },
          parentCardId: {
            type: 'string',
          },
          sourceMessageId: {
            type: 'string',
          },
          priority: {
            enum: KANBAN_PRIORITY_ENUM,
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
          acceptanceCriteria?: Array<{
            completed?: boolean
            text: string
          }>
          assignee?: string
          columnId?: KanbanColumnId
          description?: string
          issueType?: KanbanIssueType
          labels?: string[]
          parentCardId?: string
          sourceMessageId?: string
          priority?: KanbanPriority
          title: string
        }

        try {
          const card = await runKanbanMutation(() =>
            createKanbanBoardCard({
              acceptanceCriteria: inputValue.acceptanceCriteria,
              assignee: inputValue.assignee,
              columnId: inputValue.columnId,
              description: inputValue.description,
              issueType: inputValue.issueType,
              labels: inputValue.labels,
              parentCardId: inputValue.parentCardId,
              sourceMessageId: inputValue.sourceMessageId,
              priority: inputValue.priority,
              title: inputValue.title,
              workspacePath: context.workspaceRootPath,
            }),
          )

          return createKanbanToolSuccessResult(
            `Created task in ${card.columnId}: ${card.title}`,
            { card },
          )
        } catch (error) {
          return createKanbanToolErrorResult(
            error,
            'Unable to create kanban card.',
          )
        }
      },
    }),
    create_task_with_subtasks: tool({
      description:
        'Create one parent task and an ordered set of subtasks atomically. Use this when planning multi-step work.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          acceptanceCriteria: {
            items: {
              additionalProperties: false,
              properties: {
                text: { minLength: 1, type: 'string' },
              },
              required: ['text'],
              type: 'object',
            },
            maxItems: 30,
            type: 'array',
          },
          assignee: {
            minLength: 1,
            type: 'string',
          },
          columnId: {
            enum: KANBAN_COLUMN_ENUM,
            type: 'string',
          },
          description: {
            type: 'string',
          },
          issueType: {
            enum: KANBAN_ISSUE_TYPE_ENUM,
            type: 'string',
          },
          labels: {
            items: { type: 'string' },
            maxItems: 12,
            type: 'array',
          },
          priority: {
            enum: KANBAN_PRIORITY_ENUM,
            type: 'string',
          },
          subtasks: {
            items: {
              additionalProperties: false,
              properties: {
                acceptanceCriteria: {
                  items: {
                    additionalProperties: false,
                    properties: {
                      completed: { type: 'boolean' },
                      text: { minLength: 1, type: 'string' },
                    },
                    required: ['text'],
                    type: 'object',
                  },
                  maxItems: 30,
                  type: 'array',
                },
                assignee: {
                  minLength: 1,
                  type: 'string',
                },
                description: { type: 'string' },
                issueType: {
                  enum: KANBAN_ISSUE_TYPE_ENUM,
                  type: 'string',
                },
                labels: {
                  items: { type: 'string' },
                  maxItems: 12,
                  type: 'array',
                },
                priority: {
                  enum: KANBAN_PRIORITY_ENUM,
                  type: 'string',
                },
                title: { minLength: 1, type: 'string' },
              },
              required: ['title'],
              type: 'object',
            },
            maxItems: 30,
            type: 'array',
          },
          title: {
            minLength: 1,
            type: 'string',
          },
        },
        required: ['title', 'subtasks'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as {
          acceptanceCriteria?: Array<{ text: string }>
          assignee?: string
          columnId?: KanbanColumnId
          description?: string
          issueType?: KanbanIssueType
          labels?: string[]
          priority?: KanbanPriority
          subtasks: Array<{
            acceptanceCriteria?: Array<{
              completed?: boolean
              text: string
            }>
            assignee?: string
            description?: string
            issueType?: KanbanIssueType
            labels?: string[]
            priority?: KanbanPriority
            title: string
          }>
          title: string
        }

        try {
          const result = await runKanbanMutation(() =>
            createKanbanBoardTask({
              ...inputValue,
              workspacePath: context.workspaceRootPath,
            }),
          )
          return createKanbanToolSuccessResult(
            `Created task with ${result.subtasks.length} subtask${result.subtasks.length === 1 ? '' : 's'}: ${result.parent.title}`,
            result,
          )
        } catch (error) {
          return createKanbanToolErrorResult(
            error,
            'Unable to create task and subtasks.',
          )
        }
      },
    }),
    update_card: tool({
      description: 'Update the fields or parent relationship of a Kanban card.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          acceptanceCriteria: {
            items: {
              additionalProperties: false,
              properties: {
                completed: { type: 'boolean' },
                id: { type: 'string' },
                text: { minLength: 1, type: 'string' },
              },
              required: ['text'],
              type: 'object',
            },
            maxItems: 30,
            type: 'array',
          },
          assignee: {
            type: ['string', 'null'],
          },
          cardId: {
            minLength: 1,
            type: 'string',
          },
          description: {
            type: 'string',
          },
          issueType: {
            enum: KANBAN_ISSUE_TYPE_ENUM,
            type: 'string',
          },
          labels: {
            items: { type: 'string' },
            maxItems: 12,
            type: 'array',
          },
          parentCardId: {
            type: 'string',
          },
          priority: {
            enum: KANBAN_PRIORITY_ENUM,
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
        const inputValue = rawInput as {
          acceptanceCriteria?: Array<{
            completed?: boolean
            id?: string
            text: string
          }>
          assignee?: string | null
          cardId: string
          description?: string
          issueType?: KanbanIssueType
          labels?: string[]
          parentCardId?: string
          priority?: KanbanPriority
          title?: string
        }

        try {
          const card = await runKanbanMutation(() =>
            updateKanbanBoardCardContent({
              acceptanceCriteria: inputValue.acceptanceCriteria,
              assignee: inputValue.assignee,
              cardId: inputValue.cardId,
              description: inputValue.description,
              issueType: inputValue.issueType,
              labels: inputValue.labels,
              parentCardId: inputValue.parentCardId,
              priority: inputValue.priority,
              title: inputValue.title,
              workspacePath: context.workspaceRootPath,
            }),
          )

          return createKanbanToolSuccessResult(`Updated task: ${card.title}`, {
            card,
          })
        } catch (error) {
          return createKanbanToolErrorResult(
            error,
            'Unable to update kanban card.',
          )
        }
      },
    }),
    move_card: tool({
      description:
        'Move a Kanban card to a different workflow column (backlog, in-progress, blocked, or done).',
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
        const inputValue = rawInput as {
          cardId: string
          targetColumnId: KanbanColumnId
        }

        try {
          const card = await runKanbanMutation(() =>
            moveKanbanBoardCard({
              cardId: inputValue.cardId,
              targetColumnId: inputValue.targetColumnId,
              workspacePath: context.workspaceRootPath,
            }),
          )

          return createKanbanToolSuccessResult(
            `Moved task to ${card.columnId}: ${card.title}`,
            { card },
          )
        } catch (error) {
          return createKanbanToolErrorResult(
            error,
            'Unable to move kanban card.',
          )
        }
      },
    }),
    reorder_card: tool({
      description:
        'Move a Kanban card to an exact zero-based position in a workflow column.',
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
          targetIndex: {
            minimum: 0,
            type: 'integer',
          },
        },
        required: ['cardId', 'targetColumnId', 'targetIndex'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as {
          cardId: string
          targetColumnId: KanbanColumnId
          targetIndex: number
        }

        try {
          const card = await runKanbanMutation(() =>
            reorderKanbanBoardCard({
              cardId: inputValue.cardId,
              targetColumnId: inputValue.targetColumnId,
              targetIndex: inputValue.targetIndex,
              workspacePath: context.workspaceRootPath,
            }),
          )

          return createKanbanToolSuccessResult(
            `Reordered task in ${card.columnId}: ${card.title}`,
            { card },
          )
        } catch (error) {
          return createKanbanToolErrorResult(
            error,
            'Unable to reorder kanban card.',
          )
        }
      },
    }),
    delete_card: tool({
      description:
        'Delete a Kanban task. Deleting a parent requires deleteSubtasks=true.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          cardId: {
            minLength: 1,
            type: 'string',
          },
          deleteSubtasks: {
            type: 'boolean',
          },
        },
        required: ['cardId'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as {
          cardId: string
          deleteSubtasks?: boolean
        }
        try {
          const boardData = await runKanbanMutation(() =>
            deleteKanbanBoardCard({
              cardId: inputValue.cardId,
              deleteSubtasks: inputValue.deleteSubtasks,
              workspacePath: context.workspaceRootPath,
            }),
          )
          return createKanbanToolSuccessResult('Deleted task.', { boardData })
        } catch (error) {
          return createKanbanToolErrorResult(
            error,
            'Unable to delete kanban task.',
          )
        }
      },
    }),
  }

  if (!options.readOnly) {
    return tools
  }

  return {
    read_board: tools.read_board,
    read_card: tools.read_card,
  }
}
