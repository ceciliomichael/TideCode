import { randomInt } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { electronApp } from '../../../electronApp'
import { getHistoryDirectoryPath } from '../../../history/paths'

const TOOL_OUTPUT_DIRECTORY = ['.tidecode', 'tool-output'] as const
const TOOL_OUTPUT_FILE_PATTERN = /^tool_\d{5}\.txt$/u
const TOOL_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const OUTPUT_FILE_ALLOCATION_ATTEMPTS = 100
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000
const CLEANUP_BATCH_SIZE = 32
let lastCleanupAttempt = 0

export const TOOL_OUTPUT_ALIAS_ROOT = '@tool-output'

export function getToolOutputDirectory() {
  return path.join(electronApp.getPath('home'), ...TOOL_OUTPUT_DIRECTORY)
}

function normalizeToolOutputAlias(aliasPath: string) {
  const normalized = aliasPath.trim().replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (!normalized.startsWith(`${TOOL_OUTPUT_ALIAS_ROOT}/`)) {
    throw new Error('Invalid tool output path.')
  }

  const fileName = normalized.slice(`${TOOL_OUTPUT_ALIAS_ROOT}/`.length)
  if (!TOOL_OUTPUT_FILE_PATTERN.test(fileName) || fileName.includes('/')) {
    throw new Error('Invalid tool output path.')
  }

  return {
    aliasPath: `${TOOL_OUTPUT_ALIAS_ROOT}/${fileName}`,
    fileName,
  }
}

export function resolveToolOutputAliasPath(aliasPath: string) {
  const normalized = normalizeToolOutputAlias(aliasPath)
  return {
    ...normalized,
    absolutePath: path.join(getToolOutputDirectory(), normalized.fileName),
  }
}

export async function persistToolOutput(content: string) {
  const directory = getToolOutputDirectory()
  await fs.mkdir(directory, { recursive: true })

  for (let attempt = 0; attempt < OUTPUT_FILE_ALLOCATION_ATTEMPTS; attempt += 1) {
    const fileName = `tool_${String(randomInt(0, 100_000)).padStart(5, '0')}.txt`
    const absolutePath = path.join(directory, fileName)
    try {
      await fs.writeFile(absolutePath, content, { encoding: 'utf8', flag: 'wx' })
      if (Date.now() - lastCleanupAttempt >= CLEANUP_INTERVAL_MS) {
        lastCleanupAttempt = Date.now()
        void cleanupStaleToolOutputs(directory)
      }
      return {
        absolutePath,
        aliasPath: `${TOOL_OUTPUT_ALIAS_ROOT}/${fileName}`,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }

  throw new Error('Unable to allocate a tool output file.')
}

export async function appendToolOutput(aliasPath: string, content: string) {
  if (content.length === 0) return
  const target = resolveToolOutputAliasPath(aliasPath)
  await fs.appendFile(target.absolutePath, content, 'utf8')
}

async function collectReferencedToolOutputs() {
  const references = new Set<string>()
  const pendingDirectories = [getHistoryDirectoryPath()]
  const referencePattern = /tool_\d{5}\.txt/gu
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop()!
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'attachments') pendingDirectories.push(filePath)
        continue
      }
      if (!entry.isFile() || !/\.(?:json|jsonl|md|txt)$/iu.test(entry.name)) continue
      let previousChunkEnd = ''
      for await (const chunk of createReadStream(filePath, { encoding: 'utf8' })) {
        const text = previousChunkEnd + chunk
        for (const match of text.matchAll(referencePattern)) references.add(match[0])
        previousChunkEnd = text.slice(-32)
      }
    }
  }
  return references
}

// Only remove outputs that are both old and absent from persisted chat history.
// If history cannot be inspected, keep the files rather than breaking recovery.
export async function cleanupStaleToolOutputs(directory = getToolOutputDirectory()) {
  try {
    const cutoff = Date.now() - TOOL_OUTPUT_RETENTION_MS
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const outputFiles = entries.filter((entry) => entry.isFile() && TOOL_OUTPUT_FILE_PATTERN.test(entry.name))
    const staleFiles = new Set<string>()
    for (let index = 0; index < outputFiles.length; index += CLEANUP_BATCH_SIZE) {
      const batch = outputFiles.slice(index, index + CLEANUP_BATCH_SIZE)
      const oldNames = await Promise.all(batch.map(async (entry) => {
        const filePath = path.join(directory, entry.name)
        const stats = await fs.stat(filePath)
        return stats.mtimeMs < cutoff ? entry.name : null
      }))
      for (const name of oldNames) {
        if (name) staleFiles.add(name)
      }
    }
    if (staleFiles.size === 0) return
    const referenced = await collectReferencedToolOutputs()
    const removable = outputFiles.filter((entry) => staleFiles.has(entry.name) && !referenced.has(entry.name))
    for (let index = 0; index < removable.length; index += CLEANUP_BATCH_SIZE) {
      await Promise.all(removable.slice(index, index + CLEANUP_BATCH_SIZE).map(async (entry) => {
        const filePath = path.join(directory, entry.name)
        const stats = await fs.stat(filePath)
        if (stats.mtimeMs < cutoff) {
          await fs.rm(filePath, { force: true })
        }
      }))
    }
  } catch {
    // Truncation recovery must never make an otherwise successful tool call fail.
  }
}
