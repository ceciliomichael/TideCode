import type { ChatMode, ChatProviderId, ReasoningEffort } from '../../src/types/chat'
import { isReasoningEffort } from '../../src/lib/reasoningEffort'
import type { CliSessionState, SlashCommandDefinition, SlashCommandHelpers } from './types'
import { listConversationRecords } from '../history/conversationFileStore'
import { readPrunedFolderStore } from '../history/folderStore'
import { colors } from './renderer'
import { getTideCodeSystemModels, findSystemModel, getConfiguredProviderModels } from './models'
import type { SelectItem } from './interactiveSelect'
import { buildResumeConversationSections } from './resumeCatalog'
import { buildTerminalReasoningEffortItems } from './terminalReasoningEffort'
import { runCliSettingsCommand } from './cliSettingsCommand'
import { runCliSkillsCommand } from './cliSkillsCommand'
import { runCliMcpCommand } from './cliMcpCommand'
import { runCliUpdateCommand } from './cliUpdateCommand'

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    name: 'settings',
    description: 'Configure settings shared with the TideCode desktop app',
    usage: '/settings',
    execute: async (_args, state, helpers) => runCliSettingsCommand(state, helpers),
  },
  {
    name: 'mcp',
    description: 'Enable or disable MCP servers and their tools',
    usage: '/mcp',
    execute: async (_args, state, helpers) => runCliMcpCommand(state, helpers),
  },
  {
    name: 'skills',
    description: 'Enable or disable skills available to TideCode',
    usage: '/skills',
    execute: async (_args, state, helpers) => runCliSkillsCommand(state, helpers),
  },
  {
    name: 'update',
    description: 'Check, download, and install the latest TideCode desktop release',
    usage: '/update',
    execute: async (_args, _state, helpers) => runCliUpdateCommand(helpers),
  },
  {
    name: 'exit',
    alias: 'quit',
    description: 'Exit TideCode CLI and restore the terminal',
    usage: '/exit',
    execute: async (_args, _state, helpers) => {
      helpers.exit()
    },
  },
  {
    name: 'model',
    alias: 'm',
    description: 'Browse and switch LLM models from the TideCode catalog & custom models',
    usage: '/model [modelId] [providerId]',
    execute: async (args, state, helpers) => {
      const snapshot = await getTideCodeSystemModels()
      const selectableModels = getConfiguredProviderModels(snapshot)

      if (args.length > 0) {
        const query = args[0]
        const targetProvider = args[1]
        const match = findSystemModel(selectableModels, query, targetProvider)

        if (!match) {
          helpers.renderError(`Model "${query}" was not found among configured providers.`)
          return
        }

        await helpers.switchModel(match.apiModelId, match.providerId)
        return
      }

      // Interactive Model Picker
      if (selectableModels.length === 0) {
        helpers.renderWarning('No configured model providers are available. Configure a provider in the desktop app first.')
        return
      }

      const items: SelectItem<{ modelId: string; providerId: ChatProviderId }>[] = selectableModels.map((m) => {
        const isCurrent =
          m.apiModelId.toLowerCase() === state.modelId.toLowerCase() &&
          m.providerId.toLowerCase() === state.providerId.toLowerCase()

        const providerBadge = m.isCustom
          ? `${colors.yellow}[${m.providerLabel} (custom)]${colors.reset}`
          : `${colors.cyan}[${m.providerLabel}]${colors.reset}`

        return {
          value: { modelId: m.apiModelId, providerId: m.providerId as ChatProviderId },
          label: m.apiModelId,
          description: `${m.label}${m.reasoningCapable ? ' [reasoning]' : ''}`,
          badge: providerBadge,
          isCurrent,
        }
      })

      const currentIndex = items.findIndex((i) => i.isCurrent)
      const selected = await helpers.select<{ modelId: string; providerId: ChatProviderId }>({
        title: 'Select LLM Model',
        items,
        initialIndex: currentIndex >= 0 ? currentIndex : 0,
        pageSize: 6,
      })

      if (selected) {
        await helpers.switchModel(selected.modelId, selected.providerId)
      }
    },
  },
  {
    name: 'effort',
    alias: 'e',
    description: 'View or change the current model reasoning effort, synced with desktop',
    usage: '/effort [level]',
    execute: async (args, state, helpers) => {
      const snapshot = await getTideCodeSystemModels()
      const model = findSystemModel(snapshot.allModels, state.modelId, state.providerId)
      if (!model) {
        helpers.renderError(`Could not resolve reasoning settings for ${state.modelId}.`)
        return
      }

      const items = buildTerminalReasoningEffortItems(model, state.reasoningEffort)
      if (items.length === 0) {
        helpers.renderInfo(`${model.label} does not expose configurable reasoning effort.`)
        return
      }

      if (args.length > 0) {
        const requestedEffort = args[0].toLowerCase()
        const supportedEfforts = items.map((item) => item.value)
        if (!isReasoningEffort(requestedEffort) || !supportedEfforts.includes(requestedEffort)) {
          helpers.renderError(`Unsupported effort for ${model.label}. Choose: ${supportedEfforts.join(', ')}.`)
          return
        }
        await helpers.switchReasoningEffort(requestedEffort, model.label)
        return
      }

      const currentIndex = items.findIndex((item) => item.isCurrent)
      const selected = await helpers.select<ReasoningEffort>({
        title: `Reasoning Effort · ${model.label}`,
        items,
        initialIndex: currentIndex >= 0 ? currentIndex : 0,
        pageSize: 7,
        footer: `Current: ${state.reasoningEffort}`,
      })
      if (selected) await helpers.switchReasoningEffort(selected, model.label)
    },
  },
  {
    name: 'plan',
    description: 'Switch to Plan mode for read-only architectural analysis (or toggle back to Agent mode)',
    usage: '/plan',
    execute: async (_args, state, helpers) => {
      const nextMode = state.chatMode === 'plan' ? 'agent' : 'plan'
      helpers.switchMode(nextMode)
    },
  },
  {
    name: 'agent',
    description: 'Switch to Agent mode for autonomous file edits and tools',
    usage: '/agent',
    execute: async (_args, _state, helpers) => {
      helpers.switchMode('agent')
    },
  },
  {
    name: 'mode',
    description: 'Toggle between agent mode (file edits/tools) and plan mode (read-only architectural planning)',
    usage: '/mode [agent|plan]',
    execute: async (args, state, helpers) => {
      if (args.length > 0) {
        const targetMode = args[0].toLowerCase() as ChatMode
        if (targetMode !== 'agent' && targetMode !== 'plan') {
          helpers.renderError('Invalid mode. Choose either "agent" or "plan".')
          return
        }
        helpers.switchMode(targetMode)
        return
      }

      // Toggle directly or pick
      const nextMode = state.chatMode === 'plan' ? 'agent' : 'plan'
      helpers.switchMode(nextMode)
    },
  },
  {
    name: 'resume',
    alias: 'r',
    description: 'Browse and resume prior conversation sessions with project origin tags',
    usage: '/resume [conversationId]',
    execute: async (args, _state, helpers) => {
      if (args.length > 0) {
        const targetId = args[0]
        const success = await helpers.loadSession(targetId)
        if (!success) {
          helpers.renderError(`Could not find conversation with ID ${targetId}`)
        }
        return
      }

      try {
        const [records, folders] = await Promise.all([
          listConversationRecords(),
          readPrunedFolderStore(),
        ])

        if (records.length === 0) {
          helpers.renderInfo('No saved conversations found.')
          return
        }

        const sections = buildResumeConversationSections(records, folders)

        const selectedId = await helpers.select<string>({
          title: 'Resume Conversation',
          sections,
          pageSize: 10,
        })

        if (selectedId) {
          await helpers.loadSession(selectedId)
        }
      } catch (error) {
        helpers.renderError(`Failed to load sessions: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  },
  {
    name: 'compact',
    description: 'Condense current conversation context into a compacted state summary (Plan 001)',
    usage: '/compact',
    execute: async (_args, _state, helpers) => {
      const confirmed = await helpers.confirm('Compact conversation context to free token window?', true)
      if (confirmed) {
        await helpers.compactHistory()
      }
    },
  },
  {
    name: 'undo',
    description: 'Revert file changes made during the last agent turn (Checkpoints)',
    usage: '/undo',
    execute: async (_args, _state, helpers) => {
      const confirmed = await helpers.confirm('Revert file modifications made during the last turn?', true)
      if (confirmed) {
        await helpers.undoLastTurn()
      }
    },
  },
  {
    name: 'diff',
    description: 'View colorized git diff of uncommitted workspace changes',
    usage: '/diff',
    execute: async (_args, _state, helpers) => {
      await helpers.renderDiff('')
    },
  },
  {
    name: 'remote',
    description: 'Start mobile pairing daemon to steer agent from phone',
    usage: '/remote',
    execute: async (_args, _state, helpers) => {
      const selected = await helpers.select<'start' | 'cancel'>({
        title: 'Remote Relay Interface',
        items: [
          {
            value: 'start',
            label: 'Start Remote Relay Server',
            description: 'Launch local daemon for pairing with mobile phone / browser client',
          },
          {
            value: 'cancel',
            label: 'Cancel',
            description: 'Return to interactive chat',
          },
        ],
      })

      if (selected === 'start') {
        await helpers.startRemoteDaemon()
      }
    },
  },
  {
    name: 'clear',
    alias: 'new',
    description: 'Clear current conversation and start fresh in this workspace',
    usage: '/clear',
    execute: async (_args, _state, helpers) => {
      const confirmed = await helpers.confirm('Clear current conversation and start a new session?', true)
      if (confirmed) {
        await helpers.clearSession()
      }
    },
  },
  {
    name: 'help',
    alias: 'h',
    description: 'Show available slash commands and mention shortcuts',
    usage: '/help',
    execute: async (_args, _state, helpers) => {
      const items: SelectItem<string>[] = SLASH_COMMANDS.map((cmd) => ({
        value: cmd.name,
        label: `/${cmd.name}${cmd.alias ? ` (/${cmd.alias})` : ''}`,
        description: cmd.description,
      }))

      const chosenCommand = await helpers.select<string>({
        title: 'TideCode CLI Commands',
        items,
        pageSize: 10,
        footer: 'Select a command to execute it directly, or Esc to close',
      })

      if (chosenCommand) {
        const cmd = SLASH_COMMANDS.find((c) => c.name === chosenCommand)
        if (cmd) {
          await cmd.execute([], _state, helpers)
        }
      }
    },
  },
]

export async function executeSlashCommand(
  rawInput: string,
  state: CliSessionState,
  helpers: SlashCommandHelpers,
): Promise<boolean> {
  const trimmed = rawInput.trim()
  if (!trimmed.startsWith('/')) {
    return false
  }

  const parts = trimmed.slice(1).split(/\s+/)
  const commandName = parts[0].toLowerCase()
  const args = parts.slice(1)

  const command = SLASH_COMMANDS.find((c) => c.name === commandName || c.alias === commandName)
  if (!command) {
    helpers.renderError(`Unknown command: /${commandName}. Type /help for available commands.`)
    return true
  }

  await command.execute(args, state, helpers)
  return true
}
