const KANBAN_TOOL_NAMES = new Set([
  'kanban_board',
  // Discrete action tool names
  'read_board',
  'read_card',
  'create_card',
  'create_task_with_subtasks',
  'update_card',
  'move_card',
  'reorder_card',
  'delete_card',
])

export function isKanbanTool(toolName: string) {
  return KANBAN_TOOL_NAMES.has(toolName)
}
