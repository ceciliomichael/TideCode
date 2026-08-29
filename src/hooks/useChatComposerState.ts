import { useCallback, useEffect, useRef, useState } from 'react'
import { isHumanUserMessage } from '../lib/chatMessageMetadata'
import {
  buildChatMentionPathMap,
  collapseChatMentionMarkup,
  restoreChatMentionPathMap,
} from '../lib/chatMentions'
import type { ChatAttachment, Message } from '../types/chat'

export interface EditComposerDraftSession {
  attachments: ChatAttachment[]
  mentionPathMap: ReadonlyMap<string, string>
  messageId: string
  value: string
}

function getAttachmentFingerprint(attachment: ChatAttachment) {
  return attachment.kind === 'image'
    ? [
        attachment.id,
        attachment.kind,
        attachment.fileName,
        attachment.mimeType,
        attachment.sizeBytes,
        attachment.dataUrl,
      ].join('::')
    : [
        attachment.id,
        attachment.kind,
        attachment.fileName,
        attachment.mimeType,
        attachment.sizeBytes,
        attachment.textContent,
      ].join('::')
}

function haveSameAttachments(left: readonly ChatAttachment[], right: readonly ChatAttachment[]) {
  return (
    left.length === right.length &&
    left.every((attachment, index) => getAttachmentFingerprint(attachment) === getAttachmentFingerprint(right[index]))
  )
}

function cloneAttachments(attachments: readonly ChatAttachment[]) {
  return attachments.map((attachment) => ({ ...attachment }))
}

export function useChatComposerState(messages: Message[]) {
  const [mainComposerValue, setMainComposerValue] = useState('')
  const [mainComposerAttachments, setMainComposerAttachments] = useState<ChatAttachment[]>([])
  const [mainComposerMentionPathMap, setMainComposerMentionPathMap] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [editComposerValue, setEditComposerValue] = useState('')
  const [editComposerAttachments, setEditComposerAttachments] = useState<ChatAttachment[]>([])
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editComposerFocusSignal, setEditComposerFocusSignal] = useState(0)
  const [editInitialValue, setEditInitialValue] = useState('')
  const [editInitialAttachments, setEditInitialAttachments] = useState<ChatAttachment[]>([])
  const [editComposerMentionPathMap, setEditComposerMentionPathMap] = useState<Map<string, string>>(() => new Map())
  const messagesRef = useRef(messages)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (mainComposerValue.trim().length > 0 || mainComposerMentionPathMap.size === 0) {
      return
    }

    setMainComposerMentionPathMap(new Map())
  }, [mainComposerMentionPathMap.size, mainComposerValue])

  const restoreEditingSession = useCallback((session: EditComposerDraftSession | { messageId: string }) => {
    const targetMessage = messagesRef.current.find(
      (message) => message.id === session.messageId && isHumanUserMessage(message),
    )
    if (!targetMessage) {
      return false
    }

    const initialAttachments = cloneAttachments(targetMessage.attachments ?? [])
    const initialMentionPathMap = targetMessage.mentionPathMap
      ? restoreChatMentionPathMap(targetMessage.mentionPathMap)
      : buildChatMentionPathMap(targetMessage.content)
    const collapsedContent = collapseChatMentionMarkup(targetMessage.content, initialMentionPathMap)

    setEditingMessageId(session.messageId)
    setEditComposerValue('value' in session ? session.value : collapsedContent)
    setEditComposerAttachments(
      'attachments' in session ? cloneAttachments(session.attachments) : initialAttachments,
    )
    setEditInitialValue(collapsedContent)
    setEditInitialAttachments(initialAttachments)
    setEditComposerMentionPathMap(
      'mentionPathMap' in session ? new Map(session.mentionPathMap) : initialMentionPathMap,
    )
    setEditComposerFocusSignal((currentValue) => currentValue + 1)
    return true
  }, [])

  const resetComposerState = useCallback(() => {
    setEditingMessageId(null)
    setMainComposerValue('')
    setMainComposerAttachments([])
    setMainComposerMentionPathMap(new Map())
    setEditComposerValue('')
    setEditComposerAttachments([])
    setEditInitialValue('')
    setEditInitialAttachments([])
    setEditComposerMentionPathMap(new Map())
  }, [])

  const startEditingMessage = useCallback((messageId: string) => {
    restoreEditingSession({ messageId })
  }, [restoreEditingSession])

  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId(null)
    setEditComposerValue('')
    setEditComposerAttachments([])
    setEditInitialValue('')
    setEditInitialAttachments([])
    setEditComposerMentionPathMap(new Map())
  }, [])

  const captureEditingSession = useCallback((): EditComposerDraftSession | null => {
    if (!editingMessageId) {
      return null
    }

    return {
      attachments: cloneAttachments(editComposerAttachments),
      mentionPathMap: new Map(editComposerMentionPathMap),
      messageId: editingMessageId,
      value: editComposerValue,
    }
  }, [editComposerAttachments, editComposerMentionPathMap, editComposerValue, editingMessageId])

  const isEditComposerDirty =
    editComposerValue !== editInitialValue || !haveSameAttachments(editComposerAttachments, editInitialAttachments)

  return {
    mainComposerValue,
    setMainComposerValue,
    mainComposerAttachments,
    setMainComposerAttachments,
    mainComposerMentionPathMap,
    setMainComposerMentionPathMap,
    editComposerValue,
    setEditComposerValue,
    editComposerAttachments,
    setEditComposerAttachments,
    editComposerMentionPathMap,
    isEditComposerDirty,
    editingMessageId,
    editComposerFocusSignal,
    captureEditingSession,
    resetComposerState,
    restoreEditingSession,
    startEditingMessage,
    cancelEditingMessage,
  }
}
