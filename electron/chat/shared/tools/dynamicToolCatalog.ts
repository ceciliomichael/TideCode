import { asSchema, type ToolSet } from 'ai'
import { getMcpToolSource } from '../../../mcp/toolMetadata'
import type { DynamicNativeTool, DynamicToolCatalogEntry, DynamicToolGuidance } from './dynamicToolContracts'
import { getDynamicToolSearchHints } from './dynamicToolSearchHints'

function normalizeToolId(value: string) {
  return value.trim()
}

function readDescription(tool: DynamicNativeTool) {
  if (typeof tool.description === 'string' && tool.description.trim().length > 0) {
    return tool.description.trim()
  }
  return 'No description provided.'
}

function stringifySchema(schema: Record<string, unknown>) {
  try {
    return JSON.stringify(schema)
  } catch {
    return ''
  }
}

function splitWords(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1)
}

function buildTags(id: string, description: string, schema: Record<string, unknown>) {
  const source = `${id} ${description} ${stringifySchema(schema)}`
  const words = new Set(splitWords(source))
  const categoryRules: Array<[string, string[]]> = [
    ['filesystem', ['file', 'path', 'directory', 'workspace', 'folder']],
    ['search', ['search', 'grep', 'glob', 'pattern', 'query', 'find', 'match']],
    ['coding', ['code', 'edit', 'write', 'replace', 'patch', 'content']],
    ['terminal', ['terminal', 'command', 'shell', 'session', 'run']],
    ['web', ['web', 'internet', 'browser', 'url', 'online']],
    ['skills', ['skill', 'skills']],
    ['kanban', ['kanban', 'card', 'board', 'task']],
  ]
  const tags = categoryRules
    .filter(([, keywords]) => keywords.some((keyword) => words.has(keyword) || source.includes(keyword)))
    .map(([tag]) => tag)

  return tags.length > 0 ? tags : ['general']
}

function buildAliases(id: string, name: string, description: string) {
  const aliases = new Set<string>([id, name])
  const lowerDescription = description.toLowerCase()
  const addWhenMentioned = (alias: string, keywords: string[]) => {
    if (keywords.some((keyword) => lowerDescription.includes(keyword) || id.includes(keyword))) {
      aliases.add(alias)
    }
  }

  addWhenMentioned('read', ['read', 'contents', 'inspect', 'view'])
  addWhenMentioned('search', ['search', 'find', 'grep', 'glob', 'match'])
  addWhenMentioned('list', ['list', 'directory', 'entries', 'browse'])
  addWhenMentioned('edit', ['edit', 'replace', 'patch', 'modify', 'change'])
  addWhenMentioned('write', ['write', 'create', 'save', 'content'])
  addWhenMentioned('terminal', ['terminal', 'command', 'shell', 'session'])
  addWhenMentioned('web', ['web', 'internet', 'browser', 'url'])
  return Array.from(aliases)
}

const DEFAULT_GUIDANCE: DynamicToolGuidance = {
  safety: [],
  whenToUse: 'Use this tool when its description and parameter schema match the task.',
  workflow: [],
}

