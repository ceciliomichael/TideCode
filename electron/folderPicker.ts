import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  FolderPickerBreadcrumb,
  FolderPickerClipboardMode,
  FolderPickerDirectory,
  FolderPickerEntry,
  FolderPickerRoot,
  FolderPickerRootKind,
  FolderPickerRoots,
} from '../src/types/chat'
import {
  TIDECODE_WORKSPACE_CLIPBOARD_FORMAT,
  writeWindowsFileClipboard,
} from './clipboard/windowsDropFilesWriter'
import { readClipboardFilesDirect } from './clipboard/windowsDropFilesParser'

const WINDOWS_DRIVE_PROBE_TIMEOUT_MS = 400
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu
const FOLDER_PICKER_CLIPBOARD_MARKER_KIND = 'tidecode-folder-picker'

function isPresent<T>(value: T | null): value is T {
  return value !== null
}

function normalizeDirectoryPath(directoryPath: string) {
  const trimmedPath = directoryPath.trim()
  if (trimmedPath.length === 0) {
    throw new Error('Folder path is required.')
  }
  return path.resolve(trimmedPath)
}

function normalizePathForComparison(value: string) {
  const resolvedPath = path.resolve(value)
  return process.platform === 'win32' ? resolvedPath.toLocaleLowerCase() : resolvedPath
}

function arePathsEqual(left: string, right: string) {
  return normalizePathForComparison(left) === normalizePathForComparison(right)
}

function isSameOrNestedPath(parentPath: string, candidatePath: string) {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath))
  return relativePath === ''
    || (!relativePath.startsWith('..' + path.sep) && relativePath !== '..' && !path.isAbsolute(relativePath))
}

async function isDirectory(directoryPath: string) {
  try {
    return (await fs.stat(directoryPath)).isDirectory()
  } catch {
    return false
  }
}

