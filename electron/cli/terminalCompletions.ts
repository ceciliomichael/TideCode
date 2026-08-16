import path from 'node:path'
import { getAvailableSlashCommands } from './commands'
import type { CliSessionState } from './types'
import type { CompletionItemView } from './terminalView'
import { listWorkspaceDirectory } from '../workspace/explorer'
import { listEnabledSkills } from '../skills/service'

const MAX_SCANNED_FILES = 10000
const MAX_SCANNED_DIRECTORIES = 1000
const MAX_VISIBLE_COMPLETIONS = 8

interface MentionCompletionItem extends CompletionItemView {
  searchPath: string
  searchLabel: string
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/')
}

function basename(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  const segments = normalized.split('/').filter(Boolean)
  return segments.at(-1) ?? normalized
}

function normalizeSearchValue(value: string): string {
  return normalizeRelativePath(value).toLowerCase()
}

function compactSearchValue(value: string): string {
  return normalizeSearchValue(value).replace(/[.\s_-]+/gu, '')
}

function scoreMentionResult(relativePath: string, query: string, label = basename(relativePath)) {
  const normalizedPath = normalizeSearchValue(relativePath)
  const normalizedBasename = basename(relativePath).toLowerCase()
  const normalizedLabel = normalizeSearchValue(label)
  const pathWithoutExtension = normalizedPath.replace(/\.[^./\\]+$/u, '')
  const compactQuery = compactSearchValue(query)
  const compactLabel = compactSearchValue(normalizedLabel)
  const compactBasename = compactSearchValue(pathWithoutExtension.split('/').pop() ?? normalizedBasename)
  const compactPath = compactSearchValue(pathWithoutExtension)

  if (query.length === 0) return [0, normalizedPath.length] as const
  if (normalizedLabel === query) return [1, normalizedLabel.length] as const
  if (normalizedLabel.startsWith(query)) return [2, normalizedLabel.length] as const
  if (compactQuery && compactLabel === compactQuery) return [2, normalizedLabel.length] as const
  if (compactQuery && compactLabel.startsWith(compactQuery)) return [3, normalizedLabel.length] as const
  if (normalizedLabel.includes(query)) return [4, normalizedLabel.length] as const
  if (compactQuery && compactLabel.includes(compactQuery)) return [5, normalizedLabel.length] as const
  if (normalizedBasename === query) return [3, normalizedPath.length] as const
  if (normalizedBasename.startsWith(query)) return [4, normalizedPath.length] as const
  if (compactQuery && compactBasename === compactQuery) return [2, normalizedPath.length] as const
  if (compactQuery && compactBasename.startsWith(compactQuery)) return [3, normalizedPath.length] as const
  if (normalizedPath.endsWith(`/${query}`)) return [3, normalizedPath.length] as const
  if (normalizedPath.includes(query)) return [4, normalizedPath.length] as const
  if (compactQuery && compactPath.includes(compactQuery)) return [5, normalizedPath.length] as const
  return null
}

export class TerminalCompletionCatalog {
  private mentions: MentionCompletionItem[] = []
  private preloadPromise: Promise<void> | null = null
  private workspaceRoot: string | null = null

  preloadWorkspace(workspaceRoot: string): Promise<void> {
    const normalizedRoot = path.resolve(workspaceRoot)
    if (!this.preloadPromise || this.workspaceRoot !== normalizedRoot) {
      this.workspaceRoot = normalizedRoot
      this.mentions = []
      this.preloadPromise = this.scanWorkspace(normalizedRoot)
    }
    return this.preloadPromise
  }

  getItems(text: string, cursorIndex: number, state?: CliSessionState): readonly CompletionItemView[] {
    const beforeCursor = text.slice(0, Math.max(0, cursorIndex))
    const trimmed = beforeCursor.trimStart()

    if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
      const query = trimmed.toLowerCase()
      const commands = getAvailableSlashCommands(state)
      return commands
        .filter((command) => `/${command.name}`.startsWith(query) || (command.alias && `/${command.alias}`.startsWith(query)))
        .slice(0, MAX_VISIBLE_COMPLETIONS)
        .map((command) => ({
          value: `/${command.name}`,
          label: `/${command.name}`,
          description: command.description,
        }))
    }

    const mention = /@([^\s]*)$/u.exec(beforeCursor)
    if (!mention) return []
    const query = normalizeSearchValue(mention[1])

    return this.mentions
      .map((item) => {
        const score = scoreMentionResult(item.searchPath, query, item.searchLabel)
        return score ? { item, score } : null
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => {
        if (left.score[0] !== right.score[0]) return left.score[0] - right.score[0]
        if (left.score[1] !== right.score[1]) return left.score[1] - right.score[1]
        return (left.item.description ?? '').localeCompare(right.item.description ?? '', undefined, { sensitivity: 'base' })
      })
      .slice(0, MAX_VISIBLE_COMPLETIONS)
      .map(({ item }) => item)
  }

  private async scanWorkspace(workspaceRoot: string): Promise<void> {
    const discovered: MentionCompletionItem[] = []
    const seenDirectories = new Set<string>()
    let fileCount = 0
    let directoryCount = 0

    const visitDirectory = async (relativePath?: string): Promise<void> => {
      if (fileCount >= MAX_SCANNED_FILES || directoryCount >= MAX_SCANNED_DIRECTORIES) return
      const directoryKey = normalizeRelativePath(relativePath?.trim() || '.')
      if (seenDirectories.has(directoryKey)) return
      seenDirectories.add(directoryKey)
      if (directoryKey !== '.') directoryCount += 1

      const entries = await listWorkspaceDirectory({
        workspaceRootPath: workspaceRoot,
        relativePath: directoryKey === '.' ? undefined : directoryKey,
      }).catch(() => [])

      for (const entry of entries) {
        if (fileCount >= MAX_SCANNED_FILES || directoryCount >= MAX_SCANNED_DIRECTORIES) break
        const normalizedPath = normalizeRelativePath(entry.relativePath)
        const label = basename(normalizedPath)
        if (entry.isDirectory) {
          discovered.push({
            value: `@${label}`,
            label: `@${label}`,
            description: `folder · ${normalizedPath}`,
            mentionKind: 'folder',
            mentionPath: `list:${normalizedPath}`,
            searchLabel: label,
            searchPath: normalizedPath,
          })
          await visitDirectory(normalizedPath)
        } else {
          fileCount += 1
          discovered.push({
            value: `@${label}`,
            label: `@${label}`,
            description: `file · ${normalizedPath}`,
            mentionKind: 'file',
            mentionPath: `read:${normalizedPath}`,
            searchLabel: label,
            searchPath: normalizedPath,
          })
        }
      }
    }

    await visitDirectory()

    const skills = await listEnabledSkills(workspaceRoot).catch(() => [])
    for (const skill of skills) {
      discovered.push({
        value: `@${skill.name}`,
        label: `@${skill.name}`,
        description: `skill · ${skill.description || 'Skill pack'}`,
        mentionKind: 'skill',
        mentionPath: `load_skill:${skill.name}`,
        searchLabel: skill.name,
        searchPath: `load_skill:${skill.name}`,
      })
    }

    this.mentions = discovered
  }
}