function buildToolGuidance(id: string, tags: readonly string[]): DynamicToolGuidance {
  const guidanceById: Record<string, DynamicToolGuidance> = {
    apply_patch: {
      safety: ['Review the result and verify every affected path after applying the patch.'],
      whenToUse: 'Use for patch-shaped or multi-file changes after reading the affected files.',
      workflow: ['Read the current contents before constructing the patch.'],
    },
    execute_terminal: {
      safety: ['Keep calls for the same terminal session sequential.'],
      whenToUse: 'Use to run commands or inspect an existing terminal session.',
      workflow: [
        'Use execute to start a command, read to inspect output, list to find sessions, and end to stop a session.',
      ],
    },
    grep: {
      safety: ['Keep search scope inside the active execution context.'],
      whenToUse: 'Use to find text or regular-expression matches when you do not know which files contain them.',
      workflow: [],
    },
    glob: {
      safety: ['Keep search scope inside the active execution context.'],
      whenToUse: 'Use to find file paths by name or glob pattern.',
      workflow: [],
    },
    kanban_board: {
      safety: ['Never run concurrent mutations against the same card.'],
      whenToUse: 'Use to inspect or update the Kanban board and its cards.',
      workflow: ['Read the board or card before changing it; use the action and fields described in the schema.'],
    },
    list: {
      safety: ['Keep paths inside the active execution context.'],
      whenToUse: 'Use to inspect the direct children of a directory or the workspace root.',
      workflow: [],
    },
    read: {
      safety: ['Keep paths inside the active execution context.'],
      whenToUse: 'Use to inspect the current contents of a file or directory.',
      workflow: ['Read an existing file immediately before editing it so the edit uses current contents.'],
    },
    edit: {
      safety: ['Keep the replacement target exact and verify the resulting file.'],
      whenToUse: 'Use for one precise replacement in an existing file.',
      workflow: [
        'Read the current file first and copy the exact current block into targetContent.',
        'Call edit with path, targetContent, and replacementContent. startLine and endLine are optional search bounds, but must be provided together when used.',
        'If the target is ambiguous, narrow the line range or include a larger unique block; never guess which occurrence to change.',
      ],
    },
    skill: {
      safety: ['Load only the exact enabled skill needed for the task.'],
      whenToUse: 'Use to list, search, or load enabled skill instructions.',
      workflow: [
        'Use list or search to discover a skill, then load it by exact name before applying its instructions.',
      ],
    },
    web_search: {
      safety: ['Use authoritative sources when the answer depends on current or external information.'],
      whenToUse: 'Use when the task requires current information from the web.',
      workflow: [],
    },
    write: {
      safety: ['Keep the target inside the active execution context and verify the written contents.'],
      whenToUse: 'Use to create a file or replace a file with complete contents.',
      workflow: ['For an existing file, read it first and make sure a full replacement is intentional.'],
    },
  }

  const knownGuidance = guidanceById[id]
  if (knownGuidance) {
    return {
      safety: [...knownGuidance.safety],
      whenToUse: knownGuidance.whenToUse,
      workflow: [...knownGuidance.workflow],
    }
  }

  if (tags.includes('terminal')) {
    return {
      safety: ['Keep calls for the same terminal session sequential.'],
      whenToUse: 'Use to run or inspect terminal commands according to the parameter schema.',
      workflow: [],
    }
  }

  if (tags.includes('filesystem')) {
    return {
      safety: ['Keep paths inside the active execution context.'],
      whenToUse: 'Use for a filesystem operation described by the tool schema.',
      workflow: [],
    }
  }

  return {
    safety: [...DEFAULT_GUIDANCE.safety],
    whenToUse: DEFAULT_GUIDANCE.whenToUse,
    workflow: [...DEFAULT_GUIDANCE.workflow],
  }
}

function isExecutableTool(
  tool: DynamicNativeTool,
): tool is DynamicNativeTool & { execute: (...args: never[]) => unknown } {
  return typeof tool.execute === 'function'
}

export async function buildDynamicToolCatalog(nativeTools: ToolSet): Promise<DynamicToolCatalogEntry[]> {
  const entries = await Promise.all(
    Object.entries(nativeTools).map(async ([rawId, nativeTool]) => {
      const id = normalizeToolId(rawId)
      if (id.length === 0 || !isExecutableTool(nativeTool)) {
        return null
      }

      const resolvedSchema = await asSchema(nativeTool.inputSchema).jsonSchema
      const inputSchema = resolvedSchema as unknown as Record<string, unknown>
      const description = readDescription(nativeTool)
      const tags = buildTags(id, description, inputSchema)
      const mcpSource = getMcpToolSource(nativeTool)
      const name = mcpSource?.originalToolName ?? id
      const entry: DynamicToolCatalogEntry = {
        aliases: buildAliases(id, name, description),
        description,
        execute: nativeTool.execute as unknown as DynamicToolCatalogEntry['execute'],
        guidance: buildToolGuidance(id, tags),
        id,
        inputSchema,
        name,
        nativeTool,
        searchHints: getDynamicToolSearchHints(id),
        source: mcpSource ?? { kind: 'native' as const },
        tags,
      }
      return entry
    }),
  )

  return entries
    .filter((entry): entry is DynamicToolCatalogEntry => entry !== null)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: 'base',
        }) || left.id.localeCompare(right.id),
    )
}
