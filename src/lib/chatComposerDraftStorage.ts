import type { ChatAttachment } from '../types/chat'

export interface SavedChatComposerDraft {
  value: string
  attachments: ChatAttachment[]
  mentionPaths: [string, string][]
}

const KEY_PREFIX = 'tidecode:chat-composer-draft:'

export function loadChatComposerDraft(conversationId: string): SavedChatComposerDraft | null {
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${conversationId}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const draft = parsed as Partial<SavedChatComposerDraft>
    if (typeof draft.value !== 'string' || !Array.isArray(draft.attachments) || !Array.isArray(draft.mentionPaths)) {
      return null
    }
    return {
      value: draft.value,
      attachments: draft.attachments,
      mentionPaths: draft.mentionPaths,
    }
  } catch {
    return null
  }
}

export function saveChatComposerDraft(conversationId: string, draft: SavedChatComposerDraft) {
  try {
    if (!draft.value && draft.attachments.length === 0) {
      window.localStorage.removeItem(`${KEY_PREFIX}${conversationId}`)
    } else {
      window.localStorage.setItem(`${KEY_PREFIX}${conversationId}`, JSON.stringify(draft))
    }
  } catch (error) {
    console.warn('Unable to save an unsent chat draft.', error)
  }
}

export function deleteChatComposerDraft(conversationId: string) {
  try {
    window.localStorage.removeItem(`${KEY_PREFIX}${conversationId}`)
  } catch (error) {
    console.warn('Unable to remove an unsent chat draft.', error)
  }
}
