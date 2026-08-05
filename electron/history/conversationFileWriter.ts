import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_RENAME_ATTEMPTS = 6
const INITIAL_RETRY_DELAY_MS = 20
const MAX_RETRY_DELAY_MS = 250
const RETRYABLE_WINDOWS_FILE_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function getErrorCode(error: unknown) {
  return (error as NodeJS.ErrnoException).code
}

function isRetryableWindowsFileError(error: unknown) {
  return RETRYABLE_WINDOWS_FILE_ERROR_CODES.has(getErrorCode(error) ?? '')
}

function retryDelay(attempt: number) {
  return Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS)
}

async function unlinkIfPresent(filePath: string) {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') {
      throw error
    }
  }
}

async function unlinkWithRetry(filePath: string) {
  for (let attempt = 0; attempt < MAX_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await unlinkIfPresent(filePath)
      return true
    } catch (error) {
      if (!isRetryableWindowsFileError(error) || attempt === MAX_RENAME_ATTEMPTS - 1) {
        throw error
      }

      await sleep(retryDelay(attempt))
    }
  }

  return false
}

async function renameWithRetry(sourcePath: string, destinationPath: string) {
  for (let attempt = 0; attempt < MAX_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(sourcePath, destinationPath)
      return true
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') {
        return false
      }
      if (!isRetryableWindowsFileError(error) || attempt === MAX_RENAME_ATTEMPTS - 1) {
        throw error
      }

      await sleep(retryDelay(attempt))
    }
  }

  return false
}

async function tryMoveNewFileIntoPlace(tempPath: string, targetPath: string) {
  for (let attempt = 0; attempt < MAX_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(tempPath, targetPath)
      return true
    } catch (error) {
      const errorCode = getErrorCode(error)
      if (errorCode === 'EEXIST' || errorCode === 'EPERM') {
        return false
      }
      if (!isRetryableWindowsFileError(error) || attempt === MAX_RENAME_ATTEMPTS - 1) {
        throw error
      }

      await sleep(retryDelay(attempt))
    }
  }

  return false
}

export async function writeConversationFileAtomic(targetPath: string, content: string) {
  const directoryPath = path.dirname(targetPath)
  const tempPath = path.join(directoryPath, `${path.basename(targetPath)}.tmp-${process.pid}-${randomUUID()}`)
  const backupPath = `${targetPath}.bak`

  await fs.writeFile(tempPath, content, 'utf8')

  try {
    if (await tryMoveNewFileIntoPlace(tempPath, targetPath)) {
      return
    }

    await unlinkWithRetry(backupPath)
    const hadExistingTarget = await renameWithRetry(targetPath, backupPath)

    try {
      const installed = await renameWithRetry(tempPath, targetPath)
      if (!installed) {
        throw new Error(`Unable to install conversation file: ${targetPath}`)
      }
    } catch (error) {
      if (hadExistingTarget) {
        try {
          await renameWithRetry(backupPath, targetPath)
        } catch (restoreError) {
          console.error(`Failed to restore conversation file after a write error: ${targetPath}`, restoreError)
        }
      }

      throw error
    }

    try {
      await unlinkWithRetry(backupPath)
    } catch (error) {
      // The new primary file is already installed. A locked backup is safe to
      // leave behind and remains available as a recovery copy for the reader.
      console.warn(`Unable to remove the previous conversation backup: ${backupPath}`, error)
    }
  } finally {
    await unlinkIfPresent(tempPath).catch((error) => {
      console.warn(`Unable to remove temporary conversation file: ${tempPath}`, error)
    })
  }
}
