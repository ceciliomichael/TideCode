import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { deleteChatComposerDraft, loadChatComposerDraft, saveChatComposerDraft, type SavedChatComposerDraft } from '../lib/chatComposerDraftStorage'
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
  if (attachment.kind === 'image') {
    return [
        attachment.id,
        attachment.kind,
        attachment.fileName,
        attachment.mimeType,
        attachment.sizeBytes,
        attachment.dataUrl,
        attachment.path ?? '',
      ].join('::')
  }
  if (attachment.kind === 'text') {
    return [
        attachment.id,
        attachment.kind,
        attachment.fileName,
        attachment.mimeType,
        attachment.sizeBytes,
        attachment.textContent,
      ].join('::')
  }
  return [
    attachment.id,
    attachment.kind,
    attachment.fileName,
    attachment.mimeType,
    attachment.sizeBytes,
    attachment.path,
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

export function useChatComposerState(messages: Message[], activeConversationId: string | null) {
  const [mainComposerValue, setMainComposerValueState] = useState('')
  const [mainComposerAttachments, setMainComposerAttachmentsState] = useState<ChatAttachment[]>([])
  const [mainComposerMentionPathMap, setMainComposerMentionPathMapState] = useState<Map<string, string>>(
    () => new Map(),
  )
  const mainComposerRevisionRef = useRef(0)
  const composerScopeRef = useRef<string | null>(activeConversationId)
  const composerDraftRef = useRef<SavedChatComposerDraft>({ value: '', attachments: [], mentionPaths: [] })
  const discardComposerDraft = useCallback((conversationId: string) => {
    if (composerScopeRef.current === conversationId) {
      composerDraftRef.current = { value: '', attachments: [], mentionPaths: [] }
    }
    deleteChatComposerDraft(conversationId)
  }, [])
  const getMainComposerRevision = useCallback(() => mainComposerRevisionRef.current, [])
  const setMainComposerValue: Dispatch<SetStateAction<string>> = useCallback((value) => {
    mainComposerRevisionRef.current += 1
    setMainComposerValueState(value)
  }, [])
  const setMainComposerAttachments: Dispatch<SetStateAction<ChatAttachment[]>> = useCallback((value) => {
    mainComposerRevisionRef.current += 1
    setMainComposerAttachmentsState(value)
  }, [])
  const setMainComposerMentionPathMap: Dispatch<SetStateAction<Map<string, string>>> = useCallback((value) => {
    mainComposerRevisionRef.current += 1
    setMainComposerMentionPathMapState(value)
  }, [])
  const [editComposerValue, setEditComposerValue] = useState('')
  const [editComposerAttachments, setEditComposerAttachments] = useState<ChatAttachment[]>([])
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editComposerFocusSignal, setEditComposerFocusSignal] = useState(0)
  const [editInitialValue, setEditInitialValue] = useState('')
  const [editInitialAttachments, setEditInitialAttachments] = useState<ChatAttachment[]>([])
  const [editComposerMentionPathMap, setEditComposerMentionPathMap] = useState<Map<string, string>>(() => new Map())
  const messagesRef = useRef(messages)

  useLayoutEffect(() => {
    if (composerScopeRef.current !== activeConversationId) {
      if (composerScopeRef.current) {
        saveChatComposerDraft(composerScopeRef.current, composerDraftRef.current)
      }
      composerScopeRef.current = activeConversationId
      const saved = activeConversationId ? loadChatComposerDraft(activeConversationId) : null
      const nextDraft = saved ?? { value: '', attachments: [], mentionPaths: [] }
      composerDraftRef.current = nextDraft
      mainComposerRevisionRef.current += 1
      setMainComposerValueState(nextDraft.value)
      setMainComposerAttachmentsState(nextDraft.attachments)
      setMainComposerMentionPathMapState(new Map(nextDraft.mentionPaths))
      return
    }

    const nextDraft = {
      value: mainComposerValue,
      attachments: mainComposerAttachments,
      mentionPaths: [...mainComposerMentionPathMap.entries()] as [string, string][],
    }
    composerDraftRef.current = nextDraft
    if (activeConversationId) {
      saveChatComposerDraft(activeConversationId, nextDraft)
    }
  }, [activeConversationId, mainComposerAttachments, mainComposerMentionPathMap, mainComposerValue])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (mainComposerValue.trim().length > 0 || mainComposerMentionPathMap.size === 0) {
      return
    }

    setMainComposerMentionPathMap(new Map())
  }, [mainComposerMentionPathMap.size, mainComposerValue, setMainComposerMentionPathMap])

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
  }, [setMainComposerAttachments, setMainComposerMentionPathMap, setMainComposerValue])

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
    discardComposerDraft,
    getMainComposerRevision,
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
