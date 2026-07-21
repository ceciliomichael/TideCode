import type {
  ApplyPatchHunk,
  ApplyPatchUpdateChunk,
  ParsedApplyPatch,
} from './applyPatchTypes'

type PatchDialect = 'standard' | 'xml'

interface ParsedPatchHeader {
  filePath: string
  movePath?: string
  nextIndex: number
  type: ApplyPatchHunk['type']
}

interface PatchEnvelope {
  beginIndex: number
  dialect: PatchDialect
  endIndex: number
}

function normalizePatchInput(patchText: string) {
  const normalized = patchText.replace(/\r\n?/g, '\n').trim()
  const heredocPatterns = [
    /^(?:apply_patch|applypatch)\s*<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/u,
    /^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/u,
  ]

  for (const pattern of heredocPatterns) {
    const match = normalized.match(pattern)
    if (match) return match[2]
  }

  return normalized
}

function findEnvelope(lines: readonly string[]): PatchEnvelope {
  const standardBeginIndex = lines.findIndex((line) => line.trim() === '*** Begin Patch')
  if (standardBeginIndex !== -1) {
    const endIndex = lines.findIndex(
      (line, index) => index > standardBeginIndex && line.trim() === '*** End Patch',
    )
    if (endIndex !== -1) {
      return { beginIndex: standardBeginIndex, dialect: 'standard', endIndex }
    }
  }

  const xmlBeginIndex = lines.findIndex((line) => line.trim() === '<patch>')
  if (xmlBeginIndex !== -1) {
    const endIndex = lines.findIndex(
      (line, index) => index > xmlBeginIndex && line.trim() === '</patch>',
    )
    if (endIndex !== -1) {
      return { beginIndex: xmlBeginIndex, dialect: 'xml', endIndex }
    }
  }

  throw new Error(
    'Invalid patch format: expected "*** Begin Patch" / "*** End Patch" markers',
  )
}

function parseStandardHeader(lines: readonly string[], index: number): ParsedPatchHeader | null {
  const line = lines[index]
  const definitions = [
    { prefix: '*** Add File: ', type: 'add' as const },
    { prefix: '*** Delete File: ', type: 'delete' as const },
    { prefix: '*** Update File: ', type: 'update' as const },
  ]

  for (const definition of definitions) {
    if (!line.startsWith(definition.prefix)) continue
    const filePath = line.slice(definition.prefix.length).trim()
    if (!filePath) return null

    let movePath: string | undefined
    let nextIndex = index + 1
    if (definition.type === 'update' && lines[nextIndex]?.startsWith('*** Move to: ')) {
      movePath = lines[nextIndex].slice('*** Move to: '.length).trim()
      nextIndex += 1
    }

    return {
      filePath,
      ...(movePath ? { movePath } : {}),
      nextIndex,
      type: definition.type,
    }
  }

  return null
}

function parseXmlHeader(lines: readonly string[], index: number): ParsedPatchHeader | null {
  const line = lines[index]
  const addMatch = line.match(/^<add\s+path="([^"]+)">$/u)
  if (addMatch) return { filePath: addMatch[1], nextIndex: index + 1, type: 'add' }

  const deleteMatch = line.match(/^<delete\s+path="([^"]+)"\s*\/>$/u)
  if (deleteMatch) return { filePath: deleteMatch[1], nextIndex: index + 1, type: 'delete' }

  const updateMatch = line.match(/^<update\s+path="([^"]+)"(?:\s+move_to="([^"]+)")?>$/u)
  if (!updateMatch) return null

  return {
    filePath: updateMatch[1],
    ...(updateMatch[2] ? { movePath: updateMatch[2] } : {}),
    nextIndex: index + 1,
    type: 'update',
  }
}

function isStandardFileBoundary(line: string) {
  return (
    line === '*** End Patch' ||
    line.startsWith('*** Add File: ') ||
    line.startsWith('*** Delete File: ') ||
    line.startsWith('*** Update File: ')
  )
}

function parseAddedFile(
  lines: readonly string[],
  startIndex: number,
  dialect: PatchDialect,
) {
  const contentLines: string[] = []
  let index = startIndex
  const isTerminator = (line: string) =>
    dialect === 'standard' ? isStandardFileBoundary(line) : line === '</add>'

  while (index < lines.length && !isTerminator(lines[index])) {
    if (!lines[index].startsWith('+')) {
      throw new Error(`Invalid add-file line: ${lines[index]}`)
    }
    contentLines.push(lines[index].slice(1))
    index += 1
  }

  if (dialect === 'xml') {
    if (lines[index] !== '</add>') throw new Error('Expected </add> tag')
    index += 1
  }

  return { content: contentLines.join('\n'), nextIndex: index }
}

function parseChunkHeader(line: string) {
  const headerText = line.slice(2).trim()
  const unifiedMatch = headerText.match(
    /^-(\d+)(?:,(\d+))?(?:\s+\+\d+(?:,\d+)?)?(?:\s*@@)?(.*)$/u,
  )

  if (unifiedMatch?.[1]) {
    return {
      offset: {
        lineCount: unifiedMatch[2] ? Number.parseInt(unifiedMatch[2], 10) : 1,
        startLine: Number.parseInt(unifiedMatch[1], 10),
      },
    }
  }

  return { ...(headerText ? { changeContext: headerText } : {}) }
}

