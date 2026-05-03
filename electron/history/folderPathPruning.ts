import { promises as fs } from 'node:fs'
import type { ConversationFolderRecord } from '../../src/types/chat'

function getNodeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  return 'code' in error && typeof (error as NodeJS.ErrnoException).code === 'string'
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

async function isResolvableFolderPath(folderPath: string) {
  try {
    const stats = await fs.stat(folderPath)
    return stats.isDirectory()
  } catch (error) {
    const errorCode = getNodeErrorCode(error)
    if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') {
      return false
    }

    if (errorCode === 'EACCES' || errorCode === 'EPERM') {
      return true
    }

    throw error
  }
}

export async function filterResolvableFolderRecords(
  folders: ConversationFolderRecord[],
  isFolderResolvable: (folderPath: string) => Promise<boolean> = isResolvableFolderPath,
) {
  const folderStates = await Promise.all(
    folders.map(async (folder) => ({
      folder,
      isResolvable: await isFolderResolvable(folder.path),
    })),
  )

  return folderStates.filter(({ isResolvable }) => isResolvable).map(({ folder }) => folder)
}
