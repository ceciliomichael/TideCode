import type {
  AppTerminalExecutionMode,
  ChatRuntimeEnvironmentSnapshot,
  ChatMode,
  HiddenUserContext,
  Message,
} from '../types/chat'
import { renderInjectedPrompt } from './injectedPrompts'

export const CHAT_MODE_HIDDEN_CONTEXT_KIND = 'chat_mode'
export const EXECUTION_MODE_HIDDEN_CONTEXT_KIND = 'execution_mode'
export const PYTHON_VENV_HIDDEN_CONTEXT_KIND = 'python_venv'
export const TERMINAL_SHELL_HIDDEN_CONTEXT_KIND = 'terminal_shell'
export const WORKSPACE_INSTRUCTIONS_HIDDEN_CONTEXT_KIND = 'workspace_instructions'
export const WORKSPACE_DURABLE_MEMORY_HIDDEN_CONTEXT_KIND = 'workspace_durable_memory'
export const WORKSPACE_MEMORY_HIDDEN_CONTEXT_KIND = 'workspace_memory'
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
  const content = shell
    ? renderInjectedPrompt('terminalEnvironment', {
        SHELL_LABEL: escapeHiddenUserContextMarkup(shell.label),
        SHELL_COMMAND: escapeHiddenUserContextMarkup(shell.command),
      })
    : renderInjectedPrompt('terminalEnvironmentUnavailable')
  return wrapHiddenUserContext(TERMINAL_SHELL_HIDDEN_CONTEXT_KIND, state, content)
}

function buildPythonVenvHiddenContext(environment: ChatRuntimeEnvironmentSnapshot): HiddenUserContext {
  const venv = environment.pythonVenv
  const state = buildPythonVenvState(environment)
  const venvLabel = venv && venv.relativePath !== venv.name && venv.relativePath !== '.'
    ? `${escapeHiddenUserContextMarkup(venv.name)} (${escapeHiddenUserContextMarkup(venv.relativePath)})`
    : venv ? escapeHiddenUserContextMarkup(venv.name) : null
  const content = venvLabel
    ? renderInjectedPrompt('pythonEnvironment', { VENV_LABEL: venvLabel })
    : renderInjectedPrompt('pythonEnvironmentUnavailable')
  return wrapHiddenUserContext(PYTHON_VENV_HIDDEN_CONTEXT_KIND, state, content)
}

export function buildWorkspaceInstructionsHiddenContext(
  revision: string,
  options: { revisionChanged?: boolean } = {},
): HiddenUserContext {
  return wrapHiddenUserContext(
    WORKSPACE_INSTRUCTIONS_HIDDEN_CONTEXT_KIND,
    revision,
    renderInjectedPrompt(options.revisionChanged ? 'workspaceInstructionsChanged' : 'workspaceInstructions'),
  )
}

export function buildWorkspaceMemoryHiddenContext(input: {
  content?: string | null
  enabled: boolean
  revision?: string | null
}): HiddenUserContext {
  if (!input.enabled) {
    return wrapHiddenUserContext(
      WORKSPACE_MEMORY_HIDDEN_CONTEXT_KIND, 'disabled',
      renderInjectedPrompt('workspaceMemoryDisabled'),
    )
  }
  const content = input.content?.trim() ?? ''
  const state = input.revision ? `enabled:${input.revision}` : 'enabled:missing'
  const memoryIndex = content
    ? renderInjectedPrompt('workspaceMemoryIndex', { INDEX: escapeHiddenUserContextMarkup(content) })
    : renderInjectedPrompt('workspaceMemoryMissing')
  return wrapHiddenUserContext(
    WORKSPACE_MEMORY_HIDDEN_CONTEXT_KIND, state,
    renderInjectedPrompt('workspaceMemoryEnabled', { MEMORY_INDEX: memoryIndex }),
  )
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
  return wrapHiddenUserContext(
    CHAT_MODE_HIDDEN_CONTEXT_KIND, chatMode,
    renderInjectedPrompt(chatMode === 'plan' ? 'planMode' : 'agentMode'),
  )
}

export function buildExecutionModeHiddenContext(
  terminalExecutionMode: AppTerminalExecutionMode,
): HiddenUserContext {
  return wrapHiddenUserContext(
    EXECUTION_MODE_HIDDEN_CONTEXT_KIND, terminalExecutionMode,
    renderInjectedPrompt(terminalExecutionMode === 'sandbox' ? 'executionSandbox' : 'executionFullAccess'),
  )
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
