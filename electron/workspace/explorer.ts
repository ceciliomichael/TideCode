import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createDocxPreviewDataUrl, isDocxPreviewablePath } from '../../src/lib/docx-preview'
import { createImagePreviewDataUrl, getImagePreviewMimeType } from '../../src/lib/image-preview'
import { createPdfPreviewDataUrl, isPdfPreviewablePath } from '../../src/lib/pdf-preview'
import { notifyWorkspaceExplorerChange } from './explorerNotifications'
import {
  isGitignored,
  loadGitignoreMatchers,
  shouldAlwaysShowEntry,
  shouldIgnoreWorkspaceEntry,
  WORKSPACE_IGNORED_ENTRY_NAMES,
} from './gitignoreMatcher'
import {
  assertWorkspaceDirectory,
  DEFAULT_WORKSPACE_RELATIVE_PATH,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from './paths'
import { isSkippableWorkspaceTraversalError } from './workspaceTraversal'
import type {
  WorkspaceRefactorCandidate,
  WorkspaceRefactorCandidatesInput,
  WorkspaceExplorerCreateEntryInput,
  WorkspaceExplorerCreateEntryResult,
  WorkspaceExplorerDeleteEntryInput,
  WorkspaceExplorerDeleteEntryResult,
  WorkspaceExplorerEntry,
  WorkspaceExplorerListDirectoryInput,
  WorkspaceExplorerReadFileInput,
  WorkspaceExplorerReadFileMissingResult,
  WorkspaceExplorerReadFileResult,
  WorkspaceExplorerRenameEntryInput,
  WorkspaceExplorerRenameEntryResult,
  WorkspaceExplorerTransferEntryInput,
  WorkspaceExplorerTransferEntryResult,
  WorkspaceExplorerWriteFileInput,
  WorkspaceExplorerWriteFileResult,
} from '../../src/types/chat'
import type { WorkspaceEntryVisibility } from './gitignoreMatcher'
const MAX_TEXT_FILE_BYTES = 256 * 1024
const MAX_IMAGE_PREVIEW_BYTES = 32 * 1024 * 1024
const MAX_DOCX_PREVIEW_BYTES = 32 * 1024 * 1024
const MAX_PDF_PREVIEW_BYTES = 64 * 1024 * 1024
const MAX_RECURSIVE_WORKSPACE_FILES = 10_000
const MAX_RECURSIVE_WORKSPACE_DIRECTORIES = 1_000

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function createMissingFileResult(relativePath: string): WorkspaceExplorerReadFileMissingResult {
  return {
    relativePath,
    status: 'missing',
  }
}

function trimBufferToValidUtf8(buffer: Buffer): Buffer {
  if (buffer.length === 0) return buffer
  let i = buffer.length - 1
  while (i >= 0 && (buffer[i] & 0xc0) === 0x80) i--
  if (i < 0) return buffer
  const b = buffer[i]
  let expectedLen = 1
  if ((b & 0xe0) === 0xc0) expectedLen = 2
  else if ((b & 0xf0) === 0xe0) expectedLen = 3
  else if ((b & 0xf8) === 0xf0) expectedLen = 4
  const actualLen = buffer.length - i
  return actualLen >= expectedLen ? buffer : buffer.slice(0, i)
}
const REFACTOR_CANDIDATE_LINE_THRESHOLD = 300
const REFACTOR_CODE_EXTENSIONS = new Set([
  '.astro',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.cxx',
  '.dart',
  '.erb',
  '.ex',
  '.exs',
  '.fs',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.lua',
  '.mjs',
  '.php',
  '.py',
  '.pyw',
  '.rb',
  '.rs',
  '.scala',
  '.svelte',
  '.swift',
  '.ts',
  '.tsx',
  '.vb',
  '.vue',
])
const REFACTOR_IGNORED_DIRECTORY_NAMES = new Set(
  [...WORKSPACE_IGNORED_ENTRY_NAMES, 'AppData', 'Application Data', 'Local Settings']
    .map((entryName) => entryName.toLowerCase()),
)

function sortWorkspaceEntries(entries: WorkspaceExplorerEntry[]) {
  return entries.sort((left, right) => {
    if (left.isDirectory && !right.isDirectory) {
      return -1
    }
    if (!left.isDirectory && right.isDirectory) {
      return 1
    }
    return left.name.localeCompare(right.name)
  })
}

function hasBinaryContent(buffer: Buffer) {
  const probeLength = Math.min(buffer.length, 1024)
  for (let index = 0; index < probeLength; index += 1) {
    if (buffer[index] === 0) {
      return true
    }
  }
  return false
}

function isRefactorCandidateFile(fileName: string) {
  return REFACTOR_CODE_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

async function countCandidateFileLines(targetPath: string, threshold: number) {
  const targetStats = await fs.stat(targetPath).catch((error: unknown) => {
    if (isSkippableWorkspaceTraversalError(error)) {
      return null
    }
    throw error
  })

  if (!targetStats?.isFile()) {
    return 0
  }

  const minimumBytes = threshold * 20
  if (targetStats.size < minimumBytes) {
    return 0
  }

  const fileBuffer = await fs.readFile(targetPath).catch((error: unknown) => {
    if (isSkippableWorkspaceTraversalError(error)) {
      return null
    }
    throw error
  })
  if (!fileBuffer || hasBinaryContent(fileBuffer)) {
    return 0
  }

  let lineCount = fileBuffer.length === 0 ? 0 : 1
  for (let index = 0; index < fileBuffer.length; index += 1) {
    if (fileBuffer[index] === 10) {
      lineCount += 1
    }
  }

  return lineCount > threshold ? lineCount : 0
}

function shouldApplyGitignoreFiltering(visibility: WorkspaceEntryVisibility) {
  return visibility === 'workspace'
}

function shouldLoadGitignoreMatchers(visibility: WorkspaceEntryVisibility) {
  return visibility === 'workspace' || visibility === 'explorer'
}

async function statIfExists(targetPath: string) {
  return fs.stat(targetPath).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }
    throw error
  })
}

