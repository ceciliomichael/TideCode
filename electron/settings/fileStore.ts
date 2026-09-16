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

export async function recoverInterruptedJsonWrite(filePath: string) {
  const directoryPath = path.dirname(filePath)
  const tempPrefix = `${path.basename(filePath)}.tmp-`

  let entries: string[]
  try {
    entries = (await fs.readdir(directoryPath)).filter((entry) => entry.startsWith(tempPrefix))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }

  if (entries.length === 0) return false

  const candidates = await Promise.all(entries.map(async (entry) => {
    const candidatePath = path.join(directoryPath, entry)
    const stat = await fs.stat(candidatePath)
    return { candidatePath, mtimeMs: stat.mtimeMs }
  }))
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)

  const targetMtimeMs = await fs.stat(filePath).then((stat) => stat.mtimeMs).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return -1
    throw error
  })
  const newest = candidates[0]

  if (newest.mtimeMs <= targetMtimeMs) {
    await Promise.all(candidates.map(({ candidatePath }) => safeUnlink(candidatePath)))
    return false
  }

  let content: string
  try {
    content = await fs.readFile(newest.candidatePath, 'utf8')
    JSON.parse(content)
  } catch {
    await safeUnlink(newest.candidatePath)
    return false
  }

  await writeJsonFileAtomic(filePath, content)
  await Promise.all(candidates.map(({ candidatePath }) => safeUnlink(candidatePath)))
  return true
}
