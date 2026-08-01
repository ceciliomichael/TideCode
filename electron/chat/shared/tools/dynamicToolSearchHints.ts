const SEARCH_HINTS_BY_TOOL_ID: Readonly<Record<string, readonly string[]>> = {
  apply_patch: [
    'apply a unified diff or patch text',
    'make coordinated changes across several files',
    'edit multiple files in one operation',
    'perform bulk code changes or a multi-file refactor',
    'apply patch hunks while preserving unrelated file content',
    'use when the change is already expressed as a patch',
  ],
  execute_terminal: [
    'run shell commands in a terminal',
    'execute PowerShell cmd or bash commands',
    'run tests builds scripts or package-manager commands',
    'run git commands or inspect repository state',
    'start a development server or other long-running process',
    'inspect terminal output and manage a persistent session',
    'execute a command in a specific working directory',
  ],
  get_terminal_output: [
    'read terminal output from a running command',
    'inspect stdout stderr or the result of a terminal session',
    'check whether a shell command finished or is still running',
  ],
  glob: [
    'find files by name filename extension or wildcard',
    'locate a file or directory when you know part of its path',
    'search for matching file paths without reading file contents',
    'find all source files of a type such as ts json css or md',
    'browse a project tree by glob pattern',
  ],
  grep: [
    'find text inside files and search file contents',
    'search source code for words symbols functions classes imports or patterns',
    'find exact text occurrences and regular expression matches',
    'find references usages definitions TODOs errors logs or configuration values',
    'find authentication tokens API keys secrets credentials or other sensitive text in files',
    'search many files without opening each file individually',
  ],
  kanban_board: [
    'manage project tasks and work items',
    'read boards cards columns backlog todo in-progress and done',
    'create update move reorder or delete kanban cards',
    'track issues requirements acceptance criteria and subtasks',
    'organize a project workflow or task board',
  ],
  list: [
    'list_dir',
    'list directory contents and immediate child entries',
    'inspect a folder without reading file contents',
    'browse the workspace or project structure',
    'see or show which files and directories exist at a path',
    'show a shallow directory tree',
  ],
  read: [
    'read file contents or a directory listing',
    'open look at inspect view show or display source code',
    'inspect the current contents of a config json html css or code file',
    'read a file before editing it',
    'understand what is currently in an existing file',
    'read a selected range using offset and limit',
  ],
  edit: [
    'replace one exact block of text in an existing file',
    'make a precise targeted edit without rewriting the whole file',
    'change a specific file section or line range',
    'modify code while preserving the rest of the file',
    'fix rename refactor or update one existing file',
    'replace exact old text with new text',
  ],
  skill: [
    'list search or load workspace skills',
    'find instructions for a specialized task',
    'load a playbook workflow or specialized capability',
    'activate instructions before performing a task',
    'discover available skills by topic or keyword',
  ],
  web_search: [
    'search the internet or browse online sources',
    'look up current latest recent or real-time information',
    'research news products documentation laws prices or public facts',
    'find external web pages and authoritative sources',
    'answer a question that requires citations or information beyond the workspace',
  ],
  write: [
    'create a new file from complete contents',
    'write save overwrite or rewrite an entire file',
    'replace all contents of a file with generated content',
    'generate a new html css js json or configuration file',
    'save a complete document at a path',
  ],
}

interface DynamicToolSearchHintContext {
  description?: string
  name?: string
  tags?: readonly string[]
}

const INFERRED_HINT_RULES: ReadonlyArray<{
  hints: readonly string[]
  keywords: readonly string[]
}> = [
  {
    hints: [
      'read or inspect the current contents of an existing file',
      'open source code or configuration before making a change',
    ],
    keywords: ['read', 'inspect', 'view', 'open', 'contents'],
  },
  {
    hints: [
      'list or browse directory entries and folders',
      'see which files and directories exist at a location',
    ],
    keywords: ['list', 'directory', 'folder', 'browse'],
  },
  {
    hints: [
      'find file paths by filename extension or wildcard pattern',
      'locate files without searching their contents',
    ],
    keywords: ['glob', 'filename', 'wildcard', 'file name'],
  },
  {
    hints: [
      'search text symbols or regular expressions inside file contents',
      'find occurrences references definitions or sensitive strings across files',
    ],
    keywords: ['grep', 'regex', 'regular expression', 'search text'],
  },
  {
    hints: [
      'make a precise change or exact text replacement in an existing file',
      'modify one code section while preserving unrelated content',
    ],
    keywords: ['edit', 'replace', 'modify', 'change', 'targetcontent'],
  },
  {
    hints: [
      'apply a patch or unified diff across one or more files',
      'make coordinated bulk changes with patch hunks',
    ],
    keywords: ['apply_patch', 'unified diff', 'patch hunk', 'multi-file patch'],
  },
  {
    hints: [
      'create save overwrite or rewrite a complete file',
      'generate a new document or configuration at a path',
    ],
    keywords: ['write', 'create', 'save', 'overwrite', 'complete file contents'],
  },
  {
    hints: [
      'run shell commands scripts tests builds or package-manager tasks',
      'execute commands in a persistent terminal session',
    ],
    keywords: ['terminal', 'shell', 'command', 'powershell', 'bash', 'session', 'execute'],
  },
  {
    hints: [
      'search the internet for current or external information',
      'research online sources documentation news or facts',
    ],
    keywords: ['web', 'internet', 'browser', 'online', 'current information'],
  },
  {
    hints: [
      'manage project tasks cards issues and workflow states',
      'create update move or delete work items on a board',
    ],
    keywords: ['kanban', 'board', 'card', 'task', 'issue'],
  },
  {
    hints: [
      'find or load specialized instructions and workflows',
      'activate a skill or playbook for a task',
    ],
    keywords: ['skill', 'instruction', 'workflow', 'playbook'],
  },
]

export function getDynamicToolSearchHints(toolId: string, context: DynamicToolSearchHintContext = {}) {
  const hints = new Set(SEARCH_HINTS_BY_TOOL_ID[toolId] ?? [])
  const source = `${toolId} ${context.name ?? ''} ${context.description ?? ''} ${(context.tags ?? []).join(' ')}`.toLowerCase()

  for (const rule of INFERRED_HINT_RULES) {
    if (rule.keywords.some((keyword) => source.includes(keyword))) {
      for (const hint of rule.hints) {
        hints.add(hint)
      }
    }
  }

  return [...hints]
}
