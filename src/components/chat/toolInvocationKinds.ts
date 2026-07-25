const FILE_WRITE_TOOL_NAMES = new Set(['apply', 'apply_patch', 'write'])

export function isFileWriteTool(toolName: string) {
  return FILE_WRITE_TOOL_NAMES.has(toolName)
}

export function isFileEditTool(toolName: string) {
  return (
    toolName === 'replace_file_content' ||
    toolName === 'multi_replace_file_content'
  )
}


export function isFileMutationTool(toolName: string) {
  return isFileWriteTool(toolName) || isFileEditTool(toolName)
}
