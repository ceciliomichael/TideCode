const FILE_WRITE_TOOL_NAMES = new Set(['apply', 'write'])
const FILE_EDIT_TOOL_NAMES = new Set(['apply_patch', 'edit'])

export function isFileWriteTool(toolName: string) {
  return FILE_WRITE_TOOL_NAMES.has(toolName)
}

export function isFileEditTool(toolName: string) {
  return FILE_EDIT_TOOL_NAMES.has(toolName)
}


export function isFileMutationTool(toolName: string) {
  return isFileWriteTool(toolName) || isFileEditTool(toolName)
}
