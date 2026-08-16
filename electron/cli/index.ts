#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ApiKeyProviderId, ChatMode, ReasoningEffort } from '../../src/types/chat'
import type { CliOptions, CliSessionState } from './types'
import { colors, renderBanner } from './renderer'
import { runHeadlessPrompt } from './headless'
import { startInteractiveRepl } from './repl'
import { startRemoteRelayDaemon } from './remoteDaemon'
import { getTideCodeSystemModels, findSystemModel } from './models'
import { getActiveTerminalScreen } from './terminalScreen'
import { SLASH_COMMANDS } from './commands'
import { initializeCliConversation } from './cliHistory'
import { resolveReasoningEffortTransition } from '../../src/lib/reasoningEffortTransition'
import { getStoredSettings } from '../settings/store'
import { readPipedPrompt, resolveHeadlessPrompt } from './stdinPrompt'
import { TIDECODE_VERSION } from '../appVersion'
import { initializeCliAppRoot } from './appRoot'

initializeCliAppRoot()

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    workspacePath: process.cwd(),
    mode: 'agent',
    terminalExecutionMode: 'full',
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '-p' || arg === '--prompt') {
      options.prompt = args[++i]
    } else if (arg === '-m' || arg === '--model') {
      options.model = args[++i]
    } else if (arg === '--provider') {
      options.provider = args[++i] as ApiKeyProviderId
    } else if (arg === '--mode') {
      options.mode = args[++i] as ChatMode
    } else if (arg === '--continue' || arg === '-c') {
      options.continueId = args[++i]
    } else if (arg === 'resume') {
      options.resume = true
    } else if (arg === 'remote' || arg === '--remote') {
      options.remote = true
    } else if (arg === '--port') {
      options.port = parseInt(args[++i], 10)
    } else if (arg === '-v' || arg === '--version') {
      options.version = true
    } else if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (!arg.startsWith('-') && !options.prompt) {
      if (arg === 'remote') {
        options.remote = true
      } else {
        options.workspacePath = path.resolve(arg)
      }
    }
  }

  return options
}

function showHelp() {
  renderBanner()
  const commandLines = SLASH_COMMANDS.map((command) => {
    const alias = command.alias ? ` (/${command.alias})` : ''
    return `  /${command.name}${alias}`.padEnd(27, ' ') + command.description
  }).join('\n')

  console.log(`
${colors.bold}Usage:${colors.reset}
  tidecode [options] [path]
  tidecode resume
  tidecode -p "prompt" [options]
  tidecode remote [options]

${colors.bold}Options:${colors.reset}
  -p, --prompt <text>     Execute a prompt in headless mode and exit
  -m, --model <id>        Specify model (e.g. claude-3-7-sonnet, gpt-4o, codex)
  --provider <id>         Specify provider (anthropic, openai, google, deepseek, codex)
  --mode <agent|plan>     Execution mode: "agent" (default) or "plan"
  -c, --continue <id>     Resume an existing conversation session directly
  resume                   Open the interactive conversation resume picker
  --remote                Start mobile pairing relay daemon
  --port <number>         Port for remote relay daemon (default: 38472)
  -v, --version           Print TideCode version
  -h, --help              Show this help message

${colors.bold}Interactive Commands (inside TUI):${colors.reset}
${commandLines}
`)
}

async function resolveDefaultProviderAndModel(options: CliOptions): Promise<{
  providerId: ApiKeyProviderId | 'codex'
  modelId: string
  reasoningEffort: ReasoningEffort
}> {
  const snapshot = await getTideCodeSystemModels()

  if (options.model) {
    const match = findSystemModel(snapshot.allModels, options.model, options.provider)
    if (match) {
      return {
        providerId: match.providerId,
        modelId: match.apiModelId,
        reasoningEffort: resolveReasoningEffortTransition({
          currentEffort: snapshot.selectedReasoningEffort,
          defaultEffort: match.defaultReasoningEffort,
          supportedEfforts: match.reasoningEfforts,
        }),
      }
    }
    return {
      providerId: options.provider || snapshot.defaultProviderId,
      modelId: options.model,
      reasoningEffort: snapshot.selectedReasoningEffort,
    }
  }

  return {
    providerId: snapshot.defaultProviderId,
    modelId: snapshot.defaultModelId,
    reasoningEffort: snapshot.selectedReasoningEffort,
  }
}

export async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.version) {
    console.log(`TideCode CLI v${TIDECODE_VERSION}`)
    process.exit(0)
  }

  if (options.help) {
    showHelp()
    process.exit(0)
  }

  const [{ providerId, modelId, reasoningEffort }, storedSettings] = await Promise.all([
    resolveDefaultProviderAndModel(options),
    getStoredSettings(),
  ])

  const state: CliSessionState = {
    conversationId: options.continueId || randomUUID(),
    workspaceRootPath: options.workspacePath || process.cwd(),
    modelId,
    providerId,
    chatMode: options.mode || 'agent',
    terminalExecutionMode: options.terminalExecutionMode || 'full',
    reasoningEffort,
    messages: [],
    isStreaming: false,
    activeStreamId: null,
    compactionLocked: false,
    followUpBehavior: storedSettings.followUpBehavior,
  }

  await initializeCliConversation(state, options.continueId, {
    preserveModelSelection: Boolean(options.model || options.provider),
  })

  if (options.remote) {
    await startRemoteRelayDaemon(state, options.port)
    return
  }

  const pipedPrompt = options.prompt === undefined
    ? await readPipedPrompt(process.stdin)
    : null
  const headlessPrompt = resolveHeadlessPrompt(options.prompt, pipedPrompt)
  if (headlessPrompt) {
    const exitCode = await runHeadlessPrompt(headlessPrompt, state, options)
    process.exit(exitCode)
  }

  // Default to interactive REPL
  await startInteractiveRepl(state, { openResumePicker: options.resume === true })
}

process.on('SIGINT', () => {
  getActiveTerminalScreen()?.stop()
  process.stdout.write('\n')
  process.exit(0)
})

process.on('SIGTERM', () => {
  getActiveTerminalScreen()?.stop()
  process.exit(0)
})

void main().catch((err) => {
  console.error(`\n${colors.red}Fatal Error: ${err instanceof Error ? err.message : String(err)}${colors.reset}`)
  process.exit(1)
})
