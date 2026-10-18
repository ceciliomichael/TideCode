import type { ToolSet } from 'ai'
import type { ChatMode, ChatProviderId } from '../../../../src/types/chat'
import type { SkillSummary } from '../../../../src/types/skills'
import type { AgentToolContext } from '../toolTypes'
import { CodeModeExecutor } from '../codeMode/executor'
import { createExecTool, createExecToolSchema } from '../ai/exec/exec'
import { documentNativeApi } from '../ai/registry/documentation'
import { createToolDiscoveryState } from '../ai/registry/sessionDiscovery'
import { createReadApi } from '../ai/tools/read/read'
import { createListApi } from '../ai/tools/list/list'
import { createGlobApi } from '../ai/tools/glob/glob'
import { createGrepApi } from '../ai/tools/grep/grep'
import { createPatchApi } from '../ai/tools/patch/patch'
import { createEditTool } from './editTool'
import { createWriteApi } from '../ai/tools/write/write'
import { createPlanCreateApi } from '../ai/tools/plan/create/create'
import { createSkillListApi } from '../ai/tools/skill/list/list'
import { createSkillSearchApi } from '../ai/tools/skill/search/search'
import { createSkillLoadApi } from '../ai/tools/skill/load/load'
import { createAgentToolRegistry, type AgentToolRegistry } from './registry'
import { createConnectedMcpRegistryTools } from './mcpRegistryTools'
import { createProviderWebTool } from './providerWebTool'
import { createPlanRuntimeState } from './planRuntimeState'
import { createTerminalToolSet } from './terminalTools'
import { createTerminalExecuteApi } from '../ai/tools/terminal/execute/execute'
import { createTerminalReadApi } from '../ai/tools/terminal/read/read'
import { createTerminalInteractApi } from '../ai/tools/terminal/interact/interact'
import { createTerminalTerminateApi } from '../ai/tools/terminal/terminate/terminate'
import { createToolContext } from './workspaceTools'

export interface CreateAgentToolsOptions {
  activePlanPath?: string | null
  chatMode?: ChatMode
  enabledSkills?: SkillSummary[]
  providerId?: ChatProviderId
}

export interface AgentToolBundle {
  codeModeExecutor: CodeModeExecutor
  nativeTools: ToolSet
  registry: AgentToolRegistry
  tools: ToolSet
}

function createAgentToolSet(execTool: ToolSet[string], providerId?: ChatProviderId): ToolSet {
  const tools: ToolSet = { exec: execTool }
  const nativeWeb = createProviderWebTool(providerId)
  if (nativeWeb) tools[nativeWeb.name] = nativeWeb.tool
  return tools
}

export function createAgentToolSchemaSet(providerId?: ChatProviderId): ToolSet {
  return createAgentToolSet(createExecToolSchema(), providerId)
}

/** Code Mode is the sole TideCode provider execution boundary. */
export async function createAgentToolBundle(
  input: AgentToolContext,
  options: CreateAgentToolsOptions = {},
): Promise<AgentToolBundle> {
  const context = await createToolContext(input, options.enabledSkills ?? [])
  const planMode = options.chatMode === 'plan'
  const state = createPlanRuntimeState(planMode, options.activePlanPath)
  const entries: ToolSet = {}

  function register(path: string, definition: ToolSet[string]) {
    if (Object.hasOwn(entries, path)) throw new Error(`Duplicate native API: tools.${path}`)
    entries[path] = documentNativeApi(path, definition)
  }

  register('list', createListApi(context))
  register('read', createReadApi(context))
  register('glob', createGlobApi(context))
  register('grep', createGrepApi(context))

  if (options.enabledSkills?.length) {
    register('skill.list', createSkillListApi(options.enabledSkills))
    register('skill.search', createSkillSearchApi(options.enabledSkills))
    register('skill.load', createSkillLoadApi(context, options.enabledSkills))
  }

  if (planMode) {
    register('plan.create', createPlanCreateApi(context, state))
    register('patch', createPatchApi(context, state))
    register('edit', createEditTool(context, state))
  } else {
    const terminal = createTerminalToolSet({
      ...context,
      conversationId: input.conversationId,
      webContents: input.webContents,
    })
    register('terminal.execute', createTerminalExecuteApi(terminal))
    register('terminal.read', createTerminalReadApi(terminal))
    register('terminal.interact', createTerminalInteractApi(terminal))
    register('terminal.terminate', createTerminalTerminateApi(terminal))
    register('patch', createPatchApi(context, state))
    register('edit', createEditTool(context, state))
    register('write', createWriteApi(context))
  }

  const mcp = planMode ? {} : await createConnectedMcpRegistryTools(input)
  const registry = await createAgentToolRegistry({ ...entries, ...mcp })
  const executor = new CodeModeExecutor(registry, undefined, {
    terminalExecutionMode: planMode ? 'sandbox' : input.terminalExecutionMode,
    workspaceRootPath: input.workspaceRootPath,
    discoveryState: createToolDiscoveryState(
      input.conversationId,
      input.workspaceRootPath,
      options.chatMode ?? 'agent',
      input.terminalExecutionMode ?? 'sandbox',
    ),
  })
  const tools = createAgentToolSet(createExecTool(executor), options.providerId)

  return { codeModeExecutor: executor, nativeTools: entries, registry, tools }
}
