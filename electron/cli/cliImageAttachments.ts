import { randomUUID } from 'node:crypto'
import { stat, readFile } from 'node:fs/promises'
import { statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ChatImageAttachment } from '../../src/types/chat'
import {
  CHAT_ATTACHMENT_MAX_IMAGE_BYTES,
  getChatAttachmentExtension,
} from '../../src/lib/chatAttachments'
import { colors } from './renderer'

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.bmp': 'image/bmp',
}

const IMAGE_EXTENSIONS = new Set(Object.keys(MIME_TYPE_BY_EXTENSION))

export function isImageExtension(filePath: string): boolean {
  const extension = getChatAttachmentExtension(filePath)
  return IMAGE_EXTENSIONS.has(extension)
}

export function getImageMimeType(filePath: string): string {
  const extension = getChatAttachmentExtension(filePath)
  return MIME_TYPE_BY_EXTENSION[extension] || 'image/png'
}

export function normalizeFilePath(rawPath: string, workspaceRoot?: string): string {
  let cleaned = rawPath.trim()
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim()
  }
  if (cleaned.startsWith('file://')) {
    cleaned = cleaned.replace(/^file:\/\/\/?/, '')
    if (process.platform === 'win32') {
      cleaned = cleaned.replace(/\//g, '\\')
    }
  }
  if (workspaceRoot && !path.isAbsolute(cleaned)) {
    return path.resolve(workspaceRoot, cleaned)
  }
  return path.resolve(cleaned)
}

export function readCliImageAttachmentSync(
  filePathInput: string,
  workspaceRoot?: string,
): ChatImageAttachment | null {
  const resolvedPath = normalizeFilePath(filePathInput, workspaceRoot)
  if (!isImageExtension(resolvedPath)) {
    return null
  }

  try {
    const fileStats = statSync(resolvedPath)
    if (!fileStats.isFile() || fileStats.size > CHAT_ATTACHMENT_MAX_IMAGE_BYTES) {
      return null
    }

    const buffer = readFileSync(resolvedPath)
    const mimeType = getImageMimeType(resolvedPath)
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    const fileName = path.basename(resolvedPath)

    return {
      id: randomUUID(),
      kind: 'image',
      fileName,
      mimeType,
      sizeBytes: fileStats.size,
      dataUrl,
    }
  } catch {
    return null
  }
}

export async function readCliImageAttachment(
  filePathInput: string,
  workspaceRoot?: string,
): Promise<ChatImageAttachment | null> {
  const resolvedPath = normalizeFilePath(filePathInput, workspaceRoot)
  if (!isImageExtension(resolvedPath)) {
    return null
  }

  try {
    const fileStats = await stat(resolvedPath)
    if (!fileStats.isFile() || fileStats.size > CHAT_ATTACHMENT_MAX_IMAGE_BYTES) {
      return null
    }

    const buffer = await readFile(resolvedPath)
    const mimeType = getImageMimeType(resolvedPath)
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    const fileName = path.basename(resolvedPath)

    return {
      id: randomUUID(),
      kind: 'image',
      fileName,
      mimeType,
      sizeBytes: fileStats.size,
      dataUrl,
    }
  } catch {
    return null
  }
}

export function formatCliImageReference(imageNumber: number): string {
  return `${colors.accent}[${colors.info}Image #${imageNumber}${colors.accent}]${colors.reset}`
}

export function formatCliImageReferenceInText(text: string): string {
  return text.replace(/\[Image #([1-9]\d*)\]/g, (_match, rawNumber) => {
    const num = Number.parseInt(rawNumber, 10)
    return formatCliImageReference(num)
  })
}

export function extractPastedImageFilePaths(text: string, workspaceRoot?: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const lines = trimmed.split(/\r?\n/)
  const extracted: string[] = []
  for (const line of lines) {
    const cleanLine = line.trim().replace(/^["']|["']$/g, '')
    if (cleanLine && isImageExtension(cleanLine)) {
      extracted.push(normalizeFilePath(cleanLine, workspaceRoot))
    }
  }

  return extracted
}