async function copyDirectoryRecursively(sourcePath: string, targetPath: string) {
  await fs.mkdir(targetPath, { recursive: true })
  const entries = await fs.readdir(sourcePath, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue
    }

    const sourceEntryPath = path.join(sourcePath, entry.name)
    const targetEntryPath = path.join(targetPath, entry.name)

    if (entry.isDirectory()) {
      await copyDirectoryRecursively(sourceEntryPath, targetEntryPath)
      continue
    }

    if (entry.isFile()) {
      await fs.copyFile(sourceEntryPath, targetEntryPath)
    }
  }
}

function isNestedWithinDirectory(parentAbsolutePath: string, targetAbsolutePath: string) {
  const relativePath = path.relative(parentAbsolutePath, targetAbsolutePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function withNameSuffix(entryName: string, suffix: string, isDirectory: boolean) {
  if (isDirectory) {
    return `${entryName}${suffix}`
  }

  const parsedPath = path.parse(entryName)
  return `${parsedPath.name}${suffix}${parsedPath.ext}`
}

async function resolveTransferDestinationPath(
  destinationDirectoryAbsolutePath: string,
  destinationDirectoryRelativePath: string,
  sourceEntryName: string,
  isDirectory: boolean,
  mode: 'copy' | 'move',
) {
  for (let attempt = 0; ; attempt += 1) {
    let candidateName = sourceEntryName
    if (attempt > 0) {
      candidateName =
        mode === 'copy'
          ? withNameSuffix(sourceEntryName, attempt === 1 ? ' copy' : ` copy ${attempt}`, isDirectory)
          : withNameSuffix(sourceEntryName, ` ${attempt + 1}`, isDirectory)
    }

    const candidateAbsolutePath = path.join(destinationDirectoryAbsolutePath, candidateName)
    const candidateRelativePath =
      destinationDirectoryRelativePath === DEFAULT_WORKSPACE_RELATIVE_PATH
        ? candidateName
        : path.join(destinationDirectoryRelativePath, candidateName)

    const existingStats = await statIfExists(candidateAbsolutePath)
    if (!existingStats) {
      return {
        absolutePath: candidateAbsolutePath,
        relativePath: candidateRelativePath,
      }
    }
  }
}

export async function listWorkspaceDirectory(input: WorkspaceExplorerListDirectoryInput) {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  const visibility = input.visibility ?? 'workspace'
  await assertWorkspaceDirectory(workspaceRootPath)
  const target = getSafeWorkspaceTargetPath(workspaceRootPath, input.relativePath)
  const targetStats = await fs.stat(target.absolutePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory does not exist: ${target.relativePath}`)
    }
    throw error
  })
  if (!targetStats.isDirectory()) {
    throw new Error(`Expected a directory: ${target.relativePath}`)
  }

  const directoryEntries = await fs.readdir(target.absolutePath, { withFileTypes: true })
  const gitignoreMatchers = shouldLoadGitignoreMatchers(visibility)
    ? await loadGitignoreMatchers(workspaceRootPath, target.absolutePath)
    : []
  const explorerEntries: WorkspaceExplorerEntry[] = []
  for (const directoryEntry of directoryEntries) {
    if (directoryEntry.isSymbolicLink()) {
      continue
    }
    const isDirectory = directoryEntry.isDirectory()
    if (!isDirectory && !directoryEntry.isFile()) {
      continue
    }
    if (shouldIgnoreWorkspaceEntry(directoryEntry.name, visibility)) {
      continue
    }
    const entryAbsolutePath = path.join(target.absolutePath, directoryEntry.name)
    const entryIsGitignored = isGitignored(entryAbsolutePath, isDirectory, gitignoreMatchers)

    if (
      shouldApplyGitignoreFiltering(visibility) &&
      entryIsGitignored &&
      !shouldAlwaysShowEntry(directoryEntry.name)
    ) {
      continue
    }
    const entryRelativePath =
      target.relativePath === DEFAULT_WORKSPACE_RELATIVE_PATH
        ? directoryEntry.name
        : path.join(target.relativePath, directoryEntry.name)

    explorerEntries.push({
      isDirectory,
      isGitignored: visibility === 'explorer' ? entryIsGitignored : undefined,
      name: directoryEntry.name,
      relativePath: entryRelativePath,
    })
  }

  const sortedEntries = sortWorkspaceEntries(explorerEntries)
  if (!input.recursive) {
    return sortedEntries
  }

  const recursiveEntries: WorkspaceExplorerEntry[] = []
  let fileCount = 0
  let directoryCount = 0
  const isAtLimit = () =>
    fileCount >= MAX_RECURSIVE_WORKSPACE_FILES ||
    directoryCount >= MAX_RECURSIVE_WORKSPACE_DIRECTORIES

  async function collectEntries(entries: readonly WorkspaceExplorerEntry[]) {
    for (const entry of entries) {
      if (isAtLimit()) {
        return
      }

      recursiveEntries.push(entry)
      if (!entry.isDirectory) {
        fileCount += 1
        continue
      }

      directoryCount += 1
      if (isAtLimit()) {
        return
      }

      const childEntries = await listWorkspaceDirectory({
        relativePath: entry.relativePath,
        visibility,
        workspaceRootPath,
      })
      await collectEntries(childEntries)
    }
  }

  await collectEntries(sortedEntries)
  return recursiveEntries
}

export async function listWorkspaceRefactorCandidates(
  input: WorkspaceRefactorCandidatesInput,
): Promise<WorkspaceRefactorCandidate[]> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const candidates: WorkspaceRefactorCandidate[] = []

  async function visitDirectory(
    directoryAbsolutePath: string,
    directoryRelativePath: string = DEFAULT_WORKSPACE_RELATIVE_PATH,
  ) {
    const directoryEntries = await fs.readdir(directoryAbsolutePath, { withFileTypes: true }).catch((error: unknown) => {
      if (isSkippableWorkspaceTraversalError(error)) {
        return null
      }
      throw error
    })
    if (!directoryEntries) {
      return
    }

    const gitignoreMatchers = await loadGitignoreMatchers(workspaceRootPath, directoryAbsolutePath).catch(
      (error: unknown) => {
        if (isSkippableWorkspaceTraversalError(error)) {
          return []
        }
        throw error
      },
    )

    for (const directoryEntry of directoryEntries) {
      if (directoryEntry.isSymbolicLink()) {
        continue
      }

      const isDirectory = directoryEntry.isDirectory()
      if (!isDirectory && !directoryEntry.isFile()) {
        continue
      }

      if (shouldIgnoreWorkspaceEntry(directoryEntry.name, 'workspace')) {
        continue
      }

      if (isDirectory && REFACTOR_IGNORED_DIRECTORY_NAMES.has(directoryEntry.name.toLowerCase())) {
        continue
      }

      const entryAbsolutePath = path.join(directoryAbsolutePath, directoryEntry.name)
      if (!shouldAlwaysShowEntry(directoryEntry.name) && isGitignored(entryAbsolutePath, isDirectory, gitignoreMatchers)) {
        continue
      }

      const entryRelativePath =
        directoryRelativePath === DEFAULT_WORKSPACE_RELATIVE_PATH
          ? directoryEntry.name
          : path.join(directoryRelativePath, directoryEntry.name)

      if (isDirectory) {
        await visitDirectory(entryAbsolutePath, entryRelativePath)
        continue
      }

      if (!isRefactorCandidateFile(directoryEntry.name)) {
        continue
      }

      const lineCount = await countCandidateFileLines(entryAbsolutePath, REFACTOR_CANDIDATE_LINE_THRESHOLD)
      if (lineCount === 0) {
        continue
      }

        candidates.push({
          lineCount,
          relativePath: entryRelativePath,
        })
    }
  }

  await visitDirectory(workspaceRootPath)

  return candidates
    .sort((left, right) => {
      if (right.lineCount !== left.lineCount) {
        return right.lineCount - left.lineCount
      }

      return left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' })
    })
}

export async function readWorkspaceFile(input: WorkspaceExplorerReadFileInput): Promise<WorkspaceExplorerReadFileResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const target = getSafeWorkspaceTargetPath(workspaceRootPath, input.relativePath)
  const targetStats = await fs.stat(target.absolutePath).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  })
  if (!targetStats) {
    return createMissingFileResult(target.relativePath)
  }
  if (!targetStats.isFile()) {
    throw new Error(`Expected a file: ${target.relativePath}`)
  }

  try {
    const binaryProbe = Buffer.alloc(Math.min(targetStats.size, 1024))
    if (binaryProbe.length > 0) {
      const fileHandle = await fs.open(target.absolutePath, 'r')
      try {
        await fileHandle.read(binaryProbe, 0, binaryProbe.length, 0)
      } finally {
        await fileHandle.close()
      }
    }

    const previewMimeType = getImagePreviewMimeType(target.relativePath)
    const isDocxPreview = isDocxPreviewablePath(target.relativePath)
    const isPdfPreview = isPdfPreviewablePath(target.relativePath)
    if (previewMimeType || isDocxPreview || isPdfPreview) {
      const maxPreviewBytes = isPdfPreview
        ? MAX_PDF_PREVIEW_BYTES
        : isDocxPreview
          ? MAX_DOCX_PREVIEW_BYTES
          : MAX_IMAGE_PREVIEW_BYTES
      if (targetStats.size > maxPreviewBytes) {
        const previewLabel = isPdfPreview ? 'PDF' : isDocxPreview ? 'DOCX' : 'Image'
        return {
          content: '',
          isBinary: true,
          isTruncated: false,
          modifiedTimeMs: targetStats.mtimeMs,
          previewError: `${previewLabel} preview is limited to ${maxPreviewBytes / (1024 * 1024)} MB.`,
          previewMimeType: isPdfPreview
            ? 'application/pdf'
            : isDocxPreview
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : previewMimeType ?? undefined,
          relativePath: target.relativePath,
          sizeBytes: targetStats.size,
          status: 'ready',
        }
      }

      const previewBuffer = await fs.readFile(target.absolutePath)
      return {
        content: '',
        isBinary: true,
        isTruncated: false,
        modifiedTimeMs: targetStats.mtimeMs,
        previewDataUrl: isPdfPreview
          ? createPdfPreviewDataUrl(previewBuffer.toString('base64'))
          : isDocxPreview
            ? createDocxPreviewDataUrl(previewBuffer.toString('base64'))
            : createImagePreviewDataUrl(previewMimeType!, previewBuffer.toString('base64')),
        previewMimeType: isPdfPreview
          ? 'application/pdf'
          : isDocxPreview
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : previewMimeType ?? undefined,
        relativePath: target.relativePath,
        sizeBytes: targetStats.size,
        status: 'ready',
      }
    }

    if (hasBinaryContent(binaryProbe)) {
      return {
        content: '',
        isBinary: true,
        isTruncated: false,
        modifiedTimeMs: targetStats.mtimeMs,
        relativePath: target.relativePath,
        sizeBytes: targetStats.size,
        status: 'ready',
      }
    }

    const isTruncated = targetStats.size > MAX_TEXT_FILE_BYTES
    const bytesToRead = isTruncated ? MAX_TEXT_FILE_BYTES : targetStats.size
    const fileBuffer = Buffer.alloc(bytesToRead)
    if (bytesToRead > 0) {
      const fileHandle = await fs.open(target.absolutePath, 'r')
      try {
        await fileHandle.read(fileBuffer, 0, bytesToRead, 0)
      } finally {
        await fileHandle.close()
      }
    }
    const safeBuffer = isTruncated ? trimBufferToValidUtf8(fileBuffer) : fileBuffer
    const content = safeBuffer.toString('utf8')

    return {
      content,
      isBinary: false,
      isTruncated,
      modifiedTimeMs: targetStats.mtimeMs,
      relativePath: target.relativePath,
      sizeBytes: targetStats.size,
      status: 'ready',
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return createMissingFileResult(target.relativePath)
    }
    throw error
  }
}

export async function writeWorkspaceFile(input: WorkspaceExplorerWriteFileInput): Promise<WorkspaceExplorerWriteFileResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const target = getSafeWorkspaceTargetPath(workspaceRootPath, input.relativePath)
  await fs.mkdir(path.dirname(target.absolutePath), { recursive: true })
  await fs.writeFile(target.absolutePath, input.content, 'utf8')
  const writtenStats = await fs.stat(target.absolutePath)

  notifyWorkspaceExplorerChange(workspaceRootPath)

  return {
    relativePath: target.relativePath,
    sizeBytes: writtenStats.size,
  }
}

export async function createWorkspaceEntry(
  input: WorkspaceExplorerCreateEntryInput,
): Promise<WorkspaceExplorerCreateEntryResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const target = getSafeWorkspaceTargetPath(workspaceRootPath, input.relativePath)
  if (target.relativePath === DEFAULT_WORKSPACE_RELATIVE_PATH) {
    throw new Error('Cannot create workspace root.')
  }

  const existingStats = await fs.stat(target.absolutePath).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (existingStats) {
    throw new Error(`Entry already exists: ${target.relativePath}`)
  }

  await fs.mkdir(path.dirname(target.absolutePath), { recursive: true })
  if (input.isDirectory) {
    await fs.mkdir(target.absolutePath)
  } else {
    await fs.writeFile(target.absolutePath, '', { encoding: 'utf8', flag: 'wx' })
  }

  notifyWorkspaceExplorerChange(workspaceRootPath)

  return {
    isDirectory: input.isDirectory,
    relativePath: target.relativePath,
  }
}

export async function renameWorkspaceEntry(
  input: WorkspaceExplorerRenameEntryInput,
): Promise<WorkspaceExplorerRenameEntryResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const sourceTarget = getSafeWorkspaceTargetPath(workspaceRootPath, input.relativePath)
  const destinationTarget = getSafeWorkspaceTargetPath(workspaceRootPath, input.nextRelativePath)
  if (
    sourceTarget.relativePath === DEFAULT_WORKSPACE_RELATIVE_PATH ||
    destinationTarget.relativePath === DEFAULT_WORKSPACE_RELATIVE_PATH
  ) {
    throw new Error('Cannot rename workspace root.')
  }
  if (sourceTarget.relativePath === destinationTarget.relativePath) {
    return {
      nextRelativePath: destinationTarget.relativePath,
      relativePath: sourceTarget.relativePath,
    }
  }

  const sourceStats = await fs.stat(sourceTarget.absolutePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Entry does not exist: ${sourceTarget.relativePath}`)
    }
    throw error
  })
  if (!sourceStats.isDirectory() && !sourceStats.isFile()) {
    throw new Error(`Unsupported entry type: ${sourceTarget.relativePath}`)
  }

  const destinationStats = await fs.stat(destinationTarget.absolutePath).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (destinationStats) {
    throw new Error(`Entry already exists: ${destinationTarget.relativePath}`)
  }

  await fs.mkdir(path.dirname(destinationTarget.absolutePath), { recursive: true })
  await fs.rename(sourceTarget.absolutePath, destinationTarget.absolutePath)

  notifyWorkspaceExplorerChange(workspaceRootPath)

  return {
    nextRelativePath: destinationTarget.relativePath,
    relativePath: sourceTarget.relativePath,
  }
}

