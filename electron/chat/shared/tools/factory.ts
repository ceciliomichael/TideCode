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
import { createPlanRuntimeState, type PlanRuntimeState } from './planRuntimeState'
import { createPlanToolSet } from './planTools'
import { createSkillTool } from './skillTool'
import { createTerminalToolSet } from './terminalTools'
import { createToolContext } from './workspaceTools'
import { createWriteTool } from './writeTool'

export interface CreateAgentToolsOptions {
  activePlanPath?: string | null
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

interface NativeToolSets {
  allTools: ToolSet
  agentTools: ToolSet
  planTools: ToolSet
  providerTools: ToolSet
}

const CODE_MODE_EXCLUDED_TOOLS = new Set(['mcp_tool_search', 'execute_mcp', 'edit'])

async function createNativeToolSets(
  input: AgentToolContext,
  options: CreateAgentToolsOptions,
  planRuntimeState: PlanRuntimeState,
): Promise<NativeToolSets> {
  const context = await createToolContext(input)
  const enabledSkills = options.enabledSkills ?? []
  const planningSafeTools: ToolSet = {
    list: createListTool(context),
    read: createReadTool(context),
    read_tool_output: createReadToolOutputTool(),
    glob: createGlobTool(context),
    grep: createGrepTool(context),
    ...createKanbanToolSet(context),
  }

  if (enabledSkills.length > 0) {
    planningSafeTools.skill = createSkillTool(context, enabledSkills)
  }

  const providerTools: ToolSet = {}
  const providerWebTool = createProviderWebTool(options.providerId)
  if (providerWebTool) {
    providerTools[providerWebTool.name] = providerWebTool.tool
    planningSafeTools[providerWebTool.name] = providerWebTool.tool
  }

  const planArtifactTools = createPlanToolSet(context, planRuntimeState)
  const applyPatchTool = createApplyPatchTool(context, planRuntimeState)
  const allTools: ToolSet = {
    ...planningSafeTools,
    ...createMcpToolSet(context),
    ...createTerminalToolSet({ ...context, conversationId: input.conversationId, webContents: input.webContents }),
    ...planArtifactTools,
    apply_patch: applyPatchTool,
    edit: createEditTool(context),
    write: createWriteTool(context),
  }
  const agentTools: ToolSet = { ...allTools }
  const planTools: ToolSet = {
    ...planningSafeTools,
    ...planArtifactTools,
  }

  return { agentTools, allTools, planTools, providerTools }
}

function createRuntimePlanState(options: CreateAgentToolsOptions) {
  return createPlanRuntimeState(options.chatMode === 'plan', options.activePlanPath)
}

export async function createNativeAgentTools(
  input: AgentToolContext,
  options: CreateAgentToolsOptions = {},
): Promise<ToolSet> {
  const toolSets = await createNativeToolSets(input, options, createRuntimePlanState(options))
  return options.chatMode === 'plan' ? toolSets.planTools : toolSets.agentTools
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
  const planRuntimeState = createRuntimePlanState(options)
  const toolSets = await createNativeToolSets(input, options, planRuntimeState)
  const nativeTools = options.chatMode === 'plan' ? toolSets.planTools : toolSets.agentTools
  const orchestrationMode = options.orchestrationMode ?? DEFAULT_AGENT_ORCHESTRATION_MODE

  if (orchestrationMode === 'direct') {
    const registry = await createAgentToolRegistry(nativeTools)
    return {
      codeModeExecutor: null,
      nativeTools,
      registry,
      tools: nativeTools,
    }
  }

  const connectedMcpTools = await createConnectedMcpRegistryTools(input)
  const registryTools = Object.fromEntries([
    ...Object.entries(toolSets.allTools).filter(([name]) => !CODE_MODE_EXCLUDED_TOOLS.has(name)),
    ...Object.entries(connectedMcpTools),
  ])
  const baseRegistry = await createAgentToolRegistry(registryTools)

  // Discovery is itself a Code Mode API. Building the final registry in a
  // second pass keeps tool_search backed by the same catalog while avoiding a
  // separate provider-native tool call that some providers treat as terminal.
  const registry = await createAgentToolRegistry({
    ...registryTools,
    tool_search: createToolSearchTool(baseRegistry, {
      dynamicOnly: true,
      onDemandToolNames: options.chatMode === 'agent' ? ['plan_create', 'plan_edit'] : [],
    }),
  })
  // Dynamic MCP functions exist in the sandbox but remain absent from the
  // model-visible documentation until tools.tool_search returns their names.
  // This permits discovery and invocation in one temporary program.
  const preloadedToolNames = registry.entries.map((entry) => entry.name)
  const codeModeExecutor = new CodeModeExecutor(registry, preloadedToolNames, {
    terminalExecutionMode: 'sandbox',
    workspaceRootPath: input.workspaceRootPath,
  })
  const allowedToolNames = options.chatMode === 'plan'
    ? Object.keys(toolSets.planTools).filter((name) => registry.get(name) !== undefined)
    : undefined
  const metaTools: ToolSet = {
    code_mode: createCodeModeTool(codeModeExecutor, registry, {
      allowedToolNames,
      providerId: options.providerId,
    }),
  }

  return {
    codeModeExecutor,
    nativeTools,
    registry,
    tools: orchestrationMode === 'hybrid'
      ? { ...nativeTools, ...metaTools }
      : { ...toolSets.providerTools, ...metaTools },
  }
}
