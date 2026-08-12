import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { electronApp } from '../../../electronApp'

const TOOL_OUTPUT_DIRECTORY = ['.tidecode', 'tool-output'] as const
const OUTPUT_ID_PATTERN = /^[a-z0-9_-]+$/iu
const TOOL_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

function getToolOutputDirectory() {
  return path.join(electronApp.getPath('home'), ...TOOL_OUTPUT_DIRECTORY)
}

function sanitizeToolName(toolName: string) {
  const sanitized = toolName.replace(/[^a-z0-9_-]/giu, '_').slice(0, 48)
  return sanitized.length > 0 ? sanitized : 'tool'
}

function validateOutputId(outputId: string) {
  const normalized = outputId.trim()
  if (!OUTPUT_ID_PATTERN.test(normalized) || normalized.length > 160) {
    throw new Error('Invalid tool output id.')
  }

  return normalized
}

export async function persistToolOutput(toolName: string, content: string) {
  const outputId = `${sanitizeToolName(toolName)}-${randomUUID()}`
  const directory = getToolOutputDirectory()
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, `${outputId}.txt`), content, 'utf8')
  void cleanupStaleToolOutputs(directory)
  return outputId
}

async function cleanupStaleToolOutputs(directory: string) {
  try {
    const cutoff = Date.now() - TOOL_OUTPUT_RETENTION_MS
    const entries = await fs.readdir(directory, { withFileTypes: true })
    await Promise.all(entries
      .filter((entry) => entry.isFile() && OUTPUT_ID_PATTERN.test(entry.name.replace(/\.txt$/u, '')))
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
  const limit = Math.min(2_000, Math.max(1, Math.floor(input.limit ?? 200)))
  const filePath = path.join(getToolOutputDirectory(), `${outputId}.txt`)
  const content = await fs.readFile(filePath, 'utf8')
  const lines = content.split(/\r\n|\n|\r/u)
  const visibleLines = lines.slice(offset - 1, offset - 1 + limit)
  const nextOffset = offset + visibleLines.length

  return {
    body: [
      `Tool output ${outputId}`,
      `Lines ${offset}-${Math.max(offset, nextOffset - 1)} of ${lines.length}`,
      '',
      visibleLines.map((line, index) => `${offset + index}: ${line}`).join('\n'),
      ...(nextOffset <= lines.length ? ['', `More output is available with offset ${nextOffset}.`] : []),
    ].join('\n'),
    lineCount: lines.length,
    nextOffset: nextOffset <= lines.length ? nextOffset : null,
    outputId,
  }
}
