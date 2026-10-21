import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMemoryDetailMetadata } from './detailDocument'

const MAX_CACHED_WORKSPACES = 4
const MAX_MEMORY_ENTRIES = 1_000
const MAX_FRONTMATTER_BYTES = 8 * 1024
const READ_CHUNK_BYTES = 512
const SCAN_CONCURRENCY = 8

export interface MemoryIndexEntry {
  path: string
  title: string
  description: string
}

interface CachedEntry {
  revision: string
  entry: MemoryIndexEntry
}

const catalogs = new Map<string, Map<string, CachedEntry>>()

function pathKey(absolutePath: string) {
  const normalized = path.resolve(absolutePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function readFrontmatter(absolutePath: string, fileSize: bigint) {
  const handle = await fs.open(absolutePath, 'r')
  try {
    const buffer = Buffer.alloc(MAX_FRONTMATTER_BYTES)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, READ_CHUNK_BYTES, length)
      length += bytesRead
      const content = buffer.subarray(0, length).toString('utf8')
      const normalized = content.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
      if (!normalized.startsWith('---\n')) {
        return null
      }
      const reachedEnd = BigInt(length) >= fileSize
      if (/\n---\n/u.test(normalized.slice(4)) || (reachedEnd && /\n---$/u.test(normalized))) {
        return parseMemoryDetailMetadata(content)
      }
      if (bytesRead === 0) {
        return null
      }
    }
    return null
  } finally {
    await handle.close()
  }
}

async function discoverFiles(directory: string, files: string[] = []): Promise<string[]> {
  let children
  try {
    children = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return files
    }
    throw error
  }
  for (const child of children) {
    const absolutePath = path.join(directory, child.name)
    if (child.isDirectory()) {
      await discoverFiles(absolutePath, files)
    } else if (child.isFile() && child.name.toLowerCase().endsWith('.md')) {
      files.push(absolutePath)
      if (files.length > MAX_MEMORY_ENTRIES) {
        throw new Error(`Workspace memory cannot contain more than ${MAX_MEMORY_ENTRIES} entries.`)
      }
    }
  }
  return files
}

async function readEntry(absolutePath: string, detailsRoot: string, previous?: CachedEntry): Promise<CachedEntry | null> {
  try {
    const stats = await fs.lstat(absolutePath, { bigint: true })
    if (!stats.isFile()) {
      return null
    }
    const revision = `${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}:${stats.ino}`
    if (previous?.revision === revision) {
      return previous
    }
    const metadata = await readFrontmatter(absolutePath, stats.size)
    return {
      revision,
      entry: {
        path: `details/${path.relative(detailsRoot, absolutePath).replace(/\\/gu, '/')}`,
        title: metadata?.name ?? path.basename(absolutePath),
        description: metadata?.description ?? 'Metadata required: add name and description frontmatter before using this memory.',
      },
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function hasOrdinaryParents(absolutePath: string, detailsRoot: string) {
  const relative = path.relative(detailsRoot, absolutePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false
  }
  let parent = path.dirname(absolutePath)
  while (pathKey(parent) !== pathKey(detailsRoot)) {
    try {
      if (!(await fs.lstat(parent)).isDirectory()) {
        return false
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }
    parent = path.dirname(parent)
  }
  return true
}

/** Call under the service's workspace memory lock. Only metadata is retained. */
export async function collectMemoryIndexEntries(detailsRoot: string, changedPaths?: readonly string[]): Promise<MemoryIndexEntry[]> {
  const cacheKey = pathKey(detailsRoot)
  const previous = catalogs.get(cacheKey)
  const incremental = changedPaths !== undefined && previous !== undefined
  const next = incremental ? new Map(previous) : new Map<string, CachedEntry>()
  const targets = incremental ? [...new Set(changedPaths)] : await discoverFiles(detailsRoot)
  let nextTarget = 0
  const scan = async () => {
    while (nextTarget < targets.length) {
      const absolutePath = targets[nextTarget]
      nextTarget += 1
      const entryKey = pathKey(absolutePath)
      let cached: CachedEntry | null = null
      if (!incremental || await hasOrdinaryParents(absolutePath, detailsRoot)) {
        // Explicit mutations force a read, even if filesystem timestamps were preserved.
        cached = await readEntry(absolutePath, detailsRoot, incremental ? undefined : previous?.get(entryKey))
      }
      if (cached) {
        next.set(entryKey, cached)
      } else {
        next.delete(entryKey)
      }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, scan))
  for (const result of results) {
    if (result.status === 'rejected') {
      throw result.reason
    }
  }
  if (next.size > MAX_MEMORY_ENTRIES) {
    throw new Error(`Workspace memory cannot contain more than ${MAX_MEMORY_ENTRIES} entries.`)
  }
  catalogs.delete(cacheKey)
  catalogs.set(cacheKey, next)
  while (catalogs.size > MAX_CACHED_WORKSPACES) {
    const oldestKey = catalogs.keys().next().value
    if (oldestKey !== undefined) {
      catalogs.delete(oldestKey)
    }
  }
  return [...next.values()].map((cached) => cached.entry)
}