const DISPOSABLE_DIRECTORY_NAMES = new Set([
  '.angular',
  '.cache',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.pytest_cache',
  '.rollup.cache',
  '.svelte-kit',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'venv',
])

function isDisposableDirectory(relativePath: string): boolean {
  const segments = relativePath.split(/[/\\]/u).map((segment) => segment.trim().toLowerCase())
  return segments.some((segment) => DISPOSABLE_DIRECTORY_NAMES.has(segment))
}

export async function deleteWorkspaceEntry(
  input: WorkspaceExplorerDeleteEntryInput,
): Promise<WorkspaceExplorerDeleteEntryResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const target = getSafeWorkspaceTargetPath(workspaceRootPath, input.relativePath)
  if (target.relativePath === DEFAULT_WORKSPACE_RELATIVE_PATH) {
    throw new Error('Cannot delete workspace root.')
  }

  const targetStats = await fs.stat(target.absolutePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (!targetStats) {
    return {
      relativePath: target.relativePath,
    }
  }

  if (!targetStats.isDirectory() && !targetStats.isFile()) {
    throw new Error(`Unsupported entry type: ${target.relativePath}`)
  }

  if (targetStats.isDirectory() && isDisposableDirectory(target.relativePath)) {
    await fs.rm(target.absolutePath, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    })
  } else {
    try {
      const { shell } = await import('electron')
      await shell.trashItem(target.absolutePath)
    } catch {
      await fs.rm(target.absolutePath, {
        force: true,
        maxRetries: 3,
        recursive: targetStats.isDirectory(),
        retryDelay: 100,
      })
    }
  }

  notifyWorkspaceExplorerChange(workspaceRootPath)

  return {
    relativePath: target.relativePath,
  }
}

