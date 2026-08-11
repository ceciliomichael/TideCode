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
import { CHAT_ATTACHMENT_INPUT_ACCEPT, readChatAttachmentsFromFiles } from '../../lib/chatAttachmentFiles'
import { chatInputSurfaceClassName } from '../../lib/chatStyles'
import { AttachmentPillList } from './AttachmentPillList'
import type { ChatAttachment, QueuedMessage } from '../../types/chat'
import { ChatMentionText } from './ChatMentionText'
import { ChatMentionTextarea } from './ChatMentionTextarea'
import { Tooltip } from '../Tooltip'
import {
  ensureChatImageReferences,
  findChatImageReferenceForDeletion,
  getChatImageAttachments,
  insertChatImageReferences,
  removeChatImageReference,
} from '../../lib/chatImageReferences'

interface ChatQueueItemProps {
  index: number
  message: QueuedMessage
  editCancelBoundaryRef?: RefObject<HTMLElement>
  onDragEnd: () => void
  onDragStart: (id: string) => void
  onDrop: (id: string) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, content: string, attachments?: ChatAttachment[]) => void
}

export function ChatQueueItem({
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
  const [draftContent, setDraftContent] = useState(message.content)
  const draftContentRef = useRef(draftContent)
  draftContentRef.current = draftContent
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>(message.attachments ?? [])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  useEffect(() => {
    setDraftContent(message.content)
    setDraftAttachments(message.attachments ?? [])
    setAttachmentError(null)
  }, [message.attachments, message.content])

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
    setDraftContent(message.content)
    setDraftAttachments(message.attachments ?? [])
    setAttachmentError(null)
    setIsEditing(false)
  }, [message.attachments, message.content])

  async function handleAttachmentsChange(files: readonly File[]) {
    if (files.length === 0) {
      return
    }

    const initialInsertionPosition = textareaRef.current?.selectionStart ?? draftContent.length
    const existingImageCount = getChatImageAttachments(draftAttachments).length
    const result = await readChatAttachmentsFromFiles(files, draftAttachments)
    if (result.attachments.length > 0) {
      const newImageCount = getChatImageAttachments(result.attachments).length
      const latestContent = draftContentRef.current
      const insertionPosition = textareaRef.current?.selectionStart ?? initialInsertionPosition
      const insertion = insertChatImageReferences({
        count: newImageCount,
        firstImageNumber: existingImageCount + 1,
        position: insertionPosition,
        text: latestContent,
      })
      setDraftAttachments((currentValue) => [...currentValue, ...result.attachments])
      setDraftContent(insertion.text)
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(insertion.cursorPosition, insertion.cursorPosition)
      })
    }

    setAttachmentError(result.errors[0] ?? null)
  }

  function handleSave() {
    onUpdate(message.id, draftContent, draftAttachments)
    setIsEditing(false)
  }

  function handleRemoveAttachment(attachmentId: string) {
    setDraftAttachments((currentValue) => currentValue.filter((attachment) => attachment.id !== attachmentId))
    setAttachmentError(null)
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Backspace' && event.key !== 'Delete') {
      return
    }
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    const imageReference = findChatImageReferenceForDeletion({
      imageCount: getChatImageAttachments(draftAttachments).length,
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

  const draftImageAttachments = getChatImageAttachments(draftAttachments)
  const draftNonImageAttachments = draftAttachments.filter((attachment) => attachment.kind !== 'image')

  if (isEditing) {
    return (
      <div className="px-2 py-2">
        <div ref={editorRef} className={`${chatInputSurfaceClassName} p-3`}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={CHAT_ATTACHMENT_INPUT_ACCEPT}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void handleAttachmentsChange(files)
            }}
            className="hidden"
            tabIndex={-1}
          />

          {draftNonImageAttachments.length > 0 ? (
            <div className="mb-3">
              <AttachmentPillList attachments={draftNonImageAttachments} onRemoveAttachment={handleRemoveAttachment} />
            </div>
          ) : null}

          <ChatMentionTextarea
            imageAttachments={draftImageAttachments}
            textareaRef={textareaRef}
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            onKeyDown={handleEditorKeyDown}
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
  const attachmentCount = messageAttachments.length - messageImageAttachments.length
  const renderedMessageContent = ensureChatImageReferences(message.content, messageAttachments)

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
        <Tooltip content={message.content} side="top" triggerClassName="min-w-0 flex-1">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ChatMentionText
              imageAttachments={messageImageAttachments}
              text={renderedMessageContent}
              variant="rendered"
              wrap="nowrap"
              className="min-w-0 truncate text-sm leading-5 text-foreground"
            />
            {attachmentCount > 0 ? (
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`}
              </span>
            ) : null}
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
