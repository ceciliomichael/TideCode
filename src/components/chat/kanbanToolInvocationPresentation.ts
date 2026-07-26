import type { ToolInvocationTrace } from '../../types/chat'

/**
 * Safely parses the `action` field from the tool invocation's argumentsText JSON.
 * Returns null if the arguments cannot be parsed or action is missing.
 */
function parseKanbanAction(argumentsText: string): string | null {
  try {
    const parsed = JSON.parse(argumentsText)
    if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string') {
      return parsed.action
    }
  } catch {
    // Partial / streaming JSON — tolerate gracefully
  }
  return null
}

function formatKanbanVerb(action: string | null, state: ToolInvocationTrace['state']) {
  switch (action) {
    case 'read_board':
      return state === 'running' ? 'Reading board' : state === 'completed' ? 'Read board' : 'Read board failed'
    case 'read_card':
      return state === 'running' ? 'Reading card' : state === 'completed' ? 'Read card' : 'Read card failed'
    case 'create_card':
      return state === 'running' ? 'Creating card' : state === 'completed' ? 'Created card' : 'Create card failed'
    case 'create_task_with_subtasks':
      return state === 'running'
        ? 'Planning task and subtasks'
        : state === 'completed'
          ? 'Created task and subtasks'
          : 'Create task and subtasks failed'
    case 'update_card':
      return state === 'running' ? 'Updating card' : state === 'completed' ? 'Updated card' : 'Update card failed'
    case 'move_card':
      return state === 'running' ? 'Moving card' : state === 'completed' ? 'Moved card' : 'Move card failed'
    case 'reorder_card':
      return state === 'running'
        ? 'Reordering card'
        : state === 'completed'
          ? 'Reordered card'
          : 'Reorder card failed'
    case 'delete_card':
      return state === 'running' ? 'Deleting task' : state === 'completed' ? 'Deleted task' : 'Delete task failed'
    default:
      return state === 'running'
        ? 'Running kanban operation'
        : state === 'completed'
          ? 'Completed kanban operation'
          : 'Kanban operation failed'
  }
}

export function getKanbanToolInvocationHeaderLabel(invocation: ToolInvocationTrace) {
  const action = parseKanbanAction(invocation.argumentsText)
  return formatKanbanVerb(action, invocation.state)
}