function createUpdateChunk(
  lines: readonly string[],
  startIndex: number,
  dialect: PatchDialect,
  metadata: Pick<ApplyPatchUpdateChunk, 'changeContext' | 'offset'>,
) {
  const contextLineMappings: ApplyPatchUpdateChunk['contextLineMappings'] = []
  const newLines: string[] = []
  const oldLines: string[] = []
  const endOfFileMarker = dialect === 'standard' ? '*** End of File' : '<end_of_file />'
  let index = startIndex
  let isEndOfFile = false

  const isTerminator = (line: string) =>
    line.startsWith('@@') ||
    (dialect === 'standard' ? isStandardFileBoundary(line) : line === '</update>')

  while (index < lines.length && !isTerminator(lines[index])) {
    const line = lines[index]
    if (line === endOfFileMarker) {
      if (oldLines.length === 0 && newLines.length === 0) {
        throw new Error('Update hunk does not contain any lines')
      }
      isEndOfFile = true
      index += 1
      break
    }

    if (line.length === 0) {
      oldLines.push('')
      newLines.push('')
    } else if (line.startsWith(' ')) {
      contextLineMappings.push({
        newLineIndex: newLines.length,
        oldLineIndex: oldLines.length,
      })
      oldLines.push(line.slice(1))
      newLines.push(line.slice(1))
    } else if (line.startsWith('-')) {
      const deletedLine = line.slice(1)
      if (dialect === 'xml' && (deletedLine === '</update>' || deletedLine === '</patch>')) {
        throw new Error(
          `Invalid legacy XML patch: reserved marker "${deletedLine}" was emitted as source text. Retry with the standard patch format.`,
        )
      }
      oldLines.push(deletedLine)
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1))
    } else {
      throw new Error(`Invalid patch body line: ${line}`)
    }
    index += 1
  }

  if (oldLines.length === 0 && newLines.length === 0) {
    throw new Error('Update hunk does not contain any lines')
  }

  const chunk = {
    ...metadata,
    ...(isEndOfFile ? { isEndOfFile: true } : {}),
    newLines,
    oldLines,
  } as ApplyPatchUpdateChunk
  Object.defineProperty(chunk, 'contextLineMappings', {
    enumerable: false,
    value: contextLineMappings,
  })

  return { chunk, nextIndex: index }
}

function parseUpdatedFile(
  lines: readonly string[],
  startIndex: number,
  dialect: PatchDialect,
) {
  const chunks: ApplyPatchUpdateChunk[] = []
  let index = startIndex
  const isFileTerminator = (line: string) =>
    dialect === 'standard' ? isStandardFileBoundary(line) : line === '</update>'

  while (index < lines.length && !isFileTerminator(lines[index])) {
    if (chunks.length === 0 && lines[index].trim().length === 0) {
      index += 1
      continue
    }

    const hasExplicitHeader = lines[index].startsWith('@@')
    if (!hasExplicitHeader && chunks.length > 0) {
      throw new Error(`Expected "@@" chunk header, found: ${lines[index]}`)
    }

    const metadata = hasExplicitHeader ? parseChunkHeader(lines[index]) : {}
    if (hasExplicitHeader) index += 1
    const parsedChunk = createUpdateChunk(lines, index, dialect, metadata)
    chunks.push(parsedChunk.chunk)
    index = parsedChunk.nextIndex
  }

  if (chunks.length === 0) throw new Error('Update file hunk is empty')
  if (dialect === 'xml') {
    if (lines[index] !== '</update>') throw new Error('Expected </update> tag')
    index += 1
  }

  return { chunks, nextIndex: index }
}

export function parseApplyPatch(patchText: string): ParsedApplyPatch {
  const lines = normalizePatchInput(patchText).split('\n')
  const envelope = findEnvelope(lines)
  const hunks: ApplyPatchHunk[] = []
  let index = envelope.beginIndex + 1

  while (index < envelope.endIndex) {
    const header =
      envelope.dialect === 'standard'
        ? parseStandardHeader(lines, index)
        : parseXmlHeader(lines, index)

    if (!header) {
      if (lines[index].trim().length === 0) {
        index += 1
        continue
      }
      throw new Error(`Unexpected patch line: ${lines[index]}`)
    }

    if (header.type === 'add') {
      const parsedFile = parseAddedFile(lines, header.nextIndex, envelope.dialect)
      hunks.push({ contents: parsedFile.content, path: header.filePath, type: 'add' })
      index = parsedFile.nextIndex
    } else if (header.type === 'delete') {
      hunks.push({ path: header.filePath, type: 'delete' })
      index = header.nextIndex
    } else {
      const parsedFile = parseUpdatedFile(lines, header.nextIndex, envelope.dialect)
      hunks.push({
        chunks: parsedFile.chunks,
        ...(header.movePath ? { movePath: header.movePath } : {}),
        path: header.filePath,
        type: 'update',
      })
      index = parsedFile.nextIndex
    }
  }

  if (hunks.length === 0) throw new Error('Patch did not contain any file hunks')
  return { hunks }
}
