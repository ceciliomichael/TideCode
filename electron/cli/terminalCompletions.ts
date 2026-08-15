import { promises as fs } from 'node:fs'
import path from 'node:path'
import { SLASH_COMMANDS } from './commands'
import type { CompletionItemView } from './terminalView'

const MAX_FILES = 500
const MAX_SCAN_DEPTH = 8
const MAX_VISIBLE_COMPLETIONS = 8
const IGNORED_DIRECTORIES = new Set(['.git', '.idea', '.vscode', 'dist', 'dist-electron', 'node_modules'])

export class TerminalCompletionCatalog {
  private files: CompletionItemView[] = []
  private preloadPromise: Promise<void> | null = null
  private workspaceRoot: string | null = null

  preloadWorkspace(workspaceRoot: string): Promise<void> {
    const normalizedRoot = path.resolve(workspaceRoot)
    if (!this.preloadPromise || this.workspaceRoot !== normalizedRoot) {
      this.workspaceRoot = normalizedRoot
      this.files = []
      this.preloadPromise = this.scanWorkspace(workspaceRoot)
    }
    return this.preloadPromise
  }

  getItems(text: string, cursorIndex: number): readonly CompletionItemView[] {
    const beforeCursor = text.slice(0, Math.max(0, cursorIndex))
    const trimmed = beforeCursor.trimStart()

    if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
      const query = trimmed.toLowerCase()
      return SLASH_COMMANDS
        .filter((command) => `/${command.name}`.startsWith(query) || (command.alias && `/${command.alias}`.startsWith(query)))
        .slice(0, MAX_VISIBLE_COMPLETIONS)
        .map((command) => ({
          value: `/${command.name}`,
          label: `/${command.name}`,
          description: command.description,
        }))
    }

    const mention = /@([a-zA-Z0-9_.\-/]*)$/.exec(beforeCursor)
    if (!mention) return []
    const query = mention[1].toLowerCase()
    return this.files
      .filter((item) => item.value.slice(1).toLowerCase().includes(query))
      .slice(0, MAX_VISIBLE_COMPLETIONS)
  }

  private async scanWorkspace(workspaceRoot: string): Promise<void> {
    const discovered: CompletionItemView[] = []

    const scanDirectory = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_SCAN_DEPTH || discovered.length >= MAX_FILES) return
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])

      for (const entry of entries) {
        if (discovered.length >= MAX_FILES) break
        if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue

        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          await scanDirectory(absolutePath, depth + 1)
          continue
        }
        if (!entry.isFile()) continue

        const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/')
        discovered.push({
          value: `@${relativePath}`,
          label: `@${relativePath}`,
          description: 'workspace file',
        })
      }
    }

    await scanDirectory(workspaceRoot, 0)
    this.files = discovered.sort((left, right) => left.value.localeCompare(right.value))
  }
}
