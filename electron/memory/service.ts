import { promises as fs } from 'node:fs'
import path from 'node:path'
import { notifyWorkspaceExplorerChange } from '../workspace/explorerNotifications'
import {
  assertWorkspaceDirectory,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from '../workspace/paths'

export const MEMORY_DIRECTORY = '.tidecode/memory'
export const MEMORY_INDEX_PATH = `${MEMORY_DIRECTORY}/MEMORY.md`
export const MEMORY_FOLDERS_DIRECTORY = `${MEMORY_DIRECTORY}/folders`

const MAX_MEMORY_CONTENT_BYTES = 512 * 1024
const MAX_MEMORY_ENTRIES = 1_000
const MEMORY_PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u
const memoryLocks = new Map<string, Promise<void>>()

export interface MemoryDocument {
  content: string
  path: string
}

export interface MemoryMutationResult extends MemoryDocument {
  operation: 'created' | 'deleted' | 'unchanged' | 'updated'
}

interface MemoryIndexEntry {
  path: string
  title: string
  updatedAt: number
}

interface MemoryMutationInput {
  beforeMutation?: (absolutePath: string) => Promise<void>
  workspaceRootPath: string
}

async function withMemoryLock<T>(workspaceRootPath: string, operation: () => Promise<T>) {
  const previousLock = memoryLocks.get(workspaceRootPath) ?? Promise.resolve()
  let releaseLock: () => void = () => undefined
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  const lockChain = previousLock.then(() => currentLock)
  memoryLocks.set(workspaceRootPath, lockChain)

  try {
    await previousLock
    return await operation()
  } finally {
    releaseLock()
    if (memoryLocks.get(workspaceRootPath) === lockChain) {
      memoryLocks.delete(workspaceRootPath)
    }
  }
}

function normalizeMarkdown(content: string) {
  return `${content.replace(/\r\n?/gu, '\n').trim()}\n`
}

function validateContent(content: string, title?: string) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Memory content must be a non-empty Markdown document.')
  }

  const normalizedTitle = typeof title === 'string' ? title.replace(/\s+/gu, ' ').trim() : ''
  const normalizedContent = normalizeMarkdown(content)
  const titledContent = normalizedTitle.length > 0 && !/^#\s+/mu.test(normalizedContent)
    ? `# ${normalizedTitle}\n\n${normalizedContent}`
    : normalizedContent

  if (Buffer.byteLength(titledContent, 'utf8') > MAX_MEMORY_CONTENT_BYTES) {
    throw new Error(`Memory content must be smaller than ${MAX_MEMORY_CONTENT_BYTES / 1024} KB.`)
  }

  return titledContent
}

