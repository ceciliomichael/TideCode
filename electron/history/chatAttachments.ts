import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  StoreChatAttachmentInput,
  StoreChatImageAttachmentInput,
  StoredChatAttachment,
} from '../../src/types/chat'
import {
  ensureAttachmentsDirectory,
  getConversationAttachmentsPath,
  getDraftAttachmentsPath,
} from './paths'
import {
  isGitignored,
  loadGitignoreMatchers,
  shouldIgnoreWorkspaceEntry,
} from '../workspace/gitignoreMatcher'

const ATTACHMENTS_ALIAS = '@attachments'

function getAttachmentRoot(conversationId?: string | null) {
  const normalizedConversationId = conversationId?.trim() ?? ''
  return normalizedConversationId.length > 0
    ? getConversationAttachmentsPath(normalizedConversationId)
    : getDraftAttachmentsPath()
}

function sanitizeAttachmentName(fileName: string) {
  const normalized = path.basename(fileName.trim()).replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
  return normalized.length > 0 ? normalized : 'attachment'
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveUniqueTargetPath(rootPath: string, requestedName: string, isDirectory: boolean) {
  const safeName = sanitizeAttachmentName(requestedName)
  const extension = isDirectory ? '' : path.extname(safeName)
  const stem = extension.length > 0 ? safeName.slice(0, -extension.length) : safeName
  let candidateName = safeName
  let suffix = 2
  while (await pathExists(path.join(rootPath, candidateName))) {
    candidateName = `${stem} (${suffix})${extension}`
    suffix += 1
  }
  return {
    absolutePath: path.join(rootPath, candidateName),
    aliasPath: `${ATTACHMENTS_ALIAS}/${candidateName.replace(/\\/gu, '/')}${isDirectory ? '/' : ''}`,
    fileName: candidateName,
  }
}

async function assertNotSymbolicLink(targetPath: string): Promise<void> {
  const stats = await fs.lstat(targetPath)
  if (stats.isSymbolicLink()) {
    throw new Error(`Symbolic links cannot be attached: ${targetPath}`)
  }
}

async function copyAttachmentDirectory(sourcePath: string, targetPath: string) {
  const normalizedSourceRoot = path.resolve(sourcePath)
  await fs.cp(normalizedSourceRoot, targetPath, {
    errorOnExist: true,
    recursive: true,
    filter: async (candidatePath) => {
      const normalizedCandidatePath = path.resolve(candidatePath)
      if (normalizedCandidatePath === normalizedSourceRoot) {
        return true
      }

      const stats = await fs.lstat(normalizedCandidatePath)
      if (stats.isSymbolicLink()) {
        throw new Error(`Symbolic links cannot be attached: ${normalizedCandidatePath}`)
      }

      const entryName = path.basename(normalizedCandidatePath)
      if (shouldIgnoreWorkspaceEntry(entryName)) {
        return false
      }

      const isDirectory = stats.isDirectory()
      const matchers = await loadGitignoreMatchers(
        normalizedSourceRoot,
        path.dirname(normalizedCandidatePath),
      )
      return !isGitignored(normalizedCandidatePath, isDirectory, matchers)
    },
  })
}

function dataUrlToBuffer(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/u.exec(dataUrl)
  if (!match) {
    throw new Error('Invalid image data URL.')
  }
  return {
    buffer: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8'),
    mimeType: match[1]?.trim() || 'application/octet-stream',
  }
}

export async function storeChatAttachment(input: StoreChatAttachmentInput): Promise<StoredChatAttachment> {
  const sourcePath = path.resolve(input.sourcePath.trim())
  await assertNotSymbolicLink(sourcePath)
  const stats = await fs.stat(sourcePath)
  const isDirectory = stats.isDirectory()
  if (!isDirectory && !stats.isFile()) {
    throw new Error(`Unsupported attachment path: ${sourcePath}`)
  }

  await ensureAttachmentsDirectory()
  const rootPath = getAttachmentRoot(input.conversationId)
  await fs.mkdir(rootPath, { recursive: true })
  const target = await resolveUniqueTargetPath(rootPath, path.basename(sourcePath), isDirectory)
  if (isDirectory) {
    await copyAttachmentDirectory(sourcePath, target.absolutePath)
  } else {
    await fs.cp(sourcePath, target.absolutePath, {
      errorOnExist: true,
      recursive: false,
    })
  }

  return {
    fileName: target.fileName,
    kind: isDirectory ? 'folder' : 'file',
    mimeType: isDirectory ? 'inode/directory' : 'application/octet-stream',
    path: target.aliasPath,
    sizeBytes: isDirectory ? 0 : stats.size,
  }
}

export async function storeChatImageAttachment(input: StoreChatImageAttachmentInput): Promise<StoredChatAttachment> {
  const { buffer, mimeType } = dataUrlToBuffer(input.dataUrl)
  await ensureAttachmentsDirectory()
  const rootPath = getAttachmentRoot(input.conversationId)
  await fs.mkdir(rootPath, { recursive: true })
  const target = await resolveUniqueTargetPath(rootPath, input.fileName, false)
  await fs.writeFile(target.absolutePath, buffer, { flag: 'wx' })
  return {
    fileName: target.fileName,
    kind: 'file',
    mimeType,
    path: target.aliasPath,
    sizeBytes: buffer.byteLength,
  }
}

export async function adoptDraftChatAttachments(targetConversationId: string, draftScopeId: string) {
  const draftPath = getDraftAttachmentsPath(draftScopeId)
  const targetPath = getConversationAttachmentsPath(targetConversationId)
  await ensureAttachmentsDirectory()
  await fs.mkdir(targetPath, { recursive: true })
  let entries: string[]
  try {
    entries = await fs.readdir(draftPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return targetPath
    }
    throw error
  }
  for (const entry of entries) {
    await fs.rename(path.join(draftPath, entry), path.join(targetPath, entry))
  }
  await fs.rm(draftPath, { force: true, recursive: true })
  return targetPath
}

export async function cloneConversationChatAttachments(
  sourceConversationId: string,
  targetConversationId: string,
) {
  const sourcePath = getConversationAttachmentsPath(sourceConversationId)
  const targetPath = getConversationAttachmentsPath(targetConversationId)
  try {
    await fs.access(sourcePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return targetPath
    }
    throw error
  }
  await ensureAttachmentsDirectory()
  await fs.mkdir(targetPath, { recursive: true })
  const entries = await fs.readdir(sourcePath)
  for (const entry of entries) {
    await fs.cp(path.join(sourcePath, entry), path.join(targetPath, entry), {
      recursive: true,
    })
  }
  return targetPath
}

export async function cleanupDraftChatAttachments() {
  await fs.rm(getDraftAttachmentsPath(), { force: true, recursive: true })
}

export async function cleanupChatAttachmentScope(scopeId: string) {
  const normalizedScopeId = scopeId.trim()
  if (!normalizedScopeId.startsWith('VIRT_draft_')) {
    return
  }

  await fs.rm(getDraftAttachmentsPath(normalizedScopeId), {
    force: true,
    recursive: true,
  })
}

export async function listChatAttachments(conversationId: string): Promise<StoredChatAttachment[]> {
  const rootPath = getAttachmentRoot(conversationId)
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const attachments = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(rootPath, entry.name)
    const stats = await fs.stat(entryPath)
    return {
      fileName: entry.name,
      kind: entry.isDirectory() ? ('folder' as const) : ('file' as const),
      mimeType: entry.isDirectory() ? 'inode/directory' : 'application/octet-stream',
      path: `${ATTACHMENTS_ALIAS}/${entry.name.replace(/\\/gu, '/')}${entry.isDirectory() ? '/' : ''}`,
      sizeBytes: entry.isDirectory() ? 0 : stats.size,
    }
  }))

  return attachments.sort((left, right) =>
    left.fileName.localeCompare(right.fileName, undefined, { sensitivity: 'base' }),
  )
}

export async function deleteConversationChatAttachments(conversationId: string) {
  await fs.rm(getConversationAttachmentsPath(conversationId), { force: true, recursive: true })
}