export async function transferWorkspaceEntry(
  input: WorkspaceExplorerTransferEntryInput,
): Promise<WorkspaceExplorerTransferEntryResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const sourceTarget = getSafeWorkspaceTargetPath(workspaceRootPath, input.relativePath)
  const destinationDirectoryTarget = getSafeWorkspaceTargetPath(workspaceRootPath, input.targetDirectoryRelativePath)

  if (sourceTarget.relativePath === DEFAULT_WORKSPACE_RELATIVE_PATH) {
    throw new Error('Cannot transfer workspace root.')
  }

  const sourceStats = await fs.stat(sourceTarget.absolutePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Entry does not exist: ${sourceTarget.relativePath}`)
    }
    throw error
  })
  if (!sourceStats.isDirectory() && !sourceStats.isFile()) {
    throw new Error(`Unsupported entry type: ${sourceTarget.relativePath}`)
  }

  const destinationDirectoryStats = await fs.stat(destinationDirectoryTarget.absolutePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory does not exist: ${destinationDirectoryTarget.relativePath}`)
    }
    throw error
  })
  if (!destinationDirectoryStats.isDirectory()) {
    throw new Error(`Expected a directory: ${destinationDirectoryTarget.relativePath}`)
  }

  if (
    sourceStats.isDirectory() &&
    isNestedWithinDirectory(sourceTarget.absolutePath, destinationDirectoryTarget.absolutePath)
  ) {
    throw new Error('Cannot place a folder inside itself.')
  }

  const sourceParentRelativePath = getSafeWorkspaceTargetPath(
    workspaceRootPath,
    path.dirname(sourceTarget.relativePath),
  ).relativePath
  const sourceEntryName = path.basename(sourceTarget.relativePath)
  if (
    input.mode === 'move' &&
    destinationDirectoryTarget.relativePath === sourceParentRelativePath
  ) {
    return {
      mode: input.mode,
      relativePath: sourceTarget.relativePath,
      targetRelativePath: sourceTarget.relativePath,
    }
  }

  const destinationTarget = await resolveTransferDestinationPath(
    destinationDirectoryTarget.absolutePath,
    destinationDirectoryTarget.relativePath,
    sourceEntryName,
    sourceStats.isDirectory(),
    input.mode,
  )

  if (input.mode === 'copy') {
    if (sourceStats.isDirectory()) {
      await fs.cp(sourceTarget.absolutePath, destinationTarget.absolutePath, {
        errorOnExist: true,
        force: false,
        recursive: true,
      })
    } else {
      await fs.copyFile(sourceTarget.absolutePath, destinationTarget.absolutePath)
    }
  } else {
    await fs.rename(sourceTarget.absolutePath, destinationTarget.absolutePath)
  }

  notifyWorkspaceExplorerChange(workspaceRootPath)

  return {
    mode: input.mode,
    relativePath: sourceTarget.relativePath,
    targetRelativePath: destinationTarget.relativePath,
  }
}

