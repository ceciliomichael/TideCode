import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ChatMode, AppTerminalExecutionMode } from '../../../../../src/types/chat'
import { buildWorkspaceInstructionsRuntimeBlock } from '../workspaceInstructions'
import { getTideCodeRuntimeRoot } from '../../../../runtime/runtimeRoot'

const PROMPT_REPO_PATH = 'electron/chat/shared/ai/prompts/chat'
const SHARED_PROMPT_FILES = [
  { id: 'shared_mindset_prompt', relativePath: 'mindset.md' },
  { id: 'shared_source_quality_prompt', relativePath: 'sourceQuality.md' },
  { id: 'shared_response_prompt', relativePath: 'response.md' },
  { id: 'shared_continuation_prompt', relativePath: 'continuation.md' },
] as const

function readPromptFile(relativePath: string) {
  const promptPath = path.join(getTideCodeRuntimeRoot(), PROMPT_REPO_PATH, relativePath)
  if (!existsSync(promptPath)) {
    throw new Error(`Unable to load chat prompt file: ${relativePath}`)
  }
  const content = readFileSync(promptPath, 'utf8').trim()
  if (!content) throw new Error(`Required chat prompt is empty: ${promptPath}`)
  return content
}

function escapePromptMarkup(content: string) {
  return content
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

let cachedSharedPromptComponents: ChatSystemPromptComponent[] | null = null

const CORE_DECISION_PROMPT = [
  '<decision_priority description="Required order for every model turn">',
  '1. Choose the next action: no tool, inspect, mutate, or verify. Name the fact, change, or check that action must produce.',
  '2. Keep it inside the latest user request, explicit constraints, and the exact `<workspace_root>` value. Questions and diagnosis do not authorize mutation.',
  '3. Use the narrowest exact tool and the smallest complete sequence. Read current state before changing it; keep intermediate data out of the model when possible.',
  '4. Verify the requested result after the final mutation, use failure evidence to choose a different next action, then stop.',
  '</decision_priority>',
].join('\n')

const EXEC_PROMPT = [
  '<exec_rules description="Use the exec contract without duplicating it">',
  '- The only TideCode-owned provider-facing tool is `exec`. Provider-native tools such as `web_search` may also be available when supported.',
  '- Names such as `tools.list` and `tools.terminal.execute` are APIs inside an `exec` program, never provider-facing tool names.',
  '- The `exec` tool description is authoritative for available internal APIs, exact signatures, and execution restrictions.',
  '- Keep each exec program scoped to the smallest complete inspect, mutate, or verify sequence needed for the current decision.',
  '- Never invent or assume a child file path from project conventions. Read a child path only when the user supplied it or a prior tool returned that exact path; otherwise discover it with `tools.list`, `tools.glob`, or `tools.grep` first.',
  '</exec_rules>',
].join('\n')

export interface ChatSystemPromptComponent {
  content: string
  id: string
  section: 'system_contract' | 'workspace_context'
  source: string
}

export interface ChatSystemPromptBreakdown {
  components: ChatSystemPromptComponent[]
  systemPrompt: string
}

function getSharedPromptComponents(): ChatSystemPromptComponent[] {
  if (cachedSharedPromptComponents !== null) {
    return cachedSharedPromptComponents
  }

  const components: ChatSystemPromptComponent[] = []
  for (const { id, relativePath } of SHARED_PROMPT_FILES) {

    const content = readPromptFile(relativePath)

    components.push({
      content,
      id,
      section: 'system_contract',
      source: `electron/chat/shared/ai/prompts/chat/${relativePath}`,
    })
  }

  cachedSharedPromptComponents = components
  return components
}

export function buildChatModeSystemPromptBreakdown(
  _chatMode: ChatMode,
  workspaceRootPath: string,
  options?: {
    terminalExecutionMode?: AppTerminalExecutionMode
  },
): ChatSystemPromptBreakdown {
  void options
  const coreDecisionComponent: ChatSystemPromptComponent = {
    content: CORE_DECISION_PROMPT,
    id: 'core_decision_priority',
    section: 'system_contract',
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const modeComponents: ChatSystemPromptComponent[] = [{
    content: EXEC_PROMPT,
    id: 'exec_contract',
    section: 'system_contract',
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }]
  const systemRuleComponents: ChatSystemPromptComponent[] = [
    coreDecisionComponent,
    ...modeComponents,
...getSharedPromptComponents(),
  ]


  const workspaceRootComponent: ChatSystemPromptComponent = {
    content: [
      '<workspace_root authoritative="true" type="absolute">',
      escapePromptMarkup(workspaceRootPath),
      '</workspace_root>',
    ].join('\n'),
    id: 'workspace_root',
    section: 'workspace_context' as const,
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const workspacePathContractComponent: ChatSystemPromptComponent = {
    content: [
      '<workspace_path_rules>',
      '- Use the exact value inside <workspace_root> as the only workspace root for this turn.',
      '- Prefer paths relative to that root. Use `.` or omit an optional path for the root itself. `@workspace/...` is a stable explicit alias for the same root.',
      '- `@attachments/...` addresses durable files and folders attached to the current chat. It is a virtual read-only root and does not exist inside the user workspace.',
      '- `@tool-output/...` addresses the exact persisted full text of a truncated tool result. Inspect the exact returned path instead of rerunning the original broad tool. Prefer grep first; when reading, follow `next_offset` for later lines and pass `next_cursor` back exactly for oversized single-line fragments. Never restart at the same offset/cursor unless you intentionally need the same page.',
      '- Inspect attachment aliases with read/list/glob/grep. Copy content into the workspace before attempting mutation.',
      '- Durable attachments are references, not pre-read contents. If the user request depends on an attachment\'s contents, inspect the exact `@attachments/...` path before describing, analyzing, comparing, or relying on it. In Code Mode use `tools.read`; never infer attachment contents from the filename or mention text.',
      '- Never guess or construct an absolute path from a project name, display name, process directory, or previous turn. Copy an absolute path only when the user or a tool provided it.',
      '- Follow the path rules in the `exec` tool description. Discover unknown child paths with `tools.list`, `tools.glob`, or `tools.grep` inside an exec program.',
      '- If a path fails, correct the relative child path; do not retry the same guessed absolute path.',
      '</workspace_path_rules>',
    ].join('\n'),
    id: 'workspace_path_contract',
    section: 'workspace_context' as const,
    source: 'electron/chat/shared/prompts/mode/index.ts',
  }
  const workspaceInstructionsContext = buildWorkspaceInstructionsRuntimeBlock()
  const workspaceComponents = [
    workspaceRootComponent,
    workspacePathContractComponent,
    {
      content: workspaceInstructionsContext,
      id: 'workspace_instructions_context',
      section: 'workspace_context' as const,
      source: 'electron/chat/shared/prompts/workspaceInstructions.ts',
    },
  ].filter((component): component is ChatSystemPromptComponent => component !== null)

  const systemRules = systemRuleComponents.map((component) => component.content).join('\n\n')

  const systemContractBlock = [
    '<system_contract priority="highest" description="Read in order: decide, scope, execute, verify, then communicate">',
    systemRules,
    '</system_contract>',
  ].join('\n')
  const workspaceContext = workspaceComponents.map((component) => component.content).join('\n')
  const workspaceContextBlock = [
    '<workspace_context>',
    workspaceContext,
    '</workspace_context>',
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')

  const systemPrompt = [
    systemContractBlock,
    workspaceContextBlock,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n')

  return {
    components: [...systemRuleComponents, ...workspaceComponents],
    systemPrompt,
  }
}

export function buildChatModeSystemPrompt(
  chatMode: ChatMode,
  workspaceRootPath: string,
  options?: {
    terminalExecutionMode?: AppTerminalExecutionMode
  },
) {
  return buildChatModeSystemPromptBreakdown(chatMode, workspaceRootPath, options).systemPrompt
}
