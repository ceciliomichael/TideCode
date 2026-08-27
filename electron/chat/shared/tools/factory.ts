import type { ToolSet } from 'ai'
import type { ChatMode, ChatProviderId } from '../../../../src/types/chat'
import type { SkillSummary } from '../../../../src/types/skills'
import type { AgentToolContext } from '../toolTypes'
import { DEFAULT_AGENT_ORCHESTRATION_MODE, type AgentOrchestrationMode } from '../orchestration'
import { CodeModeExecutor } from '../codeMode/executor'
import { createAgentToolRegistry, type AgentToolRegistry } from './registry'
import { createCodeModeTool, createToolSearchTool } from './metaTools'
import { createConnectedMcpRegistryTools } from './mcpRegistryTools'

import { createEditTool } from './editTool'
import { createApplyPatchTool } from './applyPatchTool'
import { createGlobTool } from './globTool'
import { createGrepTool } from './grepTool'
import { createKanbanToolSet } from './kanbanTools'
import { createListTool } from './listTool'
import { createMcpToolSet } from './mcpTools'
import { createProviderWebTool } from './providerWebTool'
import { createReadTool } from './readTool'
import { createReadToolOutputTool } from './readToolOutput'
import { createPlanToolSet } from './planTools'
import { createSkillTool } from './skillTool'
import { createTerminalToolSet } from './terminalTools'
import { createToolContext } from './workspaceTools'
import { createWriteTool } from './writeTool'

export interface CreateAgentToolsOptions {
  chatMode?: ChatMode
  enabledSkills?: SkillSummary[]
  providerId?: ChatProviderId
}

export interface AgentToolBundle {
  codeModeExecutor: CodeModeExecutor | null
  nativeTools: ToolSet
  registry: AgentToolRegistry
  tools: ToolSet
}

const CODE_MODE_EXCLUDED_TOOLS = new Set(['mcp_tool_search', 'execute_mcp', 'edit'])

export async function createNativeAgentTools(
  input: AgentToolContext,
  options: CreateAgentToolsOptions = {},
): Promise<ToolSet> {
  const context = await createToolContext(input)
  const isPlanMode = options.chatMode === 'plan'
  const enabledSkills = options.enabledSkills ?? []
  const tools: ToolSet = {
    list: createListTool(context),
    read: createReadTool(context),
    read_tool_output: createReadToolOutputTool(),
    glob: createGlobTool(context),
    grep: createGrepTool(context),
    ...createMcpToolSet(context),
    ...createKanbanToolSet(context),
  }

  if (isPlanMode) {
    Object.assign(tools, createPlanToolSet(context))
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
  if (providerWebTool) {
    tools[providerWebTool.name] = providerWebTool.tool
  }

  if (isPlanMode) {
    return tools
  }

  return {
    ...tools,
    apply_patch: createApplyPatchTool(context),
    edit: createEditTool(context),
    write: createWriteTool(context),
  }
}

/** Builds the exact provider-facing native tool set. */
export async function createAgentTools(
  input: AgentToolContext,
  options: CreateAgentToolsOptions = {},
): Promise<ToolSet> {
  return createNativeAgentTools(input, options)
}

export async function createAgentToolBundle(
  input: AgentToolContext,
  options: CreateAgentToolsOptions & { orchestrationMode?: AgentOrchestrationMode } = {},
): Promise<AgentToolBundle> {
  const nativeTools = await createNativeAgentTools(input, options)
  const orchestrationMode = options.orchestrationMode ?? DEFAULT_AGENT_ORCHESTRATION_MODE

  let registryTools = nativeTools
  if (options.chatMode !== 'plan' && orchestrationMode !== 'direct') {
    const connectedMcpTools = await createConnectedMcpRegistryTools(input)
    registryTools = Object.fromEntries([
      ...Object.entries(nativeTools).filter(([name]) => !CODE_MODE_EXCLUDED_TOOLS.has(name)),
      ...Object.entries(connectedMcpTools),
    ])
  }

  const baseRegistry = await createAgentToolRegistry(registryTools)

  if (options.chatMode === 'plan' || orchestrationMode === 'direct') {
    return {
      codeModeExecutor: null,
      nativeTools,
      registry: baseRegistry,
      tools: nativeTools,
    }
  }

  // Discovery is itself a Code Mode API. Building the final registry in a
  // second pass keeps tool_search backed by the same catalog while avoiding a
  // separate provider-native tool call that some providers treat as terminal.
  const registry = await createAgentToolRegistry({
    ...registryTools,
    tool_search: createToolSearchTool(baseRegistry, { dynamicOnly: true }),
  })
  // Dynamic MCP functions exist in the sandbox but remain absent from the
  // model-visible documentation until tools.tool_search returns their names.
  // This permits discovery and invocation in one temporary program.
  const preloadedToolNames = registry.entries.map((entry) => entry.name)
  // Code Mode itself is always tool-only. The app's sandbox/full setting is
  // enforced by the structured filesystem and terminal tools in the registry.
  const codeModeExecutor = new CodeModeExecutor(registry, preloadedToolNames, {
    terminalExecutionMode: 'sandbox',
    workspaceRootPath: input.workspaceRootPath,
  })
  const metaTools: ToolSet = {
    code_mode: createCodeModeTool(codeModeExecutor, registry, { providerId: options.providerId }),
  }

  return {
    codeModeExecutor,
    nativeTools,
    registry,
    tools: orchestrationMode === 'hybrid' ? { ...nativeTools, ...metaTools } : metaTools,
  }
}
