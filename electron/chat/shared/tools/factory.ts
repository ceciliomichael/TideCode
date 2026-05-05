import { jsonSchema, tool, type ToolSet } from 'ai'
import type { ChatMode, ChatProviderId } from '../../../../src/types/chat'
import type { SkillSummary } from '../../../../src/types/skills'
import { buildLoadedSkillResult, buildSkillToolDescription, loadEnabledSkillByName } from '../../../skills/service'
import type { AgentToolContext, AgentToolExecutionResult } from '../toolTypes'
import {
  createGlobToolResult,
  createGrepToolResult,
  createListToolResult,
  createReadToolResult,
  createToolContext,
  createWholeFileWriteTool,
  resolveReadableTargetPath,
} from './workspaceTools'
import { createApplyPatchTool } from './applyPatchTool'
import { createTerminalToolSet } from './terminalTools'

function createToolErrorResult(summary: string, body?: string): AgentToolExecutionResult {
  return {
    ...(body ? { body } : {}),
    status: 'error',
    summary,
  }
}

export async function createAgentTools(
  input: AgentToolContext,
  options?: { chatMode?: ChatMode; enabledSkills?: SkillSummary[]; providerId?: ChatProviderId },
): Promise<ToolSet> {
  const context = await createToolContext(input)
  const wholeFileWriteTool = createWholeFileWriteTool(context)
  const isPlanMode = options?.chatMode === 'plan'
  const enabledSkills = options?.enabledSkills ?? []
  const readPathGuidance =
    context.terminalExecutionMode === 'full'
      ? 'Read one UTF-8 text file and return numbered lines. Do not guess paths. Use `list`, `glob`, or `grep` first, then pass the exact path as `absolute_path`. Read the file immediately before editing it; if the file might be stale, read it again before any mutation. In Full Access, `absolute_path` may point outside the current workspace if the user provided that path. Use `offset` to continue a large file. Example: `read({ absolute_path: "/repo/src/app.ts" })`.'
      : 'Read one UTF-8 text file and return numbered lines. Do not guess paths. Use `list`, `glob`, or `grep` first, then pass the exact path as `absolute_path`. Read the file immediately before editing it; if the file might be stale, read it again before any mutation. In Sandbox mode, `absolute_path` must point to a real file inside the current workspace. Use `offset` to continue a large file. Example: `read({ absolute_path: "/repo/src/app.ts" })`.'
  const listPathGuidance =
    context.terminalExecutionMode === 'full'
      ? 'List files and folders in one directory. Use this first when you do not know the exact path yet. In Full Access, `absolute_path` may point outside the current workspace if the user provided that path. This only shows direct children. Example: `list({ absolute_path: "/repo/src" })`.'
      : 'List files and folders in one workspace directory. Use this first when you do not know the exact path yet. Use `read` after you find a file. In Sandbox mode, `absolute_path` must be the workspace root or an exact directory path inside the workspace. This only shows direct children. Example: `list({ absolute_path: "/repo/src" })`.'
  const listDescription =
    listPathGuidance
  const readDescription = isPlanMode
    ? readPathGuidance
    : `${readPathGuidance} After reading, use \`apply_patch\` for small edits or \`write\` for a full replacement.`
  const globDescription =
    context.terminalExecutionMode === 'full'
      ? 'Find file paths by glob pattern. Use this when you know the file name shape but not the exact path. In Full Access, `absolute_path` may narrow the search to a directory outside the current workspace if the user provided that path. Read the matched files with `read` before editing. Example: `glob({ absolute_path: "/repo/src", pattern: "**/*.ts" })`.'
      : 'Find file paths by glob pattern inside the workspace. Use this when you know the file name shape but not the exact path. In Sandbox mode, `absolute_path` narrows the search to one directory inside the workspace. Read the matched files with `read` immediately before editing, and re-read if anything may have changed since the last read. Example: `glob({ absolute_path: "/repo/src", pattern: "**/*.ts" })`.'
  const grepDescription = isPlanMode
    ? context.terminalExecutionMode === 'full'
      ? 'Search file contents. Use this to find text, symbols, or strings, then read the matching files with `read`. In Full Access, `absolute_path` may limit the search to a file or directory outside the current workspace if the user provided that path. Use `include` to limit by filename glob. Example: `grep({ absolute_path: "/repo/src", pattern: "buildChatPrompt", include: "**/*.ts" })`.'
      : 'Search file contents in visible workspace files. Use this to find text, symbols, or strings, then read the matching files with `read`. Treat grep results as hints, not full context. Keep `pattern` specific. In Sandbox mode, `absolute_path` must limit the search to one file or directory inside the workspace. Use `include` to limit by filename glob. Example: `grep({ absolute_path: "/repo/src", pattern: "buildChatPrompt", include: "**/*.ts" })`.'
    : context.terminalExecutionMode === 'full'
      ? 'Search file contents. Use this to find text, symbols, or strings, then read the matching files with `read`. In Full Access, `absolute_path` may limit the search to a file or directory outside the current workspace if the user provided that path. Use `include` to limit by filename glob. After you read the target file, read it again immediately before editing if there is any chance the file changed. Then use `apply_patch` for small edits or `write` for a full replacement. Example: `grep({ absolute_path: "/repo/src", pattern: "buildChatPrompt", include: "**/*.ts" })`.'
      : 'Search file contents in visible workspace files. Use this to find text, symbols, or strings, then read the matching files with `read`. Treat grep results as hints, not full context. Keep `pattern` specific. In Sandbox mode, `absolute_path` must limit the search to one file or directory inside the workspace. Use `include` to limit by filename glob. After you read the target file, read it again immediately before editing if there is any chance the file changed. Then use `apply_patch` for small edits or `write` for a full replacement. Example: `grep({ absolute_path: "/repo/src", pattern: "buildChatPrompt", include: "**/*.ts" })`.'
  const tools: ToolSet = {
    list: tool({
      description: listDescription,
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          absolute_path: {
            type: 'string',
          },
        },
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as { absolute_path?: string }
        try {
          const target = resolveReadableTargetPath(
            context.workspaceRootPath,
            inputValue.absolute_path,
            context.terminalExecutionMode,
          )
          return await createListToolResult(context.workspaceRootPath, target.absolutePath, target.displayPath)
        } catch (error) {
          return createToolErrorResult(
            error instanceof Error && error.message.trim().length > 0 ? error.message : 'List failed.',
          )
        }
      },
    }),
    read: tool({
      description: readDescription,
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          absolute_path: {
            type: 'string',
          },
          limit: {
            minimum: 1,
            type: 'number',
          },
          offset: {
            minimum: 1,
            type: 'number',
          },
        },
        required: ['absolute_path'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as {
          absolute_path: string
          limit?: number
          offset?: number
        }
        try {
          const target = resolveReadableTargetPath(
            context.workspaceRootPath,
            inputValue.absolute_path,
            context.terminalExecutionMode,
          )
          return await createReadToolResult(target.absolutePath, target.displayPath, inputValue.offset, inputValue.limit)
        } catch (error) {
          return createToolErrorResult(
            error instanceof Error && error.message.trim().length > 0 ? error.message : 'Read failed.',
          )
        }
      },
    }),
    glob: tool({
      description: globDescription,
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          absolute_path: {
            type: 'string',
          },
          pattern: {
            minLength: 1,
            type: 'string',
          },
        },
        required: ['pattern'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as {
          absolute_path?: string
          pattern: string
        }
        try {
          const target = resolveReadableTargetPath(
            context.workspaceRootPath,
            inputValue.absolute_path,
            context.terminalExecutionMode,
          )
          return await createGlobToolResult(context.workspaceRootPath, target.absolutePath, target.displayPath, inputValue.pattern)
        } catch (error) {
          return createToolErrorResult(
            error instanceof Error && error.message.trim().length > 0 ? error.message : 'Glob failed.',
          )
        }
      },
    }),
    grep: tool({
      description: grepDescription,
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          absolute_path: {
            type: 'string',
          },
          include: {
            type: 'string',
          },
          pattern: {
            minLength: 1,
            type: 'string',
          },
        },
        required: ['pattern'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as {
          absolute_path?: string
          include?: string
          pattern: string
        }
        try {
          const target = resolveReadableTargetPath(
            context.workspaceRootPath,
            inputValue.absolute_path,
            context.terminalExecutionMode,
          )
          return await createGrepToolResult(
            context.workspaceRootPath,
            target.absolutePath,
            target.displayPath,
            inputValue.pattern,
            inputValue.include,
          )
        } catch (error) {
          return createToolErrorResult(
            error instanceof Error && error.message.trim().length > 0 ? error.message : 'Search failed.',
          )
        }
      },
    }),
  }

  if (enabledSkills.length > 0) {
    tools.skill = tool({
      description: buildSkillToolDescription(enabledSkills),
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          name: {
            enum: enabledSkills.map((skill) => skill.name),
            type: 'string',
          },
        },
        required: ['name'],
        type: 'object',
      }),
      execute: async (rawInput) => {
        const inputValue = rawInput as { name: string }
        try {
          const loadedSkill = await loadEnabledSkillByName(inputValue.name, context.workspaceRootPath, enabledSkills)
          if (!loadedSkill) {
            return createToolErrorResult(
              `Skill "${inputValue.name}" is unavailable.`,
              `Available skills: ${enabledSkills.map((skill) => skill.name).join(', ') || 'none'}`,
            )
          }

          return buildLoadedSkillResult(loadedSkill)
        } catch (error) {
          return createToolErrorResult(
            error instanceof Error && error.message.trim().length > 0 ? error.message : 'Unable to load the skill.',
          )
        }
      },
    })
  }

  try {
    const isElectronRuntime = typeof process !== 'undefined' && Boolean(process.versions.electron)
    if (isElectronRuntime) {
      const { getMcpServerManager } = await import('../../../mcp/serverManager')
      const mcpTools = await getMcpServerManager().getToolSet(context.workspaceRootPath)
      Object.assign(tools, mcpTools)
    }
  } catch (error) {
    console.error('Failed to load MCP tools', error)
  }

  if (isPlanMode) {
    return tools
  }

  return {
    ...tools,
    ...createTerminalToolSet(input),
    write: wholeFileWriteTool,
    apply_patch: createApplyPatchTool(context, options?.providerId),
  }
}
