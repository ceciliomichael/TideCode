import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSafeWorkspaceTargetPath } from '../../workspace/paths'

export type ApplyPatchHunk =
  | {
      contents: string
      path: string
      type: 'add'
    }
  | {
      path: string
      type: 'delete'
    }
  | {
      chunks: ApplyPatchUpdateChunk[]
      movePath?: string
      path: string
      type: 'update'
    }

export interface ApplyPatchUpdateChunk {
  changeContext?: string
  isEndOfFile?: boolean
  newLines: string[]
  oldLines: string[]
}

export interface ApplyPatchChange {
  absolutePath: string
  nextAbsolutePath?: string
  newContent: string
  oldContent: string | null
  relativePath: string
  type: 'add' | 'delete' | 'update'
}

export interface ParsedApplyPatch {
  hunks: ApplyPatchHunk[]
}

export interface ApplyPatchWorkspaceOptions {
  basePath?: string
  onBeforeChange?: (input: {
    absolutePath: string
    nextAbsolutePath?: string
  }) => Promise<void> | void
  resolveTargetPath?: (candidatePath: string) => ApplyPatchTargetPath
}

interface ApplyPatchTargetPath {
  absolutePath: string
  relativePath: string
}

function normalizePatchInput(patchText: string) {
  const normalized = patchText.replace(/\r\n?/g, '\n').trim()
  const heredocPatterns = [
    /^(?:apply_patch|applypatch)\s*<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/u,
    /^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/u,
  ]

  for (const pattern of heredocPatterns) {
    const match = normalized.match(pattern)
    if (match) {
      return match[2]
    }
  }

  return normalized
}

function parsePatchHeader(lines: string[], index: number) {
  const line = lines[index]

  if (line.startsWith('*** Add File:')) {
    const filePath = line.slice('*** Add File:'.length).trim()
    return filePath ? { filePath, nextIndex: index + 1, type: 'add' as const } : null
  }

  if (line.startsWith('*** Delete File:')) {
    const filePath = line.slice('*** Delete File:'.length).trim()
    return filePath ? { filePath, nextIndex: index + 1, type: 'delete' as const } : null
  }

  if (line.startsWith('*** Update File:')) {
    const filePath = line.slice('*** Update File:'.length).trim()
    let movePath: string | undefined
    let nextIndex = index + 1

    if (nextIndex < lines.length && lines[nextIndex].startsWith('*** Move to:')) {
      movePath = lines[nextIndex].slice('*** Move to:'.length).trim()
      nextIndex += 1
    }

    return filePath
      ? {
          filePath,
          movePath,
          nextIndex,
          type: 'update' as const,
        }
      : null
  }

  return null
}

function parseAddedFile(lines: string[], startIndex: number) {
  const contentLines: string[] = []
  let index = startIndex

  while (index < lines.length && !lines[index].startsWith('***')) {
    if (!lines[index].startsWith('+')) {
      throw new Error(`Invalid add-file line: ${lines[index]}`)
    }

    contentLines.push(lines[index].slice(1))
    index += 1
  }

  return {
    content: contentLines.join('\n'),
    nextIndex: index,
  }
}

