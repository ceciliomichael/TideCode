import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { Check, GripVertical, Paperclip, Undo2 } from 'lucide-react'
import { readChatAttachmentsFromFiles } from '../../lib/chatAttachmentFiles'
import { isSupportedImageMimeType } from '../../lib/chatAttachments'
import { chatInputSurfaceClassName } from '../../lib/chatStyles'
import { createClientId } from '../../lib/clientId'
import type { ChatAttachment, QueuedMessage } from '../../types/chat'
import { ChatMentionText } from './ChatMentionText'
import { ChatMentionTextarea } from './ChatMentionTextarea'
import { Tooltip } from '../Tooltip'
import {
  ensureChatImageReferences,
  findChatImageReferenceForDeletion,
  getChatImageAttachments,
  removeChatImageReference,
} from '../../lib/chatImageReferences'
import {
  collapseChatMentionMarkup,
  expandChatMentions,
  findChatMentionMatches,
  insertChatMentionAtPosition,
  restoreChatMentionPathMap,
} from '../../lib/chatMentions'
import { useChatMentionNavigation } from '../../hooks/useChatMentionNavigation'

interface ChatQueueItemProps {
  conversationId?: string | null
  index: number
  message: QueuedMessage
  editCancelBoundaryRef?: RefObject<HTMLElement | null>
  onDragEnd: () => void
  onDragStart: (id: string) => void
  onDrop: (id: string) => void
  onRemove: (id: string) => void
  onUpdate: (
    id: string,
    content: string,
    attachments?: ChatAttachment[],
    mentionPathMap?: ReadonlyMap<string, string>,
  ) => void
}

