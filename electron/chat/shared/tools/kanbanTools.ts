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

const COL_ENUM = [...KANBAN_COLUMN_IDS]
const TYPE_ENUM = [...KANBAN_ISSUE_TYPE_IDS]
const PRI_ENUM = [...KANBAN_PRIORITY_IDS]

function err(error: unknown, fallback: string): AgentToolExecutionResult {
  return {
    status: 'error',
    summary: error instanceof Error && error.message.trim() ? error.message : fallback,
  }
}

function ok(summary: string, body: unknown): AgentToolExecutionResult {
  return {
    body: JSON.stringify(body, null, 2),
    semantics: { kind: 'kanban' },
    status: 'success',
    summary,
  }
}

// ---------------------------------------------------------------------------
// Flat, clear schema: uses readable standard names so LLMs call it perfectly,
// while staying flat (no oneOf repetition) to keep token footprint ultra-low (~450 tokens).
// ---------------------------------------------------------------------------
const FLAT_KANBAN_SCHEMA = {
  type: 'object',
  description:
    'Kanban board. action: read_board | read_card | create_card | create_task_with_subtasks | update_card | move_card | reorder_card | delete_card. NOTE: Moving to done requires all acceptance criteria to have completed: true. Never call update_card and move_card in parallel on the same card. To update criteria and move to done in one step, call update_card with acceptanceCriteria (setting completed: true) and targetColumnId: "done".',
  properties: {
    action: { type: 'string' },

    // Card identifiers & target locations
    cardId: { type: 'string' },
    columnId: { enum: COL_ENUM, type: 'string', description: 'Column ID for read_board, or target column for move_card (backlog, in-progress, blocked, done).' },
    targetColumnId: { enum: COL_ENUM, type: 'string', description: 'Destination column ID for move_card or reorder_card (backlog, in-progress, blocked, done).' },
    targetIndex: { type: 'integer' },
    deleteSubtasks: { type: 'boolean' },

    // Content fields
    title: { type: 'string' },
    description: { type: 'string' },
    issueType: { enum: TYPE_ENUM, type: 'string' },
    priority: { enum: PRI_ENUM, type: 'string' },
    assignee: { type: 'string' },
    labels: { type: 'array', items: { type: 'string' } },
    parentCardId: { type: 'string' },
    sourceMessageId: { type: 'string' },

    // Acceptance criteria
    acceptanceCriteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          completed: { type: 'boolean' },
          id: { type: 'string' },
        },
        required: ['text'],
      },
    },

    // read_board options
    cursor: { type: 'string' },
    limit: { type: 'number' },
    includeCounts: { type: 'boolean' },

    // Subtasks for create_task_with_subtasks
    subtasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          issueType: { enum: TYPE_ENUM, type: 'string' },
          priority: { enum: PRI_ENUM, type: 'string' },
          description: { type: 'string' },
          assignee: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          acceptanceCriteria: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                completed: { type: 'boolean' },
              },
              required: ['text'],
            },
          },
        },
        required: ['title'],
      },
    },
  },
  required: ['action'],
}

const FLAT_KANBAN_SCHEMA_READ_ONLY = {
  ...FLAT_KANBAN_SCHEMA,
  description: 'Kanban board. action: read_board | read_card',
}

interface KanbanBoardInput {
  action: string
  cardId?: string
  columnId?: KanbanColumnId
  targetColumnId?: KanbanColumnId
  targetIndex?: number
  deleteSubtasks?: boolean
  title?: string
  description?: string
  issueType?: KanbanIssueType
  priority?: KanbanPriority
  assignee?: string | null
  labels?: string[]
  parentCardId?: string
  sourceMessageId?: string
  acceptanceCriteria?: Array<{ text: string; completed?: boolean; id?: string }>
  cursor?: string
  limit?: number
  includeCounts?: boolean
  subtasks?: Array<{
    title: string
    issueType?: KanbanIssueType
    priority?: KanbanPriority
    description?: string
    assignee?: string
    labels?: string[]
    acceptanceCriteria?: Array<{ text: string; completed?: boolean }>
  }>
}

