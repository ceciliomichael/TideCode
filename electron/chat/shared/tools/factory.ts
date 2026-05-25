import { openai } from '@ai-sdk/openai'
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
import { createWebFetchTool } from './webfetchTool'
import { createKanbanToolSet } from './kanbanTools'
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
  const listDescription =
    context.terminalExecutionMode === 'full'
      ? 'List direct child files and folders in a directory.'
      : 'List direct child files and folders in a workspace directory. In Sandbox mode, absolute_path must be a path inside the workspace.'
  const readDescription =
    context.terminalExecutionMode === 'full'
      ? 'Read a UTF-8 text file as numbered lines. Use limit and offset for pagination.'
      : 'Read a UTF-8 text file inside the workspace as numbered lines. In Sandbox mode, absolute_path must point to a file inside the workspace. Use limit and offset for pagination.'
  const globDescription =
    context.terminalExecutionMode === 'full'
      ? 'Find file paths matching a glob pattern.'
      : 'Find file paths matching a glob pattern inside the workspace. In Sandbox mode, absolute_path limits the search scope to a directory inside the workspace.'
  const grepDescription =
    context.terminalExecutionMode === 'full'
      ? 'Search for regex or string pattern matches in file contents. Use include to filter filenames.'
      : 'Search for regex or string pattern matches in file contents inside the workspace. In Sandbox mode, absolute_path restricts the search to a path inside the workspace. Use include to filter filenames.'
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

  Object.assign(tools, createKanbanToolSet(context))

  if (!isPlanMode) {
    Object.assign(tools, createTerminalToolSet({ ...context, conversationId: input.conversationId, webContents: input.webContents }))
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

  if (options?.providerId === 'codex') {
    tools.web_search = openai.tools.webSearch()
  } else {
    tools.webfetch = createWebFetchTool()
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
    write: wholeFileWriteTool,
    apply_patch: createApplyPatchTool(context, options?.providerId),
  }
}
