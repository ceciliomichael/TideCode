import type { ChatAttachment } from '../types/chat'
import { findChatImageReferenceMatches } from './chatImageReferences'

interface StagedImageSubmission {
  attachments: ChatAttachment[]
  mentionPathMap?: Record<string, string>
  text: string
}

interface StoredImageBatch {
  messages: StagedImageSubmission[]
  storedPaths: string[]
}

/**
 * Composer images have no path until a message is submitted. Store them only
 * after the target conversation is known, then replace composer-only image
 * labels with durable attachment references.
 */
export async function persistStagedChatImages(
  conversationId: string,
  messages: readonly StagedImageSubmission[],
): Promise<StoredImageBatch> {
  const storedPaths: string[] = []
  try {
    const preparedMessages: StagedImageSubmission[] = []
    for (const message of messages) {
      const stagedImages = message.attachments.filter(
        (attachment) => attachment.kind === 'image' && !attachment.path,
      )
      if (stagedImages.length === 0) {
        preparedMessages.push(message)
        continue
      }

      const storedById = new Map<string, ChatAttachment>()
      const references: string[] = []
      for (const image of stagedImages) {
        if (image.kind !== 'image') {
          continue
        }
        const stored = await window.tidecodeHistory.storeChatImageAttachment({
          conversationId,
          dataUrl: image.dataUrl,
          fileName: image.fileName,
        })
        storedPaths.push(stored.path)
        storedById.set(image.id, {
          ...image,
          fileName: stored.fileName,
          path: stored.path,
        })
        references.push(`[[tools.read:${stored.path}]]`)
      }

      const matches = findChatImageReferenceMatches(message.text, references.length)
      const referencedIndices = new Set(matches.map((match) => match.imageIndex))
      let text = ''
      let cursor = 0
      for (const match of matches) {
        text += message.text.slice(cursor, match.start)
        text += references[match.imageIndex]
        cursor = match.end
      }
      text += message.text.slice(cursor)
      for (let index = 0; index < references.length; index += 1) {
        if (!referencedIndices.has(index)) {
          text += `${text && !/\s$/u.test(text) ? ' ' : ''}${references[index]}`
        }
      }

      const mentionPathMap = { ...message.mentionPathMap }
      for (const stored of storedById.values()) {
        if (stored.kind === 'image' && stored.path) {
          mentionPathMap[stored.fileName] = stored.path
        }
      }
      preparedMessages.push({
        attachments: message.attachments.map((attachment) => storedById.get(attachment.id) ?? attachment),
        mentionPathMap,
        text,
      })
    }
    return { messages: preparedMessages, storedPaths }
  } catch (error) {
    await cleanupUnreferencedChatImages(conversationId, storedPaths)
    throw error
  }
}

export async function cleanupUnreferencedChatImages(conversationId: string, storedPaths: readonly string[]) {
  if (storedPaths.length === 0) {
    return
  }
  try {
    await window.tidecodeHistory.cleanupUnreferencedChatAttachments(conversationId, [...storedPaths])
  } catch (error) {
    console.error('Failed to clean up unsaved chat image attachments.', error)
  }
}
