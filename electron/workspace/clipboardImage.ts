import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  WorkspaceExplorerPasteClipboardImageInput,
  WorkspaceExplorerPasteClipboardImageResult,
} from '../../src/types/chat'
import { notifyWorkspaceExplorerChange } from './explorerNotifications'
import {
  assertWorkspaceDirectory,
  DEFAULT_WORKSPACE_RELATIVE_PATH,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from './paths'

const MAX_CLIPBOARD_IMAGE_BYTES = 64 * 1024 * 1024
const MAX_FILENAME_ATTEMPTS = 10_000

function getClipboardImageFileName(attempt: number) {
  return attempt === 1 ? 'pasted-image.png' : `pasted-image-${attempt}.png`
}

function joinWorkspaceRelativePath(directoryPath: string, fileName: string) {
  return directoryPath === DEFAULT_WORKSPACE_RELATIVE_PATH
    ? fileName
    : `${directoryPath.replace(/\\/gu, '/').replace(/\/+$/gu, '')}/${fileName}`
}

async function assertTargetDirectory(absolutePath: string, relativePath: string) {
  const stats = await fs.stat(absolutePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory does not exist: ${relativePath}`)
    }
    throw error
  })

  if (!stats.isDirectory()) {
    throw new Error(`Expected a directory: ${relativePath}`)
  }
}

export async function writeClipboardImageToWorkspace(
  input: WorkspaceExplorerPasteClipboardImageInput,
  pngData: Buffer,
): Promise<WorkspaceExplorerPasteClipboardImageResult> {
  if (pngData.length === 0) {
    throw new Error('The clipboard image is empty.')
  }
  if (pngData.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error('The clipboard image is too large to paste.')
  }

  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const directoryTarget = getSafeWorkspaceTargetPath(workspaceRootPath, input.targetDirectoryRelativePath)
  await assertTargetDirectory(directoryTarget.absolutePath, directoryTarget.relativePath)

  for (let attempt = 1; attempt <= MAX_FILENAME_ATTEMPTS; attempt += 1) {
    const fileName = getClipboardImageFileName(attempt)
    const relativePath = joinWorkspaceRelativePath(directoryTarget.relativePath, fileName)
    const target = getSafeWorkspaceTargetPath(workspaceRootPath, relativePath)

    try {
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true })
      await fs.writeFile(target.absolutePath, pngData, { flag: 'wx' })
      notifyWorkspaceExplorerChange(workspaceRootPath)
      return {
        relativePath: target.relativePath,
        sizeBytes: pngData.length,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue
      }
      throw error
    }
  }

  throw new Error('Could not find an available filename for the clipboard image.')
}
