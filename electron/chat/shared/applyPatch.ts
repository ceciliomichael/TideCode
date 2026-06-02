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

interface StagedFileState {
  content: string | null
  target: ApplyPatchTargetPath
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

function seekSequence(
  lines: readonly string[],
  pattern: readonly string[],
  startIndex: number,
  isEndOfFile: boolean,
) {
  if (pattern.length === 0) {
    return -1
  }

  const normalizeLine = (str: string) => {
    return str
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^-+/, '-') // Normalize leading hyphens (e.g. '--' to '-')
  }

  const linesMatch = (actual: string, expected: string) => {
    const act = actual.trim()
    const exp = expected.trim()
    if (act === exp) {
      return true
    }

    const normAct = normalizeLine(act)
    const normExp = normalizeLine(exp)
    if (normAct === normExp) {
      return true
    }

    const stripAct = normAct.replace(/^[-*]\s*/, '')
    const stripExp = normExp.replace(/^[-*]\s*/, '')
    return stripAct === stripExp
  }

  if (isEndOfFile) {
    const fromEnd = lines.length - pattern.length
    if (fromEnd >= startIndex) {
      let matches = true
      for (let index = 0; index < pattern.length; index += 1) {
        if (!linesMatch(lines[fromEnd + index], pattern[index])) {
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
      if (!linesMatch(lines[lineIndex + patternIndex], pattern[patternIndex])) {
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

function splitPatchableContent(content: string) {
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const hasTrailingLineEnding = normalizedContent.endsWith('\n')
  const lines = hasTrailingLineEnding
    ? normalizedContent.slice(0, -1).split('\n')
    : normalizedContent.length === 0
      ? []
      : normalizedContent.split('\n')

  return {
    hasTrailingLineEnding,
    lines,
  }
}

function normalizeContentLineEndings(content: string) {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function applyUpdateChunks(filePath: string, originalContent: string, chunks: readonly ApplyPatchUpdateChunk[]) {
  const {
    hasTrailingLineEnding,
    lines: originalLines,
  } = splitPatchableContent(originalContent)
  const replacements: Array<{ deleteCount: number; newLines: string[]; startIndex: number }> = []
  let searchStartIndex = 0

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const normalize = (str: string) => str.trim().replace(/\s+/g, ' ').replace(/^[-*]\s*/, '')
      const normContext = normalize(chunk.changeContext)
      let contextIndex = -1

      for (let i = searchStartIndex; i < originalLines.length; i++) {
        if (normalize(originalLines[i]).includes(normContext)) {
          contextIndex = i
          break
        }
      }

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
      throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join('\n')}`)
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

  return nextLines.join('\n') + (hasTrailingLineEnding || nextLines.length > 0 ? '\n' : '')
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
  const stagedFiles = new Map<string, StagedFileState>()
  const basePath = options?.basePath ? path.resolve(options.basePath) : workspaceRootPath
  const resolveTargetPath = (candidatePath: string) =>
    resolvePatchTargetPath(workspaceRootPath, candidatePath, options?.resolveTargetPath, basePath)
  const readRequiredContent = async (target: ApplyPatchTargetPath, operation: 'deletion' | 'update') => {
    const stagedFile = stagedFiles.get(target.absolutePath)
    if (stagedFile) {
      if (stagedFile.content === null) {
        throw new Error(`Failed to read file for ${operation} ${target.relativePath}: file is deleted by this patch`)
      }

      return stagedFile.content
    }

    return fs.readFile(target.absolutePath, 'utf8').catch((error: unknown) => {
      throw new Error(`Failed to read file for ${operation} ${target.relativePath}: ${(error as Error).message}`)
    })
  }

  for (const hunk of parsedPatch.hunks) {
    if (hunk.type === 'add') {
      const target = resolveTargetPath(hunk.path)
      const nextContent = hunk.contents.length === 0 || hunk.contents.endsWith('\n') ? hunk.contents : `${hunk.contents}\n`
      stagedFiles.set(target.absolutePath, {
        content: nextContent,
        target,
      })
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
      const existingContent = await readRequiredContent(target, 'deletion')
      stagedFiles.set(target.absolutePath, {
        content: null,
        target,
      })
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
    const existingContent = await readRequiredContent(sourceTarget, 'update')
    const nextContent = applyUpdateChunks(sourceTarget.relativePath, existingContent, hunk.chunks)
    const writeTarget = nextTarget ?? sourceTarget

    if (!nextTarget && nextContent === normalizeContentLineEndings(existingContent)) {
      throw new Error(`Patch did not change ${sourceTarget.relativePath}`)
    }

    stagedFiles.set(writeTarget.absolutePath, {
      content: nextContent,
      target: writeTarget,
    })
    if (nextTarget && nextTarget.absolutePath !== sourceTarget.absolutePath) {
      stagedFiles.set(sourceTarget.absolutePath, {
        content: null,
        target: sourceTarget,
      })
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

  for (const change of changes) {
    await options?.onBeforeChange?.({
      absolutePath: change.absolutePath,
      ...(change.nextAbsolutePath ? { nextAbsolutePath: change.nextAbsolutePath } : {}),
    })
  }

  for (const stagedFile of stagedFiles.values()) {
    if (stagedFile.content === null) {
      await fs.unlink(stagedFile.target.absolutePath)
      continue
    }

    await fs.mkdir(path.dirname(stagedFile.target.absolutePath), { recursive: true })
    await fs.writeFile(stagedFile.target.absolutePath, stagedFile.content, 'utf8')
  }

  return {
    changes,
    parsedPatch,
  }
}