function parseUpdatedFile(lines: string[], startIndex: number) {
  const chunks: ApplyPatchUpdateChunk[] = []
  let index = startIndex

  while (index < lines.length && !lines[index].startsWith('*** End Patch') && !lines[index].startsWith('*** Add File:') && !lines[index].startsWith('*** Delete File:') && !lines[index].startsWith('*** Update File:')) {
    if (chunks.length === 0 && lines[index].trim().length === 0) {
      index += 1
      continue
    }

    const hasExplicitContextHeader = lines[index].startsWith('@@')
    const allowImplicitFirstChunk = chunks.length === 0

    if (!hasExplicitContextHeader && !allowImplicitFirstChunk) {
      throw new Error(`Expected "@@" chunk header, found: ${lines[index]}`)
    }

    const changeContext = hasExplicitContextHeader ? lines[index].slice(2).trim() || undefined : undefined
    if (hasExplicitContextHeader) {
      index += 1
    }

    const oldLines: string[] = []
    const newLines: string[] = []
    let isEndOfFile = false

    while (
      index < lines.length &&
      !lines[index].startsWith('@@') &&
      !lines[index].startsWith('*** End Patch') &&
      !lines[index].startsWith('*** Add File:') &&
      !lines[index].startsWith('*** Delete File:') &&
      !lines[index].startsWith('*** Update File:')
    ) {
      const line = lines[index]
      if (line === '*** End of File') {
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
        index += 1
        continue
      }

      if (line.startsWith(' ')) {
        const content = line.slice(1)
        oldLines.push(content)
        newLines.push(content)
        index += 1
        continue
      }

      if (line.startsWith('-')) {
        oldLines.push(line.slice(1))
        index += 1
        continue
      }

      if (line.startsWith('+')) {
        newLines.push(line.slice(1))
        index += 1
        continue
      }

      throw new Error(`Invalid patch body line: ${line}`)
    }

    if (oldLines.length === 0 && newLines.length === 0) {
      throw new Error('Update hunk does not contain any lines')
    }

    chunks.push({
      ...(changeContext === undefined ? {} : { changeContext }),
      ...(isEndOfFile ? { isEndOfFile: true } : {}),
      newLines,
      oldLines,
    })
  }

  if (chunks.length === 0) {
    throw new Error('Update file hunk is empty')
  }

  return {
    chunks,
    nextIndex: index,
  }
}

export function parseApplyPatch(patchText: string): ParsedApplyPatch {
  const normalized = normalizePatchInput(patchText).replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const beginIndex = lines.findIndex((line) => line.trim() === '*** Begin Patch')
  const endIndex = lines.findIndex((line) => line.trim() === '*** End Patch')

  if (beginIndex === -1 || endIndex === -1 || beginIndex >= endIndex) {
    throw new Error('Invalid patch format: missing "*** Begin Patch" / "*** End Patch" markers')
  }

  const hunks: ApplyPatchHunk[] = []
  let index = beginIndex + 1

  while (index < endIndex) {
    const header = parsePatchHeader(lines, index)
    if (!header) {
      if (lines[index].trim().length === 0) {
        index += 1
        continue
      }

      throw new Error(`Unexpected patch line: ${lines[index]}`)
    }

    if (header.type === 'add') {
      const result = parseAddedFile(lines, header.nextIndex)
      hunks.push({
        contents: result.content,
        path: header.filePath,
        type: 'add',
      })
      index = result.nextIndex
      continue
    }

    if (header.type === 'delete') {
      hunks.push({
        path: header.filePath,
        type: 'delete',
      })
      index = header.nextIndex
      continue
    }

    const result = parseUpdatedFile(lines, header.nextIndex)
    hunks.push({
      chunks: result.chunks,
      ...(header.movePath ? { movePath: header.movePath } : {}),
      path: header.filePath,
      type: 'update',
    })
    index = result.nextIndex
  }

  if (hunks.length === 0) {
    throw new Error('Patch did not contain any file hunks')
  }

  return { hunks }
}

function normalizeUnicode(value: string) {
  return value
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
}

function areComparableLinesEqual(left: string, right: string) {
  if (left === right) {
    return true
  }

  if (left.trimEnd() === right.trimEnd()) {
    return true
  }

  if (left.trim() === right.trim()) {
    return true
  }

  return normalizeUnicode(left.trim()) === normalizeUnicode(right.trim())
}

function compactComparableText(value: string) {
  return normalizeUnicode(value).replace(/\s+/gu, '')
}

