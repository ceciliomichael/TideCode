import { randomInt } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { electronApp } from '../../../electronApp'

const TOOL_OUTPUT_DIRECTORY = ['.tidecode', 'tool-output'] as const
const TOOL_OUTPUT_FILE_PATTERN = /^tool_\d{5}\.txt$/u
const TOOL_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const OUTPUT_FILE_ALLOCATION_ATTEMPTS = 100

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
      void cleanupStaleToolOutputs(directory)
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

async function cleanupStaleToolOutputs(directory: string) {
  try {
    const cutoff = Date.now() - TOOL_OUTPUT_RETENTION_MS
    const entries = await fs.readdir(directory, { withFileTypes: true })
    await Promise.all(entries
      .filter((entry) => entry.isFile() && TOOL_OUTPUT_FILE_PATTERN.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name)
        const stats = await fs.stat(filePath)
        if (stats.mtimeMs < cutoff) {
          await fs.rm(filePath, { force: true })
        }
      }))
  } catch {
    // Truncation recovery must never make an otherwise successful tool call fail.
  }
}