export function createKanbanToolSet(
  context: Pick<AgentToolContext, 'checkpointId' | 'workspaceRootPath'>,
  options: { readOnly?: boolean } = {},
): ToolSet {
  async function snapshot() {
    const checkpointId = context.checkpointId?.trim()
    if (!checkpointId) return
    const boardData = await getKanbanBoardData({ workspacePath: context.workspaceRootPath })
    await captureKanbanBoardSnapshotIfNeeded({
      boardData,
      checkpointId,
      workspacePath: context.workspaceRootPath,
    })
  }

  async function mutate<T>(fn: () => Promise<T>) {
    await snapshot()
    return fn()
  }

  const schema = options.readOnly ? FLAT_KANBAN_SCHEMA_READ_ONLY : FLAT_KANBAN_SCHEMA

  return {
    kanban_board: tool({
      description:
        'Interact with the workspace Kanban board. Set `action` to one of: read_board, read_card, create_card, create_task_with_subtasks, update_card, move_card, reorder_card, delete_card.',
      inputSchema: jsonSchema(schema as Parameters<typeof jsonSchema>[0]),
      execute: async (rawInput): Promise<AgentToolExecutionResult> => {
        const input = rawInput as KanbanBoardInput

        try {
          switch (input.action) {
            case 'read_board': {
              const result = await readKanbanBoardColumn({
                columnId: input.columnId!,
                cursor: input.cursor,
                includeCounts: input.includeCounts,
                limit: input.limit,
                workspacePath: context.workspaceRootPath,
              })
              return ok(
                `Read ${result.cards.length} ${result.column.title} task${result.cards.length === 1 ? '' : 's'}.`,
                result,
              )
            }

            case 'read_card': {
              const card = await getKanbanCard({
                cardId: input.cardId!,
                workspacePath: context.workspaceRootPath,
              })
              return ok(card ? `Read task: ${card.card.title}` : 'Task not found.', { card })
            }

            case 'create_card': {
              const card = await mutate(() =>
                createKanbanBoardCard({
                  acceptanceCriteria: input.acceptanceCriteria,
                  assignee: input.assignee ?? undefined,
                  columnId: input.columnId,
                  description: input.description,
                  issueType: input.issueType,
                  labels: input.labels,
                  parentCardId: input.parentCardId,
                  sourceMessageId: input.sourceMessageId,
                  priority: input.priority,
                  title: input.title!,
                  workspacePath: context.workspaceRootPath,
                }),
              )
              return ok(`Created task in ${card.columnId}: ${card.title}`, { card })
            }

            case 'create_task_with_subtasks': {
              const result = await mutate(() =>
                createKanbanBoardTask({
                  acceptanceCriteria: input.acceptanceCriteria,
                  assignee: input.assignee ?? undefined,
                  columnId: input.columnId,
                  description: input.description,
                  issueType: input.issueType,
                  labels: input.labels,
                  priority: input.priority,
                  subtasks: (input.subtasks ?? []).map((s) => ({
                    title: s.title,
                    issueType: s.issueType,
                    priority: s.priority,
                    description: s.description,
                    assignee: s.assignee,
                    labels: s.labels,
                    acceptanceCriteria: s.acceptanceCriteria,
                  })),
                  title: input.title!,
                  workspacePath: context.workspaceRootPath,
                }),
              )
              return ok(
                `Created task with ${result.subtasks.length} subtask${result.subtasks.length === 1 ? '' : 's'}: ${result.parent.title}`,
                result,
              )
            }

            case 'update_card': {
              const destination = input.targetColumnId || input.columnId
              const card = await mutate(async () => {
                let updated = await updateKanbanBoardCardContent({
                  acceptanceCriteria: input.acceptanceCriteria,
                  assignee: input.assignee,
                  cardId: input.cardId!,
                  description: input.description,
                  issueType: input.issueType,
                  labels: input.labels,
                  parentCardId: input.parentCardId,
                  priority: input.priority,
                  title: input.title,
                  workspacePath: context.workspaceRootPath,
                })
                if (destination && updated.columnId !== destination) {
                  updated = await moveKanbanBoardCard({
                    cardId: input.cardId!,
                    targetColumnId: destination,
                    workspacePath: context.workspaceRootPath,
                  })
                }
                return updated
              })
              return ok(`Updated task: ${card.title}`, { card })
            }

            case 'move_card': {
              const destination = input.targetColumnId || input.columnId
              if (!destination) {
                return err(null, 'move_card requires targetColumnId or columnId.')
              }
              const card = await mutate(() =>
                moveKanbanBoardCard({
                  cardId: input.cardId!,
                  targetColumnId: destination,
                  workspacePath: context.workspaceRootPath,
                }),
              )
              return ok(`Moved task to ${card.columnId}: ${card.title}`, { card })
            }

            case 'reorder_card': {
              const destination = input.targetColumnId || input.columnId
              if (!destination) {
                return err(null, 'reorder_card requires targetColumnId or columnId.')
              }
              const card = await mutate(() =>
                reorderKanbanBoardCard({
                  cardId: input.cardId!,
                  targetColumnId: destination,
                  targetIndex: input.targetIndex!,
                  workspacePath: context.workspaceRootPath,
                }),
              )
              return ok(`Reordered task in ${card.columnId}: ${card.title}`, { card })
            }

            case 'delete_card': {
              const boardData = await mutate(() =>
                deleteKanbanBoardCard({
                  cardId: input.cardId!,
                  deleteSubtasks: input.deleteSubtasks,
                  workspacePath: context.workspaceRootPath,
                }),
              )
              return ok('Deleted task.', { boardData })
            }

            default: {
              return err(null, `Unknown action: ${input.action}`)
            }
          }
        } catch (error) {
          return err(error, 'Kanban board operation failed.')
        }
      },
    }),
  }
}
