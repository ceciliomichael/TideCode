export function buildDynamicToolsPrompt() {
  return [
    '<dynamic_tool_access>',
    'The model-facing tool surface contains three capability tools:',
    '- list_tools searches the private catalog and returns ranked tool summaries.',
    '- get_tool_schema returns metadata and parameter schemas for one or more catalog tools. Use id for one tool or ids for a batch of independent tools.',
    '- execute_tool runs one catalog tool with supplied arguments and returns its native result.',
    'Parameter meanings: query/page search the catalog; id selects one catalog tool; ids selects multiple catalog tools; args supplies the selected tool\'s parameters.',
    'Call execute_tool with exactly this top-level shape: {"id":"<catalog id>","args":{...}}. The id property and args property are siblings. Never wrap that object inside another args property, and never put id inside the native args object.',
    '</dynamic_tool_access>',
  ].join('\n')
}
