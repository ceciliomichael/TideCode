import type {
  AppTerminalExecutionMode,
  ChatRuntimeEnvironmentSnapshot,
  ChatMode,
  HiddenUserContext,
  Message,
} from '../types/chat'

export const CHAT_MODE_HIDDEN_CONTEXT_KIND = 'chat_mode'
export const EXECUTION_MODE_HIDDEN_CONTEXT_KIND = 'execution_mode'
export const PYTHON_VENV_HIDDEN_CONTEXT_KIND = 'python_venv'
export const TERMINAL_SHELL_HIDDEN_CONTEXT_KIND = 'terminal_shell'
export const WORKSPACE_INSTRUCTIONS_HIDDEN_CONTEXT_KIND = 'workspace_instructions'
export const WORKSPACE_INSTRUCTIONS_REVISION_CHANGED_PROMPT =
  'The AGENTS.md revision changed since the last workspace-instructions context. Read the current AGENTS.md again before continuing project work.'

const HIDDEN_USER_CONTEXT_PATTERN =
  /<hidden_user_context\b[^>]*>[\s\S]*?<\/hidden_user_context>/gu
const PARSED_HIDDEN_USER_CONTEXT_PATTERN =
  /<hidden_user_context\b[^>]*\bkind="([^"]+)"[^>]*\bstate="([^"]*)"[^>]*>[\s\S]*?<\/hidden_user_context>/gu

function wrapHiddenUserContext(kind: string, state: string, content: string): HiddenUserContext {
  return {
    content: [
      `<hidden_user_context kind="${kind}" state="${state}">`,
      content,
      '</hidden_user_context>',
    ].join('\n'),
    kind,
    state,
  }
}

function escapeHiddenUserContextMarkup(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function buildTerminalShellState(environment: ChatRuntimeEnvironmentSnapshot) {
  const shell = environment.terminalShell
  return shell
    ? `active:${encodeURIComponent(shell.label)}:${encodeURIComponent(shell.command)}`
    : 'none'
}

function buildPythonVenvState(environment: ChatRuntimeEnvironmentSnapshot) {
  const venv = environment.pythonVenv
  return venv
    ? `active:${encodeURIComponent(venv.name)}:${encodeURIComponent(venv.relativePath)}`
    : 'none'
}

function buildTerminalShellHiddenContext(environment: ChatRuntimeEnvironmentSnapshot): HiddenUserContext {
  const shell = environment.terminalShell
  const state = buildTerminalShellState(environment)
  return wrapHiddenUserContext(TERMINAL_SHELL_HIDDEN_CONTEXT_KIND, state, shell
    ? [
        '<terminal_environment state="active_until_superseded">',
        'This terminal shell context remains active until a later terminal_shell context supersedes it.',
        '- Active terminal shell: ' + escapeHiddenUserContextMarkup(shell.label) + ' (' + escapeHiddenUserContextMarkup(shell.command) + ').',
        '- Write terminal commands using this shell syntax. Do not assume another shell.',
        '</terminal_environment>',
      ].join('\\n')
    : [
        '<terminal_environment state="unavailable_until_superseded">',
        'No active terminal shell is currently resolved. This state remains active until a later terminal_shell context supersedes it.',
        '</terminal_environment>',
      ].join('\\n'))
}

function buildPythonVenvHiddenContext(environment: ChatRuntimeEnvironmentSnapshot): HiddenUserContext {
  const venv = environment.pythonVenv
  const state = buildPythonVenvState(environment)
  const venvLabel = venv && venv.relativePath !== venv.name && venv.relativePath !== '.'
    ? `${escapeHiddenUserContextMarkup(venv.name)} (${escapeHiddenUserContextMarkup(venv.relativePath)})`
    : venv
      ? escapeHiddenUserContextMarkup(venv.name)
      : null
  return wrapHiddenUserContext(PYTHON_VENV_HIDDEN_CONTEXT_KIND, state, venvLabel
    ? [
        '<python_environment state="active_until_superseded">',
        'This Python environment context remains active until a later python_venv context supersedes it.',
        `Python virtual environment activated: ${venvLabel}`,
        '</python_environment>',
      ].join('\\n')
    : [
        '<python_environment state="none_until_superseded">',
        'No Python virtual environment is currently detected for this workspace. This state remains active until a later python_venv context supersedes it.',
        '</python_environment>',
      ].join('\\n'))
}

export function buildWorkspaceInstructionsHiddenContext(
  revision: string,
  options: { revisionChanged?: boolean } = {},
): HiddenUserContext {
  return wrapHiddenUserContext(WORKSPACE_INSTRUCTIONS_HIDDEN_CONTEXT_KIND, revision, [
    '<workspace_instruction_context path="AGENTS.md" state="present">',
    'A root AGENTS.md exists in this workspace. Follow all applicable repository instructions from its current revision.',
    'Read AGENTS.md only if this exact revision has not already been read into the model context. If the same revision is already available from earlier history or tool output, reuse it and do not read the file again.',
    options.revisionChanged
      ? WORKSPACE_INSTRUCTIONS_REVISION_CHANGED_PROMPT
      : 'If the revision changes, read the updated AGENTS.md before continuing project work.',
    '</workspace_instruction_context>',
  ].join('\n'))
}

export function buildWorkspaceInstructionsTransition(input: {
  messages: readonly Message[]
  revision: string | null
}) {
  if (input.revision === null) return []
  const context = buildWorkspaceInstructionsHiddenContext(input.revision)
  return getLatestHiddenUserContextState(
    input.messages,
    WORKSPACE_INSTRUCTIONS_HIDDEN_CONTEXT_KIND,
  ) === context.state
    ? []
    : [context]
}

export function buildChatModeHiddenContext(chatMode: ChatMode): HiddenUserContext {
  if (chatMode === 'plan') {
    return wrapHiddenUserContext(CHAT_MODE_HIDDEN_CONTEXT_KIND, chatMode, [
      '<chat_mode_context mode="plan" state="active_until_superseded">',
      'Plan Mode is active from this message forward until a later chat_mode_context supersedes it.',
      '- This context supersedes every earlier Agent or Plan chat_mode_context.',
      '- Follow all applicable workspace instructions as additional constraints.',
      '- Keep repository discovery read-only. Inspect the relevant source, tests, configuration, documentation, existing plans, and planning context before making recommendations.',
      '- Make the plan goal-oriented. Use Goal as the primary top-level framing for what the plan is trying to achieve, rather than Outcome. Start from the user\'s goal and intended result, then connect each implementation change back to how it helps achieve that goal.',
      '- Build an end-to-end implementation plan detailed enough to act as a strong handoff specification. Give the implementation agent enough repository context and design direction to execute confidently without unnecessary rediscovery, while leaving room for normal low-risk implementation judgment.',
      '- Inspect enough of the repository to identify the files expected to be created, modified, deleted, or moved when repository evidence makes those paths knowable. Prefer exact repository-relative paths, but if a path or implementation detail cannot be determined safely during planning, state that uncertainty instead of inventing it.',
      '- For each known planned file operation, include the repository-relative path and the expected operation: create, modify, delete, or move. Explain what should change there, the intended behavior, why that file is involved, and the important symbols, sections, interfaces, or integration points when useful.',
      '- For moves, deletions, and new files, include the relevant source/destination, reference updates, responsibility changes, or rationale when those details materially help implementation.',
      '- Give a sensible implementation order and note meaningful dependencies between changes. Cover behavior, interfaces, data flow, schemas, state transitions, failure cases, security, compatibility, migration or recovery behavior, and performance implications in proportion to the task.',
      '- Define verification around the goal: identify the tests or checks that should be added, modified, or run, what important behavior they should prove, and the observable acceptance criteria that show the goal has been achieved.',
      '- Favor concrete planning language. Broad phrases such as “update relevant files”, “refactor as needed”, “handle edge cases”, or “add tests” can be used as summaries, but expand them with the concrete files, behavior, rationale, or verification details that are already knowable and useful for handoff.',
      '- Ask a focused question only when a material product or scope judgment cannot be resolved from the workspace.',
      '- Do not implement source changes, run implementation commands, or proceed into implementation while Plan Mode is active. Implementation requires a later Agent Mode turn after user approval.',
      '- Plan Mode tool contract: tools.plan_create({ content: string, title?: string }) creates the canonical plan, and tools.plan_edit({ path: string, content: string, title?: string }) replaces that active plan when revision is needed. Both are intentionally omitted from permanent Code Mode documentation for cache stability; that omission does not mean the APIs are unavailable.',
      '- Do not use tools.tool_search to discover tools.plan_create or tools.plan_edit. tool_search is for connected dynamic capabilities, not hidden local Plan Mode APIs.',
      '- The active plan is the latest successful Plan presentation in conversation history. If no active plan exists, finish read-only discovery and call tools.plan_create when the plan is ready. Do not call tools.plan_edit before an active plan exists.',
      '- Once an active plan exists, do not create another. Use tools.plan_edit only when that exact active plan needs revision, passing its exact path and the complete revised Markdown. A duplicate tools.plan_create call must be treated as invalid.',
      '- Do not call tools.apply_patch in Plan Mode. It is an Agent source-mutation API and is not part of Plan Mode\'s allowed tool set.',
      '- Never mutate source files, tests, configuration, documentation, or other workspace files in Plan Mode. If a mutation API is unavailable, do not substitute another mutation mechanism.',
      '- The permanent Code Mode tool catalog describes the stable superset of TideCode capabilities, not permission for the current mode. The active runtime policy and actual tools object are authoritative for what may be called now.',
      '- Plan Mode runtime policy restricts Code Mode to planning-safe APIs plus plan_create and plan_edit, and enforces the plan-artifact boundary on the host side.',
      '- After a successful plan create or revision, return the normal Plan preview result instead of duplicating the full artifact in chat.',
      '</chat_mode_context>',
    ].join('\n'))
  }

  return wrapHiddenUserContext(CHAT_MODE_HIDDEN_CONTEXT_KIND, chatMode, [
    '<chat_mode_context mode="agent" state="active_until_superseded">',
    'Agent Mode is active from this message forward until a later chat_mode_context supersedes it.',
    '- This context supersedes every earlier Agent or Plan chat_mode_context.',
    '- Follow the latest compatible user request and all applicable workspace instructions.',
    '- Questions, explanations, reviews, diagnoses, and advice requests do not authorize mutation. Clear build, fix, edit, update, migrate, remove, or explicit do-it requests do.',
    '- Resolve low-risk technical choices from current evidence and existing patterns. Ask only when user-owned intent, material risk, irreversible behavior, or new authority is required.',
    '- Read the smallest relevant source before changing it, preserve user work, stay in scope, and avoid unrelated cleanup or speculative refactors.',
    '- When mutation is authorized, implement the complete requested change and run the narrowest decisive verification before reporting completion.',
    '- Use the active provider tool contract as authoritative. When Code Mode is the tool boundary, use its documented inner APIs rather than inventing provider-facing tools.',
    '</chat_mode_context>',
  ].join('\n'))
}

export function buildExecutionModeHiddenContext(
  terminalExecutionMode: AppTerminalExecutionMode,
): HiddenUserContext {
  const details = terminalExecutionMode === 'sandbox'
    ? [
        'Terminal execution mode: sandbox.',
        'Filesystem access is limited to the workspace. A loaded skill may provide a specific skill directory for its own referenced resources.',
      ]
    : [
        'Terminal execution mode: full access.',
        'Filesystem tools and terminal commands may access paths outside the workspace only when required by the user request or a loaded skill.',
      ]
  return wrapHiddenUserContext(EXECUTION_MODE_HIDDEN_CONTEXT_KIND, terminalExecutionMode, [
    `<execution_mode_context mode="${terminalExecutionMode}">`,
    'This execution mode remains active until a later execution_mode_context supersedes it.',
    ...details,
    '</execution_mode_context>',
  ].join('\n'))
}

export function getLatestHiddenUserContextState(
  messages: readonly Message[],
  kind: string,
) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message.role !== 'user') continue
    const contexts = message.hiddenUserContext ?? []
    for (let contextIndex = contexts.length - 1; contextIndex >= 0; contextIndex -= 1) {
      const context = contexts[contextIndex]
      if (context.kind === kind && typeof context.state === 'string' && context.state.length > 0) {
        return context.state
      }
    }
  }
  return null
}