export async function importWorkspaceEntry(input: {
  sourcePath: string
  targetDirectoryRelativePath?: string
  workspaceRootPath: string
}): Promise<WorkspaceExplorerTransferEntryResult> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)

  const sourcePath = path.resolve(input.sourcePath.trim())
  const sourceStats = await fs.stat(sourcePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Entry does not exist: ${sourcePath}`)
    }
    throw error
  })

  if (!sourceStats.isDirectory() && !sourceStats.isFile()) {
    throw new Error(`Unsupported entry type: ${sourcePath}`)
  }

  const destinationDirectoryTarget = getSafeWorkspaceTargetPath(workspaceRootPath, input.targetDirectoryRelativePath)
  const destinationDirectoryStats = await fs.stat(destinationDirectoryTarget.absolutePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory does not exist: ${destinationDirectoryTarget.relativePath}`)
    }
    throw error
  })

  if (!destinationDirectoryStats.isDirectory()) {
    throw new Error(`Expected a directory: ${destinationDirectoryTarget.relativePath}`)
  }

  const sourceEntryName = path.basename(sourcePath)
  const destinationTarget = await resolveTransferDestinationPath(
    destinationDirectoryTarget.absolutePath,
    destinationDirectoryTarget.relativePath,
    sourceEntryName,
    sourceStats.isDirectory(),
    'copy',
  )

  if (sourceStats.isDirectory()) {
    await copyDirectoryRecursively(sourcePath, destinationTarget.absolutePath)
  } else {
    await fs.copyFile(sourcePath, destinationTarget.absolutePath)
  }

  notifyWorkspaceExplorerChange(workspaceRootPath)

  return {
    mode: 'copy',
    relativePath: sourcePath,
    targetRelativePath: destinationTarget.relativePath,
  }
}
