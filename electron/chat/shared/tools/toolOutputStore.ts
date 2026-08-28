import { randomInt } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { electronApp } from '../../../electronApp'
import { TOOL_OUTPUT_PAGED_READ_MAX_BYTES } from './toolOutputBudget'

const TOOL_OUTPUT_DIRECTORY = ['.tidecode', 'tool-output'] as const
const OUTPUT_ID_PATTERN = /^\d{5}$/u
const LEGACY_OUTPUT_ID_PATTERN = /^[a-z0-9_-]{1,160}$/iu
const TOOL_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const OUTPUT_ID_ALLOCATION_ATTEMPTS = 100

function getToolOutputDirectory() {
  return path.join(electronApp.getPath('home'), ...TOOL_OUTPUT_DIRECTORY)
}

function validateOutputId(outputId: string) {
  const normalized = outputId.trim()
  if (!OUTPUT_ID_PATTERN.test(normalized) && !LEGACY_OUTPUT_ID_PATTERN.test(normalized)) {
    throw new Error('Invalid tool output id.')
  }

  return normalized
}

export async function persistToolOutput(content: string) {
  const directory = getToolOutputDirectory()
  await fs.mkdir(directory, { recursive: true })

  for (let attempt = 0; attempt < OUTPUT_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
    const outputId = String(randomInt(0, 100_000)).padStart(5, '0')
    try {
      await fs.writeFile(path.join(directory, `${outputId}.txt`), content, { encoding: 'utf8', flag: 'wx' })
      void cleanupStaleToolOutputs(directory)
      return outputId
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }

  throw new Error('Unable to allocate a tool output id.')
}

async function cleanupStaleToolOutputs(directory: string) {
  try {
    const cutoff = Date.now() - TOOL_OUTPUT_RETENTION_MS
    const entries = await fs.readdir(directory, { withFileTypes: true })
    await Promise.all(entries
      .filter((entry) => {
        if (!entry.isFile()) return false
        const outputId = entry.name.replace(/\.txt$/u, '')
        return OUTPUT_ID_PATTERN.test(outputId) || LEGACY_OUTPUT_ID_PATTERN.test(outputId)
      })
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

export async function readPersistedToolOutput(input: {
  offset?: number
  outputId: string
  limit?: number
}) {
  const outputId = validateOutputId(input.outputId)
  const offset = Math.max(1, Math.floor(input.offset ?? 1))
  const limit = Math.min(500, Math.max(1, Math.floor(input.limit ?? 200)))
  const filePath = path.join(getToolOutputDirectory(), `${outputId}.txt`)
  const content = await fs.readFile(filePath, 'utf8')
  const lines = content.split(/\r\n|\n|\r/u)
  const visibleLines: string[] = []
  let visibleBytes = 0
  for (let index = offset - 1; index < lines.length && visibleLines.length < limit; index += 1) {
    const line = lines[index]
    const lineBytes = Buffer.byteLength(line, 'utf8') + (visibleLines.length > 0 ? 1 : 0)
    if (visibleLines.length > 0 && visibleBytes + lineBytes > TOOL_OUTPUT_PAGED_READ_MAX_BYTES) break
    visibleLines.push(line)
    visibleBytes += lineBytes
  }
  const endLine = visibleLines.length > 0 ? offset + visibleLines.length - 1 : offset - 1
  const nextOffset = endLine < lines.length ? endLine + 1 : null

  return {
    body: visibleLines.join('\n'),
    endLine,
    lineCount: lines.length,
    nextOffset,
    outputId,
    returnedLineCount: visibleLines.length,
    startLine: offset,
  }
}
