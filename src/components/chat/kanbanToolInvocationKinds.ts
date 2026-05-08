const KANBAN_TOOL_NAMES = new Set(['read_board', 'read_card', 'create_card', 'update_card', 'move_card'])

export function isKanbanTool(toolName: string) {
  return KANBAN_TOOL_NAMES.has(toolName)
}