export function ChatQueueItem({
  conversationId = null,
  index,
  message,
  editCancelBoundaryRef,
  onDragEnd,
  onDragStart,
  onDrop,
  onRemove,
  onUpdate,
}: ChatQueueItemProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const initialMentionPathMap = restoreChatMentionPathMap(message.mentionPathMap)
  const [draftMentionPathMap, setDraftMentionPathMap] = useState(initialMentionPathMap)
  const [draftContent, setDraftContent] = useState(
    () => collapseChatMentionMarkup(message.content, initialMentionPathMap),
  )
  const draftContentRef = useRef(draftContent)
  draftContentRef.current = draftContent
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>(message.attachments ?? [])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const mentionNavigation = useChatMentionNavigation({
    mentionPathMap: draftMentionPathMap,
    onValueChange: setDraftContent,
    textareaRef,
    value: draftContent,
  })

  useEffect(() => {
    const nextMentionPathMap = restoreChatMentionPathMap(message.mentionPathMap)
    setDraftMentionPathMap(nextMentionPathMap)
    setDraftContent(collapseChatMentionMarkup(message.content, nextMentionPathMap))
    setDraftAttachments(message.attachments ?? [])
    setAttachmentError(null)
  }, [message.attachments, message.content, message.mentionPathMap])

  useEffect(() => {
    if (!isEditing) {
      return
    }

    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    const nextSelectionStart = textarea.value.length
    const frameId = window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextSelectionStart, nextSelectionStart)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isEditing])

  function handleActivate() {
    setIsEditing(true)
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.stopPropagation()
    setIsDragging(true)
    onDragStart(message.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', message.id)
  }

  function handleDragEnd() {
    setIsDragging(false)
    setIsDragOver(false)
    onDragEnd()
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }

    setIsDragOver(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    onDrop(message.id)
    setIsDragOver(false)
  }

  const handleCancel = useCallback(() => {
    const nextMentionPathMap = restoreChatMentionPathMap(message.mentionPathMap)
    setDraftMentionPathMap(nextMentionPathMap)
    setDraftContent(collapseChatMentionMarkup(message.content, nextMentionPathMap))
    setDraftAttachments(message.attachments ?? [])
    setAttachmentError(null)
    setIsEditing(false)
  }, [message.attachments, message.content, message.mentionPathMap])

  async function handleAttachmentsChange(files: readonly File[]) {
    if (files.length === 0) {
      return
    }

    const insertionPosition = textareaRef.current?.selectionStart ?? draftContent.length
    const nextAttachments: ChatAttachment[] = []
    const errors: string[] = []

    for (const file of files) {
      let sourcePath = ''
      try {
        sourcePath = window.tidecodeFileDrop?.getPathForFile(file)?.trim() ?? ''
      } catch {
        sourcePath = ''
      }

      try {
        if (sourcePath) {
          const stored = await window.tidecodeHistory.storeChatAttachment({
            conversationId,
            sourcePath,
          })
          if (isSupportedImageMimeType(file.type)) {
            const imageResult = await readChatAttachmentsFromFiles([file], [])
            const imageAttachment = imageResult.attachments.find((attachment) => attachment.kind === 'image')
            if (imageAttachment?.kind === 'image') {
              nextAttachments.push({
                ...imageAttachment,
                fileName: stored.fileName,
                path: stored.path,
              })
              continue
            }
          }
          nextAttachments.push({
            fileName: stored.fileName,
            id: createClientId(),
            kind: stored.kind,
            mimeType: file.type || stored.mimeType,
            path: stored.path,
            sizeBytes: stored.sizeBytes,
          })
          continue
        }

        const fallbackResult = await readChatAttachmentsFromFiles([file], [
          ...draftAttachments,
          ...nextAttachments,
        ])
        for (const attachment of fallbackResult.attachments) {
          if (attachment.kind === 'image') {
            const stored = await window.tidecodeHistory.storeChatImageAttachment({
              conversationId,
              dataUrl: attachment.dataUrl,
              fileName: attachment.fileName,
            })
            nextAttachments.push({
              ...attachment,
              fileName: stored.fileName,
              path: stored.path,
            })
          } else {
            nextAttachments.push(attachment)
          }
        }
        errors.push(...fallbackResult.errors)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Unable to attach ${file.name || 'item'}.`)
      }
    }

    if (nextAttachments.length > 0) {
      const nextMentionMap = new Map(draftMentionPathMap)
      let nextContent = draftContentRef.current
      let nextCursorPosition = insertionPosition
      for (const attachment of nextAttachments) {
        if (!('path' in attachment) || !attachment.path) {
          continue
        }
        let label = attachment.fileName
        let suffix = 2
        while (nextMentionMap.has(label) && nextMentionMap.get(label) !== attachment.path) {
          label = `${attachment.fileName} (${suffix})`
          suffix += 1
        }
        nextMentionMap.set(label, attachment.path)
        const insertion = insertChatMentionAtPosition(nextContent, nextCursorPosition, label)
        nextContent = insertion.nextValue
        nextCursorPosition = insertion.nextCursorPosition
      }
      setDraftMentionPathMap(nextMentionMap)
      setDraftAttachments((currentValue) => [...currentValue, ...nextAttachments])
      setDraftContent(nextContent)
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition)
      })
    }

    setAttachmentError(errors[0] ?? null)
  }

  function handleSave() {
    onUpdate(
      message.id,
      expandChatMentions(draftContent, draftMentionPathMap),
      draftAttachments,
      draftMentionPathMap,
    )
    setIsEditing(false)
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionNavigation.handleKeyDown(event)) {
      return
    }
    if (event.key !== 'Backspace' && event.key !== 'Delete') {
      return
    }
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    const imageReference = findChatImageReferenceForDeletion({
      imageCount: getChatImageAttachments(draftAttachments).filter((attachment) => !attachment.path).length,
      key: event.key,
      selectionEnd: textarea.selectionEnd,
      selectionStart: textarea.selectionStart,
      text: draftContent,
    })
    if (!imageReference) {
      return
    }

    event.preventDefault()
    const nextState = removeChatImageReference({
      attachments: draftAttachments,
      imageNumber: imageReference.imageNumber,
      text: draftContent,
    })
    setDraftAttachments(nextState.attachments)
    setDraftContent(nextState.text)
    window.requestAnimationFrame(() => {
      const cursor = Math.min(imageReference.start, nextState.text.length)
      textareaRef.current?.setSelectionRange(cursor, cursor)
    })
  }

  useEffect(() => {
    if (!isEditing) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const editor = editorRef.current
      const cancelBoundary = editCancelBoundaryRef?.current
      if (
        !editor ||
        !(event.target instanceof Node) ||
        editor.contains(event.target) ||
        !cancelBoundary ||
        !cancelBoundary.contains(event.target)
      ) {
        return
      }

      handleCancel()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [editCancelBoundaryRef, handleCancel, isEditing])

  useEffect(() => {
    const nextContent = ensureChatImageReferences(draftContent, draftAttachments)
    if (nextContent !== draftContent) {
      setDraftContent(nextContent)
    }
  }, [draftAttachments, draftContent])

  useEffect(() => {
    if (!isEditing || draftAttachments.length === 0) {
      return
    }
    const activeMentionPaths = new Set(
      findChatMentionMatches(draftContent, draftMentionPathMap)
        .map((match) => match.path)
        .filter((path): path is string => Boolean(path)),
    )
    const nextAttachments = draftAttachments.filter((attachment) => {
      if (!('path' in attachment) || !attachment.path) {
        return true
      }
      return activeMentionPaths.has(attachment.path)
    })
    if (nextAttachments.length !== draftAttachments.length) {
      setDraftAttachments(nextAttachments)
    }
  }, [draftAttachments, draftContent, draftMentionPathMap, isEditing])

  const draftImageAttachments = getChatImageAttachments(draftAttachments)

  if (isEditing) {
    return (
      <div className="px-2 py-2">
        <div ref={editorRef} className={`${chatInputSurfaceClassName} p-3`}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void handleAttachmentsChange(files)
            }}
            className="hidden"
            tabIndex={-1}
          />

          <ChatMentionTextarea
            imageAttachments={draftImageAttachments}
            mentionPathMap={draftMentionPathMap}
            textareaRef={textareaRef}
            value={draftContent}
            onBeforeInput={mentionNavigation.handleBeforeInput}
            onChange={(event) => setDraftContent(event.target.value)}
            onKeyDown={handleEditorKeyDown}
            onClick={mentionNavigation.handleClick}
            placeholder="Edit queued message"
            rows={1}
            style={{ fieldSizing: 'content' } as CSSProperties}
          />

          {attachmentError ? <p className="mt-2 text-sm text-danger-foreground">{attachmentError}</p> : null}

          <div className="mt-1 flex items-end justify-between gap-3">
            <Tooltip content="Attach files" side="top" noWrap>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group flex h-8 w-8 items-center justify-center bg-transparent text-foreground disabled:cursor-not-allowed disabled:text-disabled-foreground"
                aria-label="Attach files"
              >
                <Paperclip size={14} className="shrink-0 transition-colors duration-150 group-hover:text-foreground" />
              </button>
            </Tooltip>

            <Tooltip content="Save queued message" side="top" noWrap>
              <button
                type="button"
                onClick={handleSave}
                disabled={draftContent.trim().length === 0 && draftAttachments.length === 0}
                aria-label="Save queued message"
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150',
                  draftContent.trim().length > 0 || draftAttachments.length > 0
                    ? 'chat-send-button-enabled cursor-pointer hover:scale-[1.03] active:scale-95'
                    : 'chat-send-button-disabled cursor-not-allowed',
                ].join(' ')}
              >
                <Check size={14} strokeWidth={2.5} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    )
  }

  const messageAttachments = message.attachments ?? []
  const messageImageAttachments = getChatImageAttachments(messageAttachments)
  const renderedMessageContent = ensureChatImageReferences(message.content, messageAttachments)
  const messageMentionPathMap = restoreChatMentionPathMap(message.mentionPathMap)
  const visibleMessageContent = collapseChatMentionMarkup(message.content, messageMentionPathMap)

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleActivate()
        }
      }}
      className={[
        'group flex min-h-9 cursor-grab items-center justify-between gap-2 px-2 text-left transition-[background-color,color,box-shadow] active:cursor-grabbing',
        isDragging ? 'opacity-50' : '',
        isDragOver ? 'bg-surface-muted ring-1 ring-inset ring-action/40' : 'hover:bg-surface-muted/70',
      ].join(' ')}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <GripVertical size={13} className="shrink-0 text-muted-foreground/70" aria-hidden="true" />
        <span className="shrink-0 text-sm font-medium leading-5 text-muted-foreground">{`${index + 1}.`}</span>
        <Tooltip content={visibleMessageContent} side="top" triggerClassName="min-w-0 flex-1">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ChatMentionText
              imageAttachments={messageImageAttachments}
              mentionPathMap={messageMentionPathMap}
              text={renderedMessageContent}
              variant="rendered"
              wrap="nowrap"
              className="min-w-0 truncate text-sm leading-5 text-foreground"
            />
          </div>
        </Tooltip>
      </div>

      {!isDragging ? (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip content="Remove queued message" side="top" noWrap>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(message.id)
              }}
              className="inline-flex h-8 w-8 items-center justify-center bg-transparent text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Remove queued message"
            >
              <Undo2 size={14} />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </div>
  )
}
