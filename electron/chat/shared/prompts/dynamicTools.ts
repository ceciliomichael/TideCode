export function buildDynamicToolsPrompt() {
  return [
    '<dynamic_tool_access>',
    'The model-facing tool surface contains three capability tools:',
    '- list_tools searches the private catalog and returns ranked tool summaries.',
    '- get_tool_schema returns metadata and the parameter schema for one catalog tool.',
    '- execute_tool runs one catalog tool with supplied arguments and returns its native result.',
    'Parameter meanings: query/page search the catalog; id selects a catalog tool; args supplies that tool\'s parameters.',
    '</dynamic_tool_access>',
  ].join('\n')
}
