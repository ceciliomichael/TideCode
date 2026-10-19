import type { ChatAttachment } from '../types/chat'
import { findChatImageReferenceMatches } from './chatImageReferences'
import { expandChatMentions } from './chatMentions'
import { getStagedChatImagePath } from './chatStagedImageMentions'

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
      const persistedPaths = new Map<string, string>()
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
        persistedPaths.set(getStagedChatImagePath(image), stored.path)
        references.push(`[[tools.read:${stored.path}]]`)
      }

      // The composer presents unsaved images as ordinary @attachment mentions.
      // The temporary alias is UI-only and must never enter saved history.
      const mentionPathMap = { ...message.mentionPathMap }
      for (const [label, path] of Object.entries(mentionPathMap)) {
        const persistedPath = persistedPaths.get(path)
        if (persistedPath) mentionPathMap[label] = persistedPath
      }
      let expandedText = message.text
      for (const [stagedPath, persistedPath] of persistedPaths) {
        expandedText = expandedText.split(stagedPath).join(persistedPath)
      }
      expandedText = expandChatMentions(expandedText, new Map(Object.entries(mentionPathMap)))

      // Older drafts may still contain [Image #N] instead of @attachment.
      const matches = findChatImageReferenceMatches(expandedText, references.length)
      const referencedIndices = new Set(matches.map((match) => match.imageIndex))
      let text = ''
      let cursor = 0
      for (const match of matches) {
        text += expandedText.slice(cursor, match.start)
        text += references[match.imageIndex]
        cursor = match.end
      }
      text += expandedText.slice(cursor)
      for (let index = 0; index < references.length; index += 1) {
        const path = references[index].slice('[[tools.read:'.length, -2)
        if (!referencedIndices.has(index) && !text.includes(path)) {
          text += `${text && !/\s$/u.test(text) ? ' ' : ''}${references[index]}`
        }
      }

      for (const stored of storedById.values()) {
        if (stored.kind === 'image' && stored.path) {
          if (!Object.values(mentionPathMap).includes(stored.path)) {
            mentionPathMap[stored.fileName] = stored.path
          }
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
