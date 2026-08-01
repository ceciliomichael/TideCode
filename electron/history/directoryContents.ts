import { promises as fs } from 'node:fs'
import path from 'node:path'

const TRANSIENT_REMOVE_MAX_RETRIES = 8
const TRANSIENT_REMOVE_RETRY_DELAY_MS = 50

/**
 * Removes every entry below a directory while preserving the directory itself.
 * Keeping the root in place is important on Windows, where filesystem watchers
 * can hold a directory handle that prevents the root from being removed.
 */
export async function resetDirectoryContents(directoryPath: string) {
  await fs.mkdir(directoryPath, { recursive: true })
  const entryNames = await fs.readdir(directoryPath)

  for (const entryName of entryNames) {
    await fs.rm(path.join(directoryPath, entryName), {
      force: true,
      maxRetries: TRANSIENT_REMOVE_MAX_RETRIES,
      recursive: true,
      retryDelay: TRANSIENT_REMOVE_RETRY_DELAY_MS,
    })
  }
}