async function pathExists(targetPath: string) {
  try {
    await fs.stat(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function isDirectoryWithinTimeout(directoryPath: string, timeoutMs: number) {
  let timeoutId: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      isDirectory(directoryPath),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function getBreadcrumbs(directoryPath: string): FolderPickerBreadcrumb[] {
  const parsedPath = path.parse(directoryPath)
  const rootPath = parsedPath.root
  const breadcrumbs: FolderPickerBreadcrumb[] = [{
    label: process.platform === 'win32' ? rootPath.replace(/[\\/]$/u, '') : rootPath,
    path: rootPath,
  }]

  const relativePath = path.relative(rootPath, directoryPath)
  if (!relativePath) {
    return breadcrumbs
  }

  let currentPath = rootPath
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment)
    breadcrumbs.push({
      label: segment,
      path: currentPath,
    })
  }
  return breadcrumbs
}

async function getExistingSpecialRoot(
  kind: FolderPickerRootKind,
  label: string,
  directoryPath: string,
): Promise<FolderPickerRoot | null> {
  if (!await isDirectory(directoryPath)) {
    return null
  }
  return {
    kind,
    label,
    path: path.resolve(directoryPath),
  }
}

function toWindowsComparisonPath(value: string) {
  return path.resolve(value).toLocaleLowerCase()
}

async function getWindowsSystemDirectoryPaths(directoryPath: string) {
  if (process.platform !== 'win32') {
    return new Set<string>()
  }

  const output = await new Promise<string>((resolve) => {
    execFile(
      'attrib',
      [path.join(directoryPath, '*'), '/D'],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout) => {
        if (error && !stdout) {
          resolve('')
          return
        }
        resolve(stdout)
      },
    )
  })

  const systemDirectoryPaths = new Set<string>()
  for (const rawLine of output.split(/\r?\n/gu)) {
    const pathMatch = rawLine.match(/([A-Z]:\\.*)$/iu)
    if (!pathMatch || pathMatch.index === undefined) {
      continue
    }
    const attributePrefix = rawLine.slice(0, pathMatch.index).toUpperCase()
    if (!attributePrefix.includes('S')) {
      continue
    }
    systemDirectoryPaths.add(toWindowsComparisonPath(pathMatch[1]))
  }

  return systemDirectoryPaths
}

async function getWindowsDriveRoots() {
  if (process.platform !== 'win32') {
    return [] as FolderPickerRoot[]
  }

  const drivePaths = Array.from(
    { length: 26 },
    (_, index) => String.fromCharCode(65 + index) + ':\\',
  )
  const roots = await Promise.all(
    drivePaths.map(async (drivePath) => {
      if (!await isDirectoryWithinTimeout(drivePath, WINDOWS_DRIVE_PROBE_TIMEOUT_MS)) {
        return null
      }
      return {
        kind: 'drive' as const,
        label: drivePath.slice(0, 2) + ' Local Disk',
        path: drivePath,
      }
    }),
  )
  return roots.filter(isPresent)
}

function dedupeRoots(roots: FolderPickerRoot[]) {
  const seen = new Set<string>()
  return roots.filter((root) => {
    const comparisonPath = process.platform === 'win32' ? root.path.toLocaleLowerCase() : root.path
    if (seen.has(comparisonPath)) {
      return false
    }
    seen.add(comparisonPath)
    return true
  })
}

export async function getFolderPickerRoots(): Promise<FolderPickerRoots> {
  const homePath = os.homedir()
  const specialRootCandidates = [
    getExistingSpecialRoot('home', 'Home', homePath),
    getExistingSpecialRoot('desktop', 'Desktop', path.join(homePath, 'Desktop')),
    getExistingSpecialRoot('downloads', 'Downloads', path.join(homePath, 'Downloads')),
    getExistingSpecialRoot('documents', 'Documents', path.join(homePath, 'Documents')),
    getExistingSpecialRoot('pictures', 'Pictures', path.join(homePath, 'Pictures')),
    getExistingSpecialRoot('music', 'Music', path.join(homePath, 'Music')),
    getExistingSpecialRoot('videos', 'Videos', path.join(homePath, 'Videos')),
  ]

  const [specialRoots, driveRoots] = await Promise.all([
    Promise.all(specialRootCandidates),
    getWindowsDriveRoots(),
  ])
  const roots = dedupeRoots([
    ...specialRoots.filter(isPresent),
    ...driveRoots,
  ])

  const homeRoot = roots.find((root) => root.kind === 'home')
  const initialRoot = homeRoot ?? roots[0]
  if (!initialRoot) {
    throw new Error('No accessible folders are available.')
  }

  return {
    initialPath: initialRoot.path,
    roots,
  }
}

export async function listFolderPickerDirectory(directoryPath: string): Promise<FolderPickerDirectory> {
  const normalizedPath = normalizeDirectoryPath(directoryPath)
  const stats = await fs.stat(normalizedPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Folder does not exist: ' + normalizedPath)
    }
    throw error
  })
  if (!stats.isDirectory()) {
    throw new Error('Expected a folder: ' + normalizedPath)
  }

  const [directoryEntries, windowsSystemDirectoryPaths] = await Promise.all([
    fs.readdir(normalizedPath, { withFileTypes: true }),
    getWindowsSystemDirectoryPaths(normalizedPath),
  ])
  const entries: FolderPickerEntry[] = []
  for (const directoryEntry of directoryEntries) {
    if (directoryEntry.isSymbolicLink() || !directoryEntry.isDirectory()) {
      continue
    }
    const entryPath = path.join(normalizedPath, directoryEntry.name)
    if (
      process.platform === 'win32'
      && windowsSystemDirectoryPaths.has(toWindowsComparisonPath(entryPath))
    ) {
      continue
    }
    entries.push({
      name: directoryEntry.name,
      path: entryPath,
    })
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))

  const rootPath = path.parse(normalizedPath).root
  return {
    breadcrumbs: getBreadcrumbs(normalizedPath),
    entries,
    parentPath: normalizedPath === rootPath ? null : path.dirname(normalizedPath),
    path: normalizedPath,
  }
}