export function normalizeMemoryEntryPath(candidatePath: string, workspaceRootPath: string) {
  const trimmedPath = candidatePath.trim()
  if (trimmedPath.length === 0) {
    throw new Error('Memory path must be a workspace-relative or workspace-contained absolute Markdown path.')
  }

  const workspaceRelativePath = path.isAbsolute(trimmedPath)
    ? path.relative(workspaceRootPath, path.resolve(trimmedPath)).replace(/\\/gu, '/')
    : trimmedPath.replace(/\\/gu, '/').replace(/^\.\//u, '')
  const memoryPrefix = `${MEMORY_DIRECTORY}/`
  const relativeMemoryPath = workspaceRelativePath.startsWith(memoryPrefix)
    ? workspaceRelativePath.slice(memoryPrefix.length)
    : workspaceRelativePath
  const segments = relativeMemoryPath.split('/')

  if (segments.length < 3 || segments[0] !== 'folders') {
    throw new Error(`Memory entries must be stored under ${MEMORY_FOLDERS_DIRECTORY}/<folder>/<name>.md.`)
  }
  if (segments.some((segment) => !MEMORY_PATH_SEGMENT_PATTERN.test(segment))) {
    throw new Error('Memory path segments may contain only letters, numbers, periods, underscores, and hyphens.')
  }
  if (!segments.at(-1)?.toLowerCase().endsWith('.md')) {
    throw new Error('Memory entries must use the .md extension.')
  }

  return segments.join('/')
}

function resolveMemoryTarget(workspaceRootPath: string, relativeMemoryPath: string) {
  return getSafeWorkspaceTargetPath(
    workspaceRootPath,
    `${MEMORY_DIRECTORY}/${relativeMemoryPath}`,
  )
}

function resolveIndexTarget(workspaceRootPath: string) {
  return getSafeWorkspaceTargetPath(workspaceRootPath, MEMORY_INDEX_PATH)
}

async function removeEmptyMemoryDirectories(
  workspaceRootPath: string,
  startingDirectoryPath: string,
  beforeMutation?: (absolutePath: string) => Promise<void>,
) {
  const foldersTarget = getSafeWorkspaceTargetPath(workspaceRootPath, MEMORY_FOLDERS_DIRECTORY)
  await assertManagedPathContainsNoSymlink(workspaceRootPath, foldersTarget.absolutePath)

  let currentDirectoryPath = path.resolve(startingDirectoryPath)
  while (currentDirectoryPath !== foldersTarget.absolutePath) {
    const relativePath = path.relative(foldersTarget.absolutePath, currentDirectoryPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return
    }

    await assertManagedPathContainsNoSymlink(workspaceRootPath, currentDirectoryPath)

    let entries: string[]
    try {
      entries = await fs.readdir(currentDirectoryPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        currentDirectoryPath = path.dirname(currentDirectoryPath)
        continue
      }
      throw error
    }

    if (entries.length > 0) {
      return
    }

    await beforeMutation?.(currentDirectoryPath)
    try {
      await fs.rmdir(currentDirectoryPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        currentDirectoryPath = path.dirname(currentDirectoryPath)
        continue
      }
      if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EISDIR') {
        return
      }
      throw error
    }

    currentDirectoryPath = path.dirname(currentDirectoryPath)
  }
}

async function assertManagedPathContainsNoSymlink(workspaceRootPath: string, absolutePath: string) {
  const relativePath = path.relative(workspaceRootPath, absolutePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Managed memory path is outside the workspace.')
  }

  let currentPath = workspaceRootPath
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment)
    try {
      const stats = await fs.lstat(currentPath)
      if (stats.isSymbolicLink()) {
        throw new Error(`Managed memory paths cannot contain symbolic links: ${currentPath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }
  }
}

function extractMemoryTitle(content: string, relativePath: string) {
  const heading = content.match(/^#\s+(.+)$/mu)?.[1]?.trim()
  if (heading) {
    return heading.replaceAll('[', '').replaceAll(']', '')
  }

  const fileName = path.posix.basename(relativePath, '.md')
  return fileName.replace(/[-_]+/gu, ' ').replace(/\b\w/gu, (character) => character.toUpperCase())
}

async function collectMemoryEntries(directoryPath: string, relativeDirectory = 'folders'): Promise<MemoryIndexEntry[]> {
  let entries: Array<import('node:fs').Dirent<string>>
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const collected: MemoryIndexEntry[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      continue
    }

    const absoluteEntryPath = path.join(directoryPath, entry.name)
    const relativeEntryPath = `${relativeDirectory}/${entry.name}`
    if (entry.isDirectory()) {
      collected.push(...await collectMemoryEntries(absoluteEntryPath, relativeEntryPath))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const [content, stats] = await Promise.all([
        fs.readFile(absoluteEntryPath, 'utf8'),
        fs.stat(absoluteEntryPath),
      ])
      collected.push({
        path: relativeEntryPath.replace(/\\/gu, '/'),
        title: extractMemoryTitle(content, relativeEntryPath),
        updatedAt: stats.mtimeMs,
      })
    }

    if (collected.length > MAX_MEMORY_ENTRIES) {
      throw new Error(`Workspace memory cannot contain more than ${MAX_MEMORY_ENTRIES} entries.`)
    }
  }

  return collected
}

function renderMemoryIndex(entries: MemoryIndexEntry[]) {
  const lines = [
    '# TideCode Memory',
    '',
    'Workspace-wide durable memory. Treat entries as potentially stale evidence and verify them against current project state.',
  ]
  const groupedEntries = new Map<string, MemoryIndexEntry[]>()

  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    const folder = path.posix.dirname(entry.path)
    const group = groupedEntries.get(folder) ?? []
    group.push(entry)
    groupedEntries.set(folder, group)
  }

  if (groupedEntries.size === 0) {
    lines.push('', 'No durable memory entries have been recorded yet.')
  } else {
    for (const [folder, folderEntries] of groupedEntries) {
      lines.push('', `## ${folder}`)
      for (const entry of folderEntries) {
        lines.push(`- [${entry.title}](${entry.path}) - updated ${new Date(entry.updatedAt).toISOString()}`)
      }
    }
  }

  return `${lines.join('\n')}\n`
}