function tryMatchSequence(
  lines: readonly string[],
  pattern: readonly string[],
  startIndex: number,
  compare: (left: string, right: string) => boolean,
  isEndOfFile: boolean,
) {
  if (isEndOfFile) {
    const fromEnd = lines.length - pattern.length
    if (fromEnd >= startIndex) {
      let matches = true
      for (let index = 0; index < pattern.length; index += 1) {
        if (!compare(lines[fromEnd + index], pattern[index])) {
          matches = false
          break
        }
      }

      if (matches) {
        return fromEnd
      }
    }
  }

  for (let lineIndex = startIndex; lineIndex <= lines.length - pattern.length; lineIndex += 1) {
    let matches = true

    for (let patternIndex = 0; patternIndex < pattern.length; patternIndex += 1) {
      if (!compare(lines[lineIndex + patternIndex], pattern[patternIndex])) {
        matches = false
        break
      }
    }

    if (matches) {
      return lineIndex
    }
  }

  return -1
}

function seekSequence(
  lines: readonly string[],
  pattern: readonly string[],
  startIndex: number,
  isEndOfFile: boolean,
) {
  if (pattern.length === 0) {
    return -1
  }

  const exact = tryMatchSequence(lines, pattern, startIndex, (left, right) => left === right, isEndOfFile)
  if (exact !== -1) {
    return exact
  }

  const trimEndMatch = tryMatchSequence(lines, pattern, startIndex, (left, right) => left.trimEnd() === right.trimEnd(), isEndOfFile)
  if (trimEndMatch !== -1) {
    return trimEndMatch
  }

  const trimMatch = tryMatchSequence(lines, pattern, startIndex, (left, right) => left.trim() === right.trim(), isEndOfFile)
  if (trimMatch !== -1) {
    return trimMatch
  }

  const unicodeTrimMatch = tryMatchSequence(
    lines,
    pattern,
    startIndex,
    (left, right) => normalizeUnicode(left.trim()) === normalizeUnicode(right.trim()),
    isEndOfFile,
  )
  if (unicodeTrimMatch !== -1) {
    return unicodeTrimMatch
  }

  if (pattern.length < 2) {
    return -1
  }

  const compactPatternText = compactComparableText(pattern.join('\n'))

  if (isEndOfFile) {
    const fromEnd = lines.length - pattern.length
    if (fromEnd >= startIndex) {
      const compactEndText = compactComparableText(lines.slice(fromEnd, fromEnd + pattern.length).join('\n'))
      if (compactEndText === compactPatternText) {
        return fromEnd
      }
    }
  }

  for (let lineIndex = startIndex; lineIndex <= lines.length - pattern.length; lineIndex += 1) {
    const compactLineText = compactComparableText(lines.slice(lineIndex, lineIndex + pattern.length).join('\n'))
    if (compactLineText === compactPatternText) {
      return lineIndex
    }
  }

  return -1
}

function comparableLineKey(value: string) {
  return normalizeUnicode(value.trimEnd())
}