function validateNewFolderName(folderName: string) {
  const normalizedName = folderName.trim()
  if (normalizedName.length === 0) {
    throw new Error('Folder name is required.')
  }
  if (
    normalizedName === '.'
    || normalizedName === '..'
    || normalizedName.includes('/')
    || normalizedName.includes('\\')
  ) {
    throw new Error('Folder name is invalid.')
  }
  if (process.platform === 'win32') {
    if (
      /[<>:"|?*]/u.test(normalizedName)
      || /[. ]$/u.test(normalizedName)
      || WINDOWS_RESERVED_NAME_PATTERN.test(normalizedName)
    ) {
      throw new Error('Folder name is invalid on Windows.')
    }
  }
  return normalizedName
}

async function readNativeClipboardPaths() {
  if (process.platform === 'win32') {
    const { windowsClipboard } = await import('./clipboard/windowsClipboardReader')
    const windowsPaths = await windowsClipboard.readFiles()
    if (windowsPaths.length > 0) {
      return windowsPaths
    }
  }

  const { clipboard } = await import('electron')
  try {
    const directPaths = readClipboardFilesDirect(clipboard)
    if (directPaths.length > 0) {
      return directPaths
    }
  } catch {
    // Fall through to URI/text clipboard formats.
  }

  const uriList = clipboard.read('text/uri-list')
  if (uriList.trim().length > 0) {
    return uriList
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('file://'))
      .map((line) => decodeURIComponent(line.replace(/^file:\/\//u, '')))
      .filter(Boolean)
  }

  return []
}

async function readClipboardMode(): Promise<FolderPickerClipboardMode> {
  const { clipboard } = await import('electron')
  const marker = clipboard.readBuffer(TIDECODE_WORKSPACE_CLIPBOARD_FORMAT)
  if (marker.length > 0) {
    try {
      const parsed = JSON.parse(marker.toString('utf8')) as {
        mode?: unknown
      }
      if (parsed.mode === 'copy' || parsed.mode === 'cut') {
        return parsed.mode
      }
    } catch {
      // Ignore unrelated clipboard marker payloads.
    }
  }

  const preferredDropEffect = clipboard.readBuffer('Preferred DropEffect')
  if (preferredDropEffect.length >= 4 && preferredDropEffect.readUInt32LE(0) === 2) {
    return 'cut'
  }
  return 'copy'
}

async function resolveFolderPasteDestination(
  targetDirectoryPath: string,
  sourceDirectoryPath: string,
) {
  const sourceName = path.basename(sourceDirectoryPath)
  let candidatePath = path.join(targetDirectoryPath, sourceName)
  if (!await pathExists(candidatePath)) {
    return candidatePath
  }

  candidatePath = path.join(targetDirectoryPath, sourceName + ' - Copy')
  if (!await pathExists(candidatePath)) {
    return candidatePath
  }

  let copyIndex = 2
  while (true) {
    candidatePath = path.join(targetDirectoryPath, sourceName + ' - Copy (' + copyIndex + ')')
    if (!await pathExists(candidatePath)) {
      return candidatePath
    }
    copyIndex += 1
  }
}

export async function createFolderPickerDirectory(
  parentPath: string,
  folderName: string,
): Promise<FolderPickerEntry> {
  const normalizedParentPath = normalizeDirectoryPath(parentPath)
  const parentStats = await fs.stat(normalizedParentPath)
  if (!parentStats.isDirectory()) {
    throw new Error('Expected a folder: ' + normalizedParentPath)
  }

  const normalizedName = validateNewFolderName(folderName)
  const createdPath = path.join(normalizedParentPath, normalizedName)
  await fs.mkdir(createdPath)
  return {
    name: normalizedName,
    path: createdPath,
  }
}

export async function renameFolderPickerDirectory(
  folderPath: string,
  folderName: string,
): Promise<FolderPickerEntry> {
  const normalizedFolderPath = normalizeDirectoryPath(folderPath)
  const folderStats = await fs.stat(normalizedFolderPath)
  if (!folderStats.isDirectory()) {
    throw new Error('Expected a folder: ' + normalizedFolderPath)
  }

  const normalizedName = validateNewFolderName(folderName)
  const renamedPath = path.join(path.dirname(normalizedFolderPath), normalizedName)
  if (renamedPath === normalizedFolderPath) {
    return {
      name: normalizedName,
      path: normalizedFolderPath,
    }
  }
  if (await pathExists(renamedPath)) {
    throw new Error('Folder already exists: ' + renamedPath)
  }

  await fs.rename(normalizedFolderPath, renamedPath)
  return {
    name: normalizedName,
    path: renamedPath,
  }
}

export async function deleteFolderPickerDirectory(folderPath: string): Promise<void> {
  const normalizedFolderPath = normalizeDirectoryPath(folderPath)
  const folderStats = await fs.stat(normalizedFolderPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (!folderStats) {
    return
  }
  if (!folderStats.isDirectory()) {
    throw new Error('Expected a folder: ' + normalizedFolderPath)
  }

  try {
    const { shell } = await import('electron')
    await shell.trashItem(normalizedFolderPath)
  } catch {
    await fs.rm(normalizedFolderPath, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    })
  }
}

export async function writeFolderPickerClipboard(
  folderPath: string,
  mode: FolderPickerClipboardMode,
): Promise<void> {
  const normalizedFolderPath = normalizeDirectoryPath(folderPath)
  const folderStats = await fs.stat(normalizedFolderPath)
  if (!folderStats.isDirectory()) {
    throw new Error('Expected a folder: ' + normalizedFolderPath)
  }

  const marker = JSON.stringify({
    kind: FOLDER_PICKER_CLIPBOARD_MARKER_KIND,
    mode,
    paths: [normalizedFolderPath],
  })
  if (process.platform === 'win32') {
    const { clipboard } = await import('electron')
    writeWindowsFileClipboard(clipboard, [normalizedFolderPath], mode, marker)
    return
  }

  const { clipboard } = await import('electron')
  clipboard.clear()
  clipboard.writeBuffer(
    'text/uri-list',
    Buffer.from(pathToFileURL(normalizedFolderPath).href, 'utf8'),
  )
  clipboard.writeText(normalizedFolderPath)
  clipboard.writeBuffer(TIDECODE_WORKSPACE_CLIPBOARD_FORMAT, Buffer.from(marker, 'utf8'))
}

export async function pasteFolderPickerClipboard(
  targetDirectoryPath: string,
): Promise<FolderPickerEntry[]> {
  const normalizedTargetPath = normalizeDirectoryPath(targetDirectoryPath)
  const targetStats = await fs.stat(normalizedTargetPath)
  if (!targetStats.isDirectory()) {
    throw new Error('Expected a folder: ' + normalizedTargetPath)
  }

  const [clipboardPaths, mode] = await Promise.all([
    readNativeClipboardPaths(),
    readClipboardMode(),
  ])
  const sourceDirectoryPaths: string[] = []
  for (const clipboardPath of clipboardPaths) {
    const normalizedSourcePath = path.resolve(clipboardPath)
    const sourceStats = await fs.stat(normalizedSourcePath).catch(() => null)
    if (sourceStats?.isDirectory()) {
      sourceDirectoryPaths.push(normalizedSourcePath)
    }
  }
  if (sourceDirectoryPaths.length === 0) {
    throw new Error('The clipboard does not contain any folders.')
  }

  const results: FolderPickerEntry[] = []
  for (const sourceDirectoryPath of sourceDirectoryPaths) {
    const sourceParentPath = path.dirname(sourceDirectoryPath)
    if (mode === 'cut' && arePathsEqual(sourceParentPath, normalizedTargetPath)) {
      results.push({
        name: path.basename(sourceDirectoryPath),
        path: sourceDirectoryPath,
      })
      continue
    }
    if (isSameOrNestedPath(sourceDirectoryPath, normalizedTargetPath)) {
      throw new Error('Cannot paste a folder inside itself.')
    }

    const destinationPath = await resolveFolderPasteDestination(
      normalizedTargetPath,
      sourceDirectoryPath,
    )
    if (mode === 'copy') {
      await fs.cp(sourceDirectoryPath, destinationPath, {
        errorOnExist: true,
        force: false,
        recursive: true,
      })
    } else {
      try {
        await fs.rename(sourceDirectoryPath, destinationPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
          throw error
        }
        await fs.cp(sourceDirectoryPath, destinationPath, {
          errorOnExist: true,
          force: false,
          recursive: true,
        })
        await fs.rm(sourceDirectoryPath, {
          force: true,
          recursive: true,
        })
      }
    }

    results.push({
      name: path.basename(destinationPath),
      path: destinationPath,
    })
  }

  if (mode === 'cut') {
    const { clipboard } = await import('electron')
    clipboard.clear()
  }
  return results
}
