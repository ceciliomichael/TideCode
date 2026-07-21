import { promises as fs } from 'node:fs'
import path from 'node:path'
import { notifyWorkspaceExplorerChange } from './explorerNotifications'
import {
  isGitignored,
  loadGitignoreMatchers,
  shouldAlwaysShowEntry,
  shouldIgnoreWorkspaceEntry,
} from './gitignoreMatcher'
import {
  assertWorkspaceDirectory,
  DEFAULT_WORKSPACE_RELATIVE_PATH,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from './paths'
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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

  return sortWorkspaceEntries(explorerEntries)
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (!directoryEntries) {
      return
    }

    const gitignoreMatchers = await loadGitignoreMatchers(workspaceRootPath, directoryAbsolutePath)

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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File does not exist: ${target.relativePath}`)
    }
    throw error
  })
  if (!targetStats.isFile()) {
    throw new Error(`Expected a file: ${target.relativePath}`)
  }

  const binaryProbe = Buffer.alloc(Math.min(targetStats.size, 1024))
  if (binaryProbe.length > 0) {
    const fileHandle = await fs.open(target.absolutePath, 'r')
    try {
      await fileHandle.read(binaryProbe, 0, binaryProbe.length, 0)
    } finally {
      await fileHandle.close()
    }
  }
  if (hasBinaryContent(binaryProbe)) {
    return {
      content: '',
      isBinary: true,
      isTruncated: false,
      relativePath: target.relativePath,
      sizeBytes: targetStats.size,
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
  const content = fileBuffer.toString('utf8')

  return {
    content,
    isBinary: false,
    isTruncated,
    relativePath: target.relativePath,
    sizeBytes: targetStats.size,
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
      throw new Error(`Entry does not exist: ${target.relativePath}`)
    }
    throw error
  })
  if (!targetStats.isDirectory() && !targetStats.isFile()) {
    throw new Error(`Unsupported entry type: ${target.relativePath}`)
  }

  try {
    const { shell } = await import('electron')
    await shell.trashItem(target.absolutePath)
  } catch (error) {
    await fs.rm(target.absolutePath, {
      force: true,
      maxRetries: 3,
      recursive: targetStats.isDirectory(),
      retryDelay: 100,
    })
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
