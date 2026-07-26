import type { ToolSet } from 'ai'
import type { ChatMode, ChatProviderId } from '../../../../src/types/chat'
import type { SkillSummary } from '../../../../src/types/skills'
import type { AgentToolContext } from '../toolTypes'

import { createReplaceFileContentTool } from './replaceFileContentTool'
import { createGlobTool } from './globTool'
import { createGrepTool } from './grepTool'
import { createKanbanToolSet } from './kanbanTools'
import { createListTool } from './listTool'
import { createProviderWebTool } from './providerWebTool'
import { createReadTool } from './readTool'
import { createSkillTool } from './skillTool'
import { createTerminalToolSet } from './terminalTools'
import { createToolContext } from './workspaceTools'
import { createWriteTool } from './writeTool'

export interface CreateAgentToolsOptions {
  chatMode?: ChatMode
  enabledSkills?: SkillSummary[]
  providerId?: ChatProviderId
}

async function addMcpTools(tools: ToolSet, workspaceRootPath: string) {
  try {
    const isElectronRuntime = typeof process !== 'undefined' && Boolean(process.versions.electron)
    if (!isElectronRuntime) {
      return
    }

    const { getMcpServerManager } = await import('../../../mcp/serverManager')
    Object.assign(tools, await getMcpServerManager().getToolSet(workspaceRootPath))
  } catch (error) {
    console.error('Failed to load MCP tools', error)
  }
}

export async function createAgentTools(
  input: AgentToolContext,
  options: CreateAgentToolsOptions = {},
): Promise<ToolSet> {
  const context = await createToolContext(input)
  const isPlanMode = options.chatMode === 'plan'
  const enabledSkills = options.enabledSkills ?? []
  const tools: ToolSet = {
    list: createListTool(context),
    read: createReadTool(context),
    glob: createGlobTool(context),
    grep: createGrepTool(context),
    ...createKanbanToolSet(context, { readOnly: isPlanMode }),
  }

  if (!isPlanMode) {
    Object.assign(
      tools,
      createTerminalToolSet({ ...context, conversationId: input.conversationId, webContents: input.webContents }),
    )
  }

  if (enabledSkills.length > 0) {
    tools.skill = createSkillTool(context, enabledSkills)
  }

  const providerWebTool = createProviderWebTool(options.providerId)
  tools[providerWebTool.name] = providerWebTool.tool

  if (isPlanMode) {
    return tools
  }

  await addMcpTools(tools, context.workspaceRootPath)

  return {
    ...tools,
    write: createWriteTool(context),
    replace_file_content: createReplaceFileContentTool(context),
  }
}
