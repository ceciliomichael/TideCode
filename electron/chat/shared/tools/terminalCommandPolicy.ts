import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AppTerminalExecutionMode } from '../../../../src/types/chat'

const TERMINAL_COMMAND_ALLOWLIST_REPO_PATH = 'electron/chat/shared/tools/terminal-command-allowlist.md'
const WHITESPACE_PATTERN = /\s+/g
const UNSAFE_SHELL_OPERATOR_PATTERN = /[\r\n`|;&<>]/
const COMMENT_LINE_PATTERN = /^#/

let cachedAllowlist: string[] | null = null

function resolveTerminalCommandAllowlistPath() {
  const appRoot = process.env.APP_ROOT?.trim()
  const searchRoots = [appRoot, process.cwd()].filter((value): value is string => Boolean(value))

  for (const root of searchRoots) {
    const candidatePath = path.join(root, TERMINAL_COMMAND_ALLOWLIST_REPO_PATH)
    if (existsSync(candidatePath)) {
      return candidatePath
    }
  }

  return null
}

function readTerminalCommandAllowlistContent() {
  const sourcePath = resolveTerminalCommandAllowlistPath()
  if (sourcePath) {
    return readFileSync(sourcePath, 'utf8')
  }

  throw new Error('Unable to load terminal command allowlist markdown file.')
}

function normalizeTerminalCommandText(value: string) {
  return value.trim().replace(WHITESPACE_PATTERN, ' ').toLowerCase()
}

function isUnsafeShellCommand(command: string) {
  return UNSAFE_SHELL_OPERATOR_PATTERN.test(command)
}

function isAllowlistedCommandPrefix(command: string, allowlistedCommand: string) {
  return (
    command === allowlistedCommand ||
    command.startsWith(`${allowlistedCommand} `) ||
    command.startsWith(`${allowlistedCommand}:`)
  )
}

export function parseTerminalCommandAllowlist(content: string) {
  const commands: string[] = []
  const seenCommands = new Set<string>()

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim()
    if (trimmedLine.length === 0 || COMMENT_LINE_PATTERN.test(trimmedLine)) {
      continue
    }

    const normalizedLine = trimmedLine.replace(WHITESPACE_PATTERN, ' ')
    if (normalizedLine.length === 0 || seenCommands.has(normalizedLine)) {
      continue
    }

    seenCommands.add(normalizedLine)
    commands.push(normalizedLine)
  }

  return commands
}

export function getTerminalCommandAllowlist() {
  if (cachedAllowlist !== null) {
    return cachedAllowlist
  }

  cachedAllowlist = parseTerminalCommandAllowlist(readTerminalCommandAllowlistContent())
  return cachedAllowlist
}

export function isAllowedTerminalCommand(
  command: string,
  terminalExecutionModeOrAllowlist: AppTerminalExecutionMode | readonly string[] = 'sandbox',
  allowlist: readonly string[] = getTerminalCommandAllowlist(),
) {
  const terminalExecutionMode = Array.isArray(terminalExecutionModeOrAllowlist)
    ? 'sandbox'
    : terminalExecutionModeOrAllowlist
  const effectiveAllowlist = Array.isArray(terminalExecutionModeOrAllowlist)
    ? terminalExecutionModeOrAllowlist
    : allowlist
  const normalizedCommand = normalizeTerminalCommandText(command)
  if (normalizedCommand.length === 0) {
    return false
  }

  if (terminalExecutionMode === 'full') {
    return true
  }

  if (isUnsafeShellCommand(command)) {
    return false
  }

  return effectiveAllowlist.some((allowlistedCommand) => {
    const normalizedAllowlistedCommand = normalizeTerminalCommandText(allowlistedCommand)
    return isAllowlistedCommandPrefix(normalizedCommand, normalizedAllowlistedCommand)
  })
}
