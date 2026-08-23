import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const UTF8_BOM = '﻿'

export type TextLineEnding = '\n' | '\r\n' | '\r'

export interface TextFileFormat {
  hasBom: boolean
  lineEnding: TextLineEnding
}

export function normalizeMutationText(content: string) {
  const withoutBom = content.startsWith(UTF8_BOM) ? content.slice(1) : content
  return withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function detectTextFileFormat(content: string): TextFileFormat {
  const withoutBom = content.startsWith(UTF8_BOM) ? content.slice(1) : content
  const crlfCount = (withoutBom.match(/\r\n/g) ?? []).length
  const withoutCrlf = withoutBom.replace(/\r\n/g, '')
  const lfCount = (withoutCrlf.match(/\n/g) ?? []).length
  const crCount = (withoutCrlf.match(/\r/g) ?? []).length

  let lineEnding: TextLineEnding = '\n'
  if (crlfCount >= lfCount && crlfCount >= crCount && crlfCount > 0) lineEnding = '\r\n'
  else if (crCount > lfCount && crCount > 0) lineEnding = '\r'

  return {
    hasBom: content.startsWith(UTF8_BOM),
    lineEnding,
  }
}

export function serializeNormalizedText(content: string, format: TextFileFormat) {
  const normalized = normalizeMutationText(content)
  const withLineEndings = format.lineEnding === '\n'
    ? normalized
    : normalized.replace(/\n/g, format.lineEnding)
  return format.hasBom ? UTF8_BOM + withLineEndings : withLineEndings
}

export function preserveExistingTextFormat(content: string, previousContent: string) {
  return serializeNormalizedText(content, detectTextFileFormat(previousContent))
}

export function computeContentRevision(content: string | Uint8Array) {
  return 'sha256:' + createHash('sha256').update(content).digest('hex')
}

export async function writeTextFileAtomically(absolutePath: string, content: string) {
  const directory = path.dirname(absolutePath)
  const basename = path.basename(absolutePath)
  await fs.mkdir(directory, { recursive: true })

  const existingMode = await fs.stat(absolutePath).then((stats) => stats.mode).catch(() => undefined)
  const temporaryPath = path.join(directory, '.' + basename + '.tidecode-' + randomUUID() + '.tmp')

  try {
    const handle = existingMode === undefined
      ? await fs.open(temporaryPath, 'wx')
      : await fs.open(temporaryPath, 'wx', existingMode)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }

    const temporaryContent = await fs.readFile(temporaryPath, 'utf8')
    if (temporaryContent !== content) {
      throw new Error('Temporary write verification failed: staged file content does not match the requested content.')
    }

    await fs.rename(temporaryPath, absolutePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }

  const persisted = await fs.readFile(absolutePath, 'utf8')
  if (persisted !== content) {
    throw new Error('Post-write verification failed: persisted file content does not match the requested content.')
  }
}
