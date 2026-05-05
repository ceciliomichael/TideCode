import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

async function safeUnlink(filePath: string) {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    throw error
  }
}

async function safeRename(filePath: string, nextPath: string) {
  try {
    await fs.rename(filePath, nextPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }

    throw error
  }

  return true
}

export async function writeJsonFileAtomic(filePath: string, content: string) {
  const directoryPath = path.dirname(filePath)
  const tempPath = path.join(directoryPath, `${path.basename(filePath)}.tmp-${process.pid}-${randomUUID()}`)
  const backupPath = `${filePath}.bak`

  await fs.writeFile(tempPath, content, 'utf8')

  try {
    await fs.rename(tempPath, filePath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') {
      await safeUnlink(tempPath)
      throw error
    }
  }

  await safeUnlink(backupPath)
  const hadExistingTarget = await safeRename(filePath, backupPath)

  try {
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await safeUnlink(tempPath)

    if (hadExistingTarget) {
      try {
        await fs.rename(backupPath, filePath)
      } catch (restoreError) {
        console.error(`Failed to restore file after a write error: ${filePath}`, restoreError)
      }
    }

    throw error
  }

  await safeUnlink(backupPath)
}
