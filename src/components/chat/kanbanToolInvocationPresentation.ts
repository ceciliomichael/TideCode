import type { ToolInvocationTrace } from '../../types/chat'

function formatKanbanVerb(toolName: string, state: ToolInvocationTrace['state']) {
  if (toolName === 'read_board') {
    if (state === 'running') {
      return 'Reading board'
    }
    if (state === 'completed') {
      return 'Read board'
    }
    return 'Read board failed'
  }

  if (toolName === 'read_card') {
    if (state === 'running') {
      return 'Reading card'
    }
    if (state === 'completed') {
      return 'Read card'
    }
    return 'Read card failed'
  }

  if (toolName === 'create_card') {
    if (state === 'running') {
      return 'Creating card'
    }
    if (state === 'completed') {
      return 'Created card'
    }
    return 'Create card failed'
  }

  if (toolName === 'update_card') {
    if (state === 'running') {
      return 'Updating card'
    }
    if (state === 'completed') {
      return 'Updated card'
    }
    return 'Update card failed'
  }

  if (toolName === 'move_card') {
    if (state === 'running') {
      return 'Moving card'
    }
    if (state === 'completed') {
      return 'Moved card'
    }
    return 'Move card failed'
  }

  return state === 'running' ? `Running ${toolName}` : state === 'completed' ? `Completed ${toolName}` : `Failed ${toolName}`
}

export function getKanbanToolInvocationHeaderLabel(invocation: ToolInvocationTrace) {
  return formatKanbanVerb(invocation.toolName, invocation.state)
}