export function buildHiddenUserContextTransitions(input: {
  chatMode: ChatMode
  messages: readonly Message[]
  terminalExecutionMode: AppTerminalExecutionMode
}) {
  const contexts: HiddenUserContext[] = []
  if (getLatestHiddenUserContextState(input.messages, CHAT_MODE_HIDDEN_CONTEXT_KIND) !== input.chatMode) {
    contexts.push(buildChatModeHiddenContext(input.chatMode))
  }
  if (
    getLatestHiddenUserContextState(input.messages, EXECUTION_MODE_HIDDEN_CONTEXT_KIND) !==
    input.terminalExecutionMode
  ) {
    contexts.push(buildExecutionModeHiddenContext(input.terminalExecutionMode))
  }
  return contexts
}

export function buildRuntimeEnvironmentHiddenContextTransitions(input: {
  environment: ChatRuntimeEnvironmentSnapshot
  messages: readonly Message[]
}) {
  const contexts: HiddenUserContext[] = []

  const terminalShellState = buildTerminalShellState(input.environment)
  const previousTerminalShellState = getLatestHiddenUserContextState(
    input.messages,
    TERMINAL_SHELL_HIDDEN_CONTEXT_KIND,
  )
  if (
    previousTerminalShellState !== terminalShellState
    && (input.environment.terminalShell !== null || previousTerminalShellState !== null)
  ) {
    contexts.push(buildTerminalShellHiddenContext(input.environment))
  }

  const pythonVenvState = buildPythonVenvState(input.environment)
  const previousPythonVenvState = getLatestHiddenUserContextState(
    input.messages,
    PYTHON_VENV_HIDDEN_CONTEXT_KIND,
  )
  if (
    previousPythonVenvState !== pythonVenvState
    && (input.environment.pythonVenv !== null || previousPythonVenvState !== null)
  ) {
    contexts.push(buildPythonVenvHiddenContext(input.environment))
  }

  return contexts
}

export function stripHiddenUserContext(value: string) {
  return value
    .replace(HIDDEN_USER_CONTEXT_PATTERN, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function extractHiddenUserContexts(value: string): HiddenUserContext[] {
  return Array.from(value.matchAll(PARSED_HIDDEN_USER_CONTEXT_PATTERN))
    .map((match) => ({
      content: match[0],
      kind: match[1] ?? '',
      state: match[2] ?? '',
    }))
    .filter((context) => context.kind.length > 0)
}
