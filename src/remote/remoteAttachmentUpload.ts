import { readChatAttachmentsFromFiles } from '../lib/chatAttachmentFiles'
import { createClientId } from '../lib/clientId'
import type { RemoteAttachmentSelection } from '../lib/remoteAttachmentEntries'
import type { ChatAttachment, StoredChatAttachment } from '../types/chat'

async function readJsonResponse(response: Response) {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const message = body && typeof body.error === 'string' ? body.error : `Attachment upload failed (${response.status}).`
    throw new Error(message)
  }
  return body ?? {}
}

async function startUpload(input: {
  conversationId?: string | null
  fileName: string
  kind: 'file' | 'folder'
  mimeType?: string
}) {
  const response = await fetch('/remote/attachments/start', {
    body: JSON.stringify(input),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  const body = await readJsonResponse(response)
  if (typeof body.uploadId !== 'string') throw new Error('Remote attachment upload did not return an upload ID.')
  return body.uploadId
}

async function uploadBytes(uploadId: string, file: File, relativePath?: string) {
  const suffix = relativePath ? `?path=${encodeURIComponent(relativePath)}` : ''
  const response = await fetch(`/remote/attachments/${encodeURIComponent(uploadId)}${suffix}`, {
    body: file,
    credentials: 'same-origin',
    headers: file.type ? { 'Content-Type': file.type } : undefined,
    method: 'PUT',
  })
  await readJsonResponse(response)
}

async function completeUpload(uploadId: string) {
  const response = await fetch(`/remote/attachments/${encodeURIComponent(uploadId)}/complete`, {
    credentials: 'same-origin',
    method: 'POST',
  })
  const body = await readJsonResponse(response)
  const attachment = body.attachment as StoredChatAttachment | undefined
  if (!attachment?.path || !attachment.fileName) throw new Error('Remote attachment upload did not return attachment metadata.')
  return attachment
}

async function abortUpload(uploadId: string) {
  await fetch(`/remote/attachments/${encodeURIComponent(uploadId)}`, {
    credentials: 'same-origin',
    method: 'DELETE',
  }).catch(() => undefined)
}

async function toChatAttachment(file: File, stored: StoredChatAttachment): Promise<ChatAttachment> {
  if (file.type.trim().toLowerCase().startsWith('image/')) {
    const result = await readChatAttachmentsFromFiles([file], [])
    const image = result.attachments.find((attachment) => attachment.kind === 'image')
    if (image?.kind === 'image') {
      return {
        ...image,
        fileName: stored.fileName,
        path: stored.path,
      }
    }
  }
  return {
    fileName: stored.fileName,
    id: createClientId(),
    kind: 'file',
    mimeType: file.type || stored.mimeType,
    path: stored.path,
    sizeBytes: stored.sizeBytes,
  }
}

export async function uploadRemoteAttachmentSelection(
  selection: RemoteAttachmentSelection,
  conversationId?: string | null,
): Promise<ChatAttachment> {
  const uploadId = await startUpload({
    conversationId,
    fileName: selection.kind === 'file' ? selection.file.name : selection.name,
    kind: selection.kind,
    mimeType: selection.kind === 'file' ? selection.file.type : 'inode/directory',
  })
  try {
    if (selection.kind === 'file') {
      await uploadBytes(uploadId, selection.file)
      return toChatAttachment(selection.file, await completeUpload(uploadId))
    }
    for (const entry of selection.files) {
      await uploadBytes(uploadId, entry.file, entry.relativePath)
    }
    const stored = await completeUpload(uploadId)
    return {
      fileName: stored.fileName,
      id: createClientId(),
      kind: 'folder',
      mimeType: stored.mimeType,
      path: stored.path,
      sizeBytes: stored.sizeBytes,
    }
  } catch (error) {
    await abortUpload(uploadId)
    throw error
  }
}