async function buildCurrentIndex(workspaceRootPath: string) {
  const foldersTarget = getSafeWorkspaceTargetPath(workspaceRootPath, MEMORY_FOLDERS_DIRECTORY)
  await assertManagedPathContainsNoSymlink(workspaceRootPath, foldersTarget.absolutePath)
  return renderMemoryIndex(await collectMemoryEntries(foldersTarget.absolutePath))
}

async function writeIndexIfChanged(workspaceRootPath: string, beforeMutation?: (absolutePath: string) => Promise<void>) {
  const indexTarget = resolveIndexTarget(workspaceRootPath)
  await assertManagedPathContainsNoSymlink(workspaceRootPath, indexTarget.absolutePath)
  const content = await buildCurrentIndex(workspaceRootPath)
  const previousContent = await fs.readFile(indexTarget.absolutePath, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  })

  if (previousContent !== content) {
    await beforeMutation?.(indexTarget.absolutePath)
    await fs.mkdir(path.dirname(indexTarget.absolutePath), { recursive: true })
    await fs.writeFile(indexTarget.absolutePath, content, 'utf8')
  }

  return { changed: previousContent !== content, content }
}

export async function readMemoryIndex(workspaceRootPathInput: string): Promise<MemoryDocument> {
  const workspaceRootPath = normalizeWorkspacePath(workspaceRootPathInput)
  await assertWorkspaceDirectory(workspaceRootPath)

  return withMemoryLock(workspaceRootPath, async () => {
    const index = await writeIndexIfChanged(workspaceRootPath)
    if (index.changed) {
      notifyWorkspaceExplorerChange(workspaceRootPath)
    }
    return { content: index.content, path: MEMORY_INDEX_PATH }
  })
}

