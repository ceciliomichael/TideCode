import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { MentionMatch, ParsedMention } from './types'

const execFileAsync = promisify(execFile)

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  '.tidecode',
  '.next',
  '.nuxt',
  'coverage',
  'build',
  'release',
])

const MAX_SCAN_DEPTH = 6
const MAX_SCAN_FILES = 2000

export class WorkspaceMentionIndexer {
  private workspaceRoot: string
  private cachedFiles: MentionMatch[] = []
  private lastIndexedAt = 0

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot)
  }

  async refreshIndex(): Promise<MentionMatch[]> {
    if (Date.now() - this.lastIndexedAt < 10_000 && this.cachedFiles.length > 0) {
      return this.cachedFiles
    }

    const results: MentionMatch[] = []
    await this.scanDirectory(this.workspaceRoot, '', 0, results)
    this.cachedFiles = results
    this.lastIndexedAt = Date.now()
    return results
  }

  private async scanDirectory(
    currentDir: string,
    relativePrefix: string,
    depth: number,
    results: MentionMatch[],
  ) {
    if (depth > MAX_SCAN_DEPTH || results.length >= MAX_SCAN_FILES) {
      return
    }

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env') {
          if (entry.isDirectory() && entry.name === '.git') continue
        }
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue
        }

        const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
        const absolutePath = path.join(currentDir, entry.name)

        if (entry.isDirectory()) {
          results.push({
            relativePath: `${relativePath}/`,
            absolutePath,
            isDirectory: true,
            label: `${relativePath}/`,
          })
          await this.scanDirectory(absolutePath, relativePath, depth + 1, results)
        } else if (entry.isFile()) {
          results.push({
            relativePath,
            absolutePath,
            isDirectory: false,
            label: relativePath,
          })
        }
      }
    } catch {
      // Ignore unreadable dirs
    }
  }

  async searchMentions(query: string): Promise<MentionMatch[]> {
    const files = await this.refreshIndex()
    const cleanQuery = query.startsWith('@') ? query.slice(1).toLowerCase().trim() : query.toLowerCase().trim()

    if (!cleanQuery) {
      return files.slice(0, 15)
    }

    return files
      .filter((file) => file.relativePath.toLowerCase().includes(cleanQuery))
      .slice(0, 15)
  }
}

export function parseMentions(input: string): ParsedMention[] {
  const mentionRegex = /@([a-zA-Z0-9_\-\.\/]+)(?::(\d+)(?:-(\d+))?)?/g
  const mentions: ParsedMention[] = []
  let match: RegExpExecArray | null

  while ((match = mentionRegex.exec(input)) !== null) {
    const raw = match[0]
    const target = match[1]
    const startLine = match[2] ? parseInt(match[2], 10) : undefined
    const endLine = match[3] ? parseInt(match[3], 10) : startLine

    if (target === 'git' || target === 'diff' || target === 'staged' || target === 'problems') {
      mentions.push({
        raw,
        filePath: target,
        isSpecial: true,
        specialType: target as 'diff' | 'staged' | 'git' | 'problems',
      })
    } else {
      mentions.push({
        raw,
        filePath: target,
        startLine,
        endLine,
        isSpecial: false,
      })
    }
  }

  return mentions
}

export async function expandMentionsIntoContext(
  input: string,
  workspaceRoot: string,
): Promise<{ expandedText: string; attachments: string[] }> {
  const mentions = parseMentions(input)
  if (mentions.length === 0) {
    return { expandedText: input, attachments: [] }
  }

  const attachments: string[] = []
  let processedText = input

  for (const mention of mentions) {
    if (mention.isSpecial) {
      if (mention.specialType === 'diff' || mention.specialType === 'git') {
        try {
          const { stdout } = await execFileAsync('git', ['diff'], { cwd: workspaceRoot })
          if (stdout.trim()) {
            attachments.push(`### Uncommitted Git Diff:\n\`\`\`diff\n${stdout}\n\`\`\``)
          }
        } catch {
          // ignore git failure
        }
      } else if (mention.specialType === 'staged') {
        try {
          const { stdout } = await execFileAsync('git', ['diff', '--cached'], { cwd: workspaceRoot })
          if (stdout.trim()) {
            attachments.push(`### Staged Git Diff:\n\`\`\`diff\n${stdout}\n\`\`\``)
          }
        } catch {
          // ignore git failure
        }
      }
      continue
    }

    try {
      const fullPath = path.resolve(workspaceRoot, mention.filePath)
      const stats = await fs.stat(fullPath)

      if (stats.isFile()) {
        const fileContent = await fs.readFile(fullPath, 'utf8')
        if (mention.startLine !== undefined) {
          const lines = fileContent.split('\n')
          const sliceStart = Math.max(0, mention.startLine - 1)
          const sliceEnd = mention.endLine !== undefined ? mention.endLine : lines.length
          const slicedContent = lines.slice(sliceStart, sliceEnd).join('\n')
          attachments.push(
            `### Mentioned File: ${mention.filePath} (lines ${mention.startLine}-${mention.endLine ?? lines.length})\n\`\`\`\n${slicedContent}\n\`\`\``,
          )
        } else {
          attachments.push(`### Mentioned File: ${mention.filePath}\n\`\`\`\n${fileContent}\n\`\`\``)
        }
      } else if (stats.isDirectory()) {
        const entries = await fs.readdir(fullPath)
        attachments.push(`### Mentioned Directory: ${mention.filePath}/\n${entries.map((e) => `- ${e}`).join('\n')}`)
      }
    } catch {
      // File could not be read; model will search using tools
    }
  }

  if (attachments.length > 0) {
    processedText = `${input}\n\n---\n**Included Context from @ mentions:**\n\n${attachments.join('\n\n')}`
  }

  return { expandedText: processedText, attachments }
}
