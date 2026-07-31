const SEARCH_HINTS_BY_TOOL_ID: Readonly<Record<string, readonly string[]>> = {
  apply_patch: [
    'apply a multi-file patch',
    'make coordinated changes across several files',
    'edit multiple files with a patch',
  ],
  execute_terminal: [
    'run shell commands',
    'execute terminal commands',
    'run tests or scripts',
    'inspect or manage terminal sessions',
  ],
  get_terminal_output: [
    'read terminal output',
    'inspect the output of a running command',
    'check the result of a terminal session',
  ],
  glob: [
    'find files by name',
    'locate files and directories',
    'search for matching file paths',
  ],
  grep: [
    'find text in files',
    'search source code for words symbols or patterns',
    'find regular expression matches',
    'find authentication tokens API keys secrets credentials or other text in files',
  ],
  kanban_board: [
    'inspect or update project tasks',
    'read boards cards and columns',
    'create move update or delete kanban cards',
  ],
  list: [
    'list_dir',
    'list directory contents',
    'inspect folders and direct child entries',
    'browse the workspace structure',
  ],
  read: [
    'read file contents',
    'open inspect or view source code',
    'inspect a file before editing it',
  ],
  edit: [
    'replace one exact block of text in a file',
    'make a precise edit to an existing file',
    'change a specific file section',
  ],
  skill: [
    'list search or load workspace skills',
    'find instructions for a specialized task',
    'activate a skill',
  ],
  web_search: [
    'search the internet',
    'look up current information online',
    'find external web sources',
  ],
  write: [
    'create a new file',
    'write complete file contents',
    'save or replace a file',
  ],
}

export function getDynamicToolSearchHints(toolId: string) {
  return [...(SEARCH_HINTS_BY_TOOL_ID[toolId] ?? [])]
}