export async function readMemoryEntry(input: { path: string; workspaceRootPath: string }): Promise<MemoryDocument> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const relativeMemoryPath = normalizeMemoryEntryPath(input.path, workspaceRootPath)
  const target = resolveMemoryTarget(workspaceRootPath, relativeMemoryPath)
  await assertManagedPathContainsNoSymlink(workspaceRootPath, target.absolutePath)

  try {
    return {
      content: await fs.readFile(target.absolutePath, 'utf8'),
      path: `${MEMORY_DIRECTORY}/${relativeMemoryPath}`,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Memory entry does not exist: ${MEMORY_DIRECTORY}/${relativeMemoryPath}`)
    }
    throw error
  }
}

export async function writeMemoryEntry(input: MemoryMutationInput & {
  content: string
  path: string
  title?: string
}): Promise<MemoryMutationResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const relativeMemoryPath = normalizeMemoryEntryPath(input.path, workspaceRootPath)
  const content = validateContent(input.content, input.title)

  return withMemoryLock(workspaceRootPath, async () => {
    const target = resolveMemoryTarget(workspaceRootPath, relativeMemoryPath)
    await assertManagedPathContainsNoSymlink(workspaceRootPath, target.absolutePath)
    const previousContent = await fs.readFile(target.absolutePath, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    })
    const operation = previousContent === null ? 'created' : previousContent === content ? 'unchanged' : 'updated'

    if (operation !== 'unchanged') {
      await input.beforeMutation?.(target.absolutePath)
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true })
      await fs.writeFile(target.absolutePath, content, 'utf8')
    }
    const index = await writeIndexIfChanged(workspaceRootPath, input.beforeMutation)
    if (operation !== 'unchanged' || index.changed) {
      notifyWorkspaceExplorerChange(workspaceRootPath)
    }

    return {
      content,
      operation,
      path: `${MEMORY_DIRECTORY}/${relativeMemoryPath}`,
    }
  })
}

export async function editMemoryEntry(input: MemoryMutationInput & {
  newText: string
  oldText: string
  path: string
}): Promise<MemoryMutationResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const relativeMemoryPath = normalizeMemoryEntryPath(input.path, workspaceRootPath)
  if (typeof input.oldText !== 'string' || input.oldText.length === 0) {
    throw new Error('Memory edit old text must be a non-empty string.')
  }
  if (typeof input.newText !== 'string') {
    throw new Error('Memory edit new text must be a string.')
  }

  return withMemoryLock(workspaceRootPath, async () => {
    const target = resolveMemoryTarget(workspaceRootPath, relativeMemoryPath)
    await assertManagedPathContainsNoSymlink(workspaceRootPath, target.absolutePath)
    const previousContent = await fs.readFile(target.absolutePath, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Memory entry does not exist: ${MEMORY_DIRECTORY}/${relativeMemoryPath}`)
      }
      throw error
    })

    const firstMatchIndex = previousContent.indexOf(input.oldText)
    if (firstMatchIndex < 0) {
      throw new Error('Memory edit old text was not found.')
    }
    if (previousContent.indexOf(input.oldText, firstMatchIndex + input.oldText.length) >= 0) {
      throw new Error('Memory edit old text matches more than once; provide a unique block.')
    }

    const revisedContent = `${previousContent.slice(0, firstMatchIndex)}${input.newText}${previousContent.slice(firstMatchIndex + input.oldText.length)}`
    const content = validateContent(revisedContent)
    const operation = content === previousContent ? 'unchanged' : 'updated'
    if (operation !== 'unchanged') {
      await input.beforeMutation?.(target.absolutePath)
      await fs.writeFile(target.absolutePath, content, 'utf8')
    }
    const index = await writeIndexIfChanged(workspaceRootPath, input.beforeMutation)
    if (operation !== 'unchanged' || index.changed) {
      notifyWorkspaceExplorerChange(workspaceRootPath)
    }

    return {
      content,
      operation,
      path: `${MEMORY_DIRECTORY}/${relativeMemoryPath}`,
    }
  })
}

export async function forgetMemoryEntry(input: MemoryMutationInput & { path: string }): Promise<MemoryMutationResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const relativeMemoryPath = normalizeMemoryEntryPath(input.path, workspaceRootPath)

  return withMemoryLock(workspaceRootPath, async () => {
    const target = resolveMemoryTarget(workspaceRootPath, relativeMemoryPath)
    await assertManagedPathContainsNoSymlink(workspaceRootPath, target.absolutePath)
    const previousContent = await fs.readFile(target.absolutePath, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    })

    if (previousContent === null) {
      throw new Error(`Memory entry does not exist: ${MEMORY_DIRECTORY}/${relativeMemoryPath}`)
    }

    await input.beforeMutation?.(target.absolutePath)
    await fs.unlink(target.absolutePath)
    await removeEmptyMemoryDirectories(workspaceRootPath, path.dirname(target.absolutePath), input.beforeMutation)
    await writeIndexIfChanged(workspaceRootPath, input.beforeMutation)
    notifyWorkspaceExplorerChange(workspaceRootPath)

    return {
      content: previousContent,
      operation: 'deleted',
      path: `${MEMORY_DIRECTORY}/${relativeMemoryPath}`,
    }
  })
}