function countComparableLines(lines: readonly string[]) {
  const counts = new Map<string, number>()

  for (const line of lines) {
    const key = comparableLineKey(line)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return counts
}

function canCoverExtraLinesWithReplacement(extraLines: readonly string[], replacementLines: readonly string[]) {
  if (extraLines.length === 0) {
    return true
  }

  const replacementCounts = countComparableLines(replacementLines)

  for (const extraLine of extraLines) {
    const key = comparableLineKey(extraLine)
    const remainingCount = replacementCounts.get(key) ?? 0
    if (remainingCount <= 0) {
      return false
    }

    replacementCounts.set(key, remainingCount - 1)
  }

  return true
}

interface FuzzyReplacementMatch {
  deleteCount: number
  startIndex: number
}

function findFuzzyReplacementMatch(
  lines: readonly string[],
  pattern: readonly string[],
  replacementLines: readonly string[],
  startIndex: number,
) {
  const maxExtraLines = 3
  let bestMatch: FuzzyReplacementMatch | null = null
  let bestSpanLength = Number.POSITIVE_INFINITY

  for (let candidateStart = startIndex; candidateStart < lines.length; candidateStart += 1) {
    const matchedIndices: number[] = []
    let searchIndex = candidateStart

    for (const patternLine of pattern) {
      let foundIndex = -1
      for (let lineIndex = searchIndex; lineIndex < lines.length; lineIndex += 1) {
        if (areComparableLinesEqual(lines[lineIndex], patternLine)) {
          foundIndex = lineIndex
          break
        }
      }

      if (foundIndex === -1) {
        matchedIndices.length = 0
        break
      }

      matchedIndices.push(foundIndex)
      searchIndex = foundIndex + 1
    }

    if (matchedIndices.length !== pattern.length) {
      continue
    }

    const spanStart = matchedIndices[0]
    const spanEnd = matchedIndices[matchedIndices.length - 1]
    const spanLength = spanEnd - spanStart + 1
    const extraLineCount = spanLength - pattern.length

    if (spanStart < startIndex) {
      continue
    }

    if (extraLineCount < 0 || extraLineCount > maxExtraLines) {
      continue
    }

    const matchedIndexSet = new Set(matchedIndices)
    const extraLines = lines.slice(spanStart, spanEnd + 1).filter((_line, lineIndex) => !matchedIndexSet.has(spanStart + lineIndex))
    if (!canCoverExtraLinesWithReplacement(extraLines, replacementLines)) {
      continue
    }

    const candidate: FuzzyReplacementMatch = {
      deleteCount: spanLength,
      startIndex: spanStart,
    }

    if (spanLength < bestSpanLength) {
      bestMatch = candidate
      bestSpanLength = spanLength
      continue
    }

    if (spanLength === bestSpanLength && bestMatch && spanStart < bestMatch.startIndex) {
      bestMatch = candidate
    }
  }

  if (bestMatch) {
    return bestMatch
  }

  return null
}

function applyUpdateChunks(filePath: string, originalContent: string, chunks: readonly ApplyPatchUpdateChunk[]) {
  const originalLines = originalContent.endsWith('\n')
    ? originalContent.slice(0, -1).split('\n')
    : originalContent.length === 0
      ? []
      : originalContent.split('\n')
  const replacements: Array<{ deleteCount: number; newLines: string[]; startIndex: number }> = []
  let searchStartIndex = 0

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextIndex = seekSequence(originalLines, [chunk.changeContext], searchStartIndex, false)
      if (contextIndex === -1) {
        throw new Error(`Failed to find context "${chunk.changeContext}" in ${filePath}`)
      }

      searchStartIndex = contextIndex + 1
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex = chunk.isEndOfFile ? originalLines.length : searchStartIndex
      replacements.push({
        deleteCount: 0,
        newLines: [...chunk.newLines],
        startIndex: insertionIndex,
      })
      continue
    }

    const foundIndex = seekSequence(originalLines, chunk.oldLines, searchStartIndex, Boolean(chunk.isEndOfFile))

    if (foundIndex === -1) {
      const fuzzyMatch = findFuzzyReplacementMatch(
        originalLines,
        chunk.oldLines,
        chunk.newLines,
        searchStartIndex,
      )

      if (!fuzzyMatch) {
        throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join('\n')}`)
      }

      replacements.push({
        deleteCount: fuzzyMatch.deleteCount,
        newLines: [...chunk.newLines],
        startIndex: fuzzyMatch.startIndex,
      })
      searchStartIndex = fuzzyMatch.startIndex + chunk.newLines.length
      continue
    }

    replacements.push({
      deleteCount: chunk.oldLines.length,
      newLines: [...chunk.newLines],
      startIndex: foundIndex,
    })
    searchStartIndex = foundIndex + chunk.oldLines.length
  }

  const nextLines = [...originalLines]
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index]
    nextLines.splice(replacement.startIndex, replacement.deleteCount, ...replacement.newLines)
  }

  return nextLines.join('\n') + (originalContent.endsWith('\n') || nextLines.length > 0 ? '\n' : '')
}

function resolvePatchTargetPath(
  workspaceRootPath: string,
  candidatePath: string,
  customResolver: ApplyPatchWorkspaceOptions['resolveTargetPath'],
  basePath: string,
) {
  if (customResolver) {
    return customResolver(candidatePath)
  }

  if (path.isAbsolute(candidatePath)) {
    const relativePath = path.relative(workspaceRootPath, candidatePath)
    return getSafeWorkspaceTargetPath(workspaceRootPath, relativePath)
  }

  const resolvedCandidatePath = path.resolve(basePath, candidatePath)
  return getSafeWorkspaceTargetPath(workspaceRootPath, path.relative(workspaceRootPath, resolvedCandidatePath))
}

export async function applyPatchInWorkspace(
  workspaceRootPath: string,
  patchText: string,
  options?: ApplyPatchWorkspaceOptions,
) {
  const parsedPatch = parseApplyPatch(patchText)
  const changes: ApplyPatchChange[] = []
  const basePath = options?.basePath ? path.resolve(options.basePath) : workspaceRootPath
  const resolveTargetPath = (candidatePath: string) =>
    resolvePatchTargetPath(workspaceRootPath, candidatePath, options?.resolveTargetPath, basePath)

  for (const hunk of parsedPatch.hunks) {
    if (hunk.type === 'add') {
      const target = resolveTargetPath(hunk.path)
      await options?.onBeforeChange?.({
        absolutePath: target.absolutePath,
      })
      const nextContent = hunk.contents.length === 0 || hunk.contents.endsWith('\n') ? hunk.contents : `${hunk.contents}\n`
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true })
      await fs.writeFile(target.absolutePath, nextContent, 'utf8')
      changes.push({
        absolutePath: target.absolutePath,
        newContent: nextContent,
        oldContent: null,
        relativePath: target.relativePath,
        type: 'add',
      })
      continue
    }

    if (hunk.type === 'delete') {
      const target = resolveTargetPath(hunk.path)
      const existingContent = await fs.readFile(target.absolutePath, 'utf8').catch((error: unknown) => {
        throw new Error(`Failed to read file for deletion ${target.relativePath}: ${(error as Error).message}`)
      })
      await options?.onBeforeChange?.({
        absolutePath: target.absolutePath,
      })
      await fs.unlink(target.absolutePath)
      changes.push({
        absolutePath: target.absolutePath,
        newContent: '',
        oldContent: existingContent,
        relativePath: target.relativePath,
        type: 'delete',
      })
      continue
    }

    const sourceTarget = resolveTargetPath(hunk.path)
    const nextTarget = hunk.movePath ? resolveTargetPath(hunk.movePath) : undefined
    const existingContent = await fs.readFile(sourceTarget.absolutePath, 'utf8').catch((error: unknown) => {
      throw new Error(`Failed to read file for update ${sourceTarget.relativePath}: ${(error as Error).message}`)
    })
    await options?.onBeforeChange?.({
      absolutePath: sourceTarget.absolutePath,
      ...(nextTarget ? { nextAbsolutePath: nextTarget.absolutePath } : {}),
    })
    const nextContent = applyUpdateChunks(sourceTarget.relativePath, existingContent, hunk.chunks)
    const writeTarget = nextTarget ?? sourceTarget

    if (!nextTarget && nextContent === existingContent) {
      throw new Error(`Patch did not change ${sourceTarget.relativePath}`)
    }

    await fs.mkdir(path.dirname(writeTarget.absolutePath), { recursive: true })
    await fs.writeFile(writeTarget.absolutePath, nextContent, 'utf8')

    if (nextTarget) {
      await fs.unlink(sourceTarget.absolutePath)
    }

    changes.push({
      absolutePath: sourceTarget.absolutePath,
      newContent: nextContent,
      ...(nextTarget ? { nextAbsolutePath: nextTarget.absolutePath } : {}),
      oldContent: existingContent,
      relativePath: writeTarget.relativePath,
      type: 'update',
    })
  }

  return {
    changes,
    parsedPatch,
  }
}
