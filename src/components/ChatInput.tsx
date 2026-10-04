import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent, type RefObject } from 'react'
import { ArrowUp, Clock, File, Folder, Paperclip, Square } from 'lucide-react'
import { readChatAttachmentsFromFiles } from '../lib/chatAttachmentFiles'
import { CHAT_ATTACHMENT_MAX_COUNT, isSupportedImageMimeType } from '../lib/chatAttachments'
import { chatConversationSurfacePaddingClassName, chatInputSurfaceClassName } from '../lib/chatStyles'
import { DEFAULT_FOLLOW_UP_BEHAVIOR, type FollowUpBehavior } from '../lib/appSettings'
import { createClientId } from '../lib/clientId'
import { resolveChatFollowUpShortcutAction } from '../lib/chatFollowUpShortcuts'
import { ChatMentionMenu } from './chat/ChatMentionMenu'
import { ChatMentionTextarea } from './chat/ChatMentionTextarea'
import { CodexUsageIndicator } from './chat/CodexUsageIndicator'
import { getNextChatMode, isChatModeToggleShortcut } from './chat/chatModeShortcut'
import { useChatFileMentionMenu } from '../hooks/useChatFileMentionMenu'
import { useChatMentionNavigation } from '../hooks/useChatMentionNavigation'
import { useIsMobileViewport } from '../hooks/useIsMobileViewport'
import type {
  AppTerminalExecutionMode,
  ChatAttachment,
  ChatMode,
  ContextUsageEstimate,
  CodexUsageSnapshot,
  GitBranchState,
  ReasoningEffort,
  WorkspaceRefactorCandidate,
} from '../types/chat'
import { Tooltip } from './Tooltip'
import { ContextIndicator } from './chat/ContextIndicator'
import { RefactorCandidatesIndicator } from './chat/RefactorCandidatesIndicator'
import { ChatModeSelectorField, type ChatModeOption } from './chat/ChatModeSelectorField'
import { GitBranchSelectorField } from './chat/GitBranchSelectorField'
import { ModelSelectorField, type ModelSelectorOption } from './chat/ModelSelectorField'
import { ReasoningEffortBlock } from './chat/ReasoningEffortBlock'
import { RuntimeTargetSelectorField } from './chat/RuntimeTargetSelectorField'
import { TerminalExecutionModeSelectorField } from './chat/TerminalExecutionModeSelectorField'
import {
  ensureChatImageReferences,
  findChatImageReferenceForDeletion,
  getChatImageAttachments,
  removeChatImageReference,
} from '../lib/chatImageReferences'
import { findChatMentionMatches } from '../lib/chatMentions'
import { normalizeWorkspaceRootPathForComparison } from '../lib/workspaceRootPathComparison'

interface ChatInputProps {
  actionButtonMode?: 'auto' | 'abort' | 'send'
  attachments?: ChatAttachment[]
  conversationId?: string | null
  chatModeOptions?: readonly ChatModeOption[]
  chatModeSelectorDisabled?: boolean
  contextUsage?: ContextUsageEstimate
  codexUsage?: CodexUsageSnapshot | null
  isCompressingChat?: boolean
  compactDisabled?: boolean
  disabled?: boolean
  focusSignal?: number
  gitBranchError?: string | null
  gitBranchLoading?: boolean
  gitBranchState?: GitBranchState
  gitBranchSwitching?: boolean
  followUpBehavior?: FollowUpBehavior
  isEditing?: boolean
  isStreaming?: boolean
  modelOptions?: readonly ModelSelectorOption[]
  modelOptionsLoading?: boolean
  modelSelectorDisabled?: boolean
  onAbort?: () => void
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void
  onCancelEdit?: () => void
  onChatModeChange?: (mode: ChatMode) => void
  onCompressChat?: () => void
  onGitBranchCreate?: (branchName: string) => void
  onGitBranchChange?: (branchName: string) => void
  onGitBranchRefresh?: () => void
  onModelChange?: (modelId: string) => void
  onAlternateFollowUp?: (value: string, attachments: ChatAttachment[], mentionPathMap: ReadonlyMap<string, string>) => void
  onReasoningEffortChange?: (effort: ReasoningEffort) => void
  onRefactorCandidateSelect?: (relativePath: string) => void
  onTerminalExecutionModeChange?: (mode: AppTerminalExecutionMode) => void
  onQueue?: (value: string, attachments: ChatAttachment[], mentionPathMap: ReadonlyMap<string, string>) => void
  onSend: (value: string, attachments: ChatAttachment[], mentionPathMap: ReadonlyMap<string, string>) => void
  refactorCandidates?: readonly WorkspaceRefactorCandidate[]
  refactorCandidatesLoading?: boolean
  selectedChatMode?: ChatMode
  initialMentionPathMap?: ReadonlyMap<string, string> | null
  reasoningEffort?: ReasoningEffort
  reasoningEffortOptions?: readonly ReasoningEffort[]
  reasoningEffortSelectorDisabled?: boolean
  selectedModelId?: string
  showRuntimeTargetSelector?: boolean
  showTerminalExecutionModeSelector?: boolean
  showReasoningEffortSelector?: boolean
  terminalExecutionMode?: AppTerminalExecutionMode
  workspaceRootPath?: string | null
  value: string
  onValueChange: (value: string) => void
  sendOnEnter?: boolean
  variant?: 'composer' | 'inline'
  editClickBoundaryRef?: RefObject<HTMLElement | null>
}

export function ChatInput({
  actionButtonMode = 'auto',
  attachments = [],
  conversationId = null,
  value,
  onValueChange,
  onSend,
  onCancelEdit,
  chatModeOptions = [],
  chatModeSelectorDisabled = false,
  modelOptions = [],
  modelOptionsLoading = false,
  modelSelectorDisabled,
  onChatModeChange,
  onModelChange,
  onAlternateFollowUp,
  onReasoningEffortChange,
  onRefactorCandidateSelect,
  onTerminalExecutionModeChange,
  isEditing = false,
  isStreaming = false,
  selectedChatMode = 'agent',
  initialMentionPathMap = null,
  reasoningEffort = 'medium',
  reasoningEffortOptions = [],
  reasoningEffortSelectorDisabled,
  selectedModelId = '',
  showReasoningEffortSelector = false,
  terminalExecutionMode = 'sandbox',
  sendOnEnter = true,
  variant = 'composer',
  focusSignal,
  disabled = false,
  onAbort,
  onAttachmentsChange,
  onCompressChat,
  onQueue,
  contextUsage,
  codexUsage,
  isCompressingChat = false,
  compactDisabled = false,
  refactorCandidates = [],
  refactorCandidatesLoading = false,
  gitBranchError = null,
  gitBranchLoading = false,
  gitBranchState,
  gitBranchSwitching = false,
  followUpBehavior = DEFAULT_FOLLOW_UP_BEHAVIOR,
  onGitBranchChange,
  onGitBranchCreate,
  onGitBranchRefresh,
  showRuntimeTargetSelector = false,
  showTerminalExecutionModeSelector = false,
  workspaceRootPath = null,
  editClickBoundaryRef,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const isMobileViewport = useIsMobileViewport()
  const isInline = variant === 'inline'
  const canManageAttachments = typeof onAttachmentsChange === 'function'
  const showChatModeSelector = chatModeOptions.length > 0 && typeof onChatModeChange === 'function'
  const showModelSelector = typeof onModelChange === 'function'
  const isModelSelectorDisabled = modelSelectorDisabled ?? disabled
  const isModelSelectorLoading = modelOptionsLoading && modelOptions.length === 0
  const modelSelectorTooltipContent = isModelSelectorLoading
    ? 'Loading models...'
    : modelOptions.length > 0
      ? 'Select model'
      : 'No models available'
  const showReasoningControl = showReasoningEffortSelector && typeof onReasoningEffortChange === 'function'
  const hasReasoningToggle =
    reasoningEffortOptions.length === 2 &&
    reasoningEffortOptions.includes('none') &&
    reasoningEffortOptions.includes('high')
  const isReasoningEffortDisabled = reasoningEffortSelectorDisabled ?? disabled
  const showRuntimeTargetControl = variant === 'composer' && showRuntimeTargetSelector
  const showTerminalExecutionModeControl =
    variant === 'composer' &&
    showTerminalExecutionModeSelector &&
    typeof onTerminalExecutionModeChange === 'function'
  const showGitBranchSelector = variant === 'composer' && typeof onGitBranchChange === 'function' && gitBranchState !== undefined
  const showRuntimeControls = canManageAttachments || showChatModeSelector || showModelSelector || showReasoningControl
  const canToggleChatMode = showChatModeSelector && !chatModeSelectorDisabled
  const showDetachedFooterControls =
    showRuntimeTargetControl || showTerminalExecutionModeControl || showGitBranchSelector
  const showRefactorCandidatesIndicator = workspaceRootPath && !isEditing
  const mentionMenu = useChatFileMentionMenu({
    attachmentRefreshKey: attachments.length,
    attachmentScopeId: conversationId,
    disabled,
    initialMentionPathMap,
    onValueChange,
    textareaRef,
    value,
    workspaceRootPath,
  })
  const clearMentionPathMap = mentionMenu.clearMentionPathMap
  const mentionNavigation = useChatMentionNavigation({
    onMentionBoundaryJump: mentionMenu.markTriggerUpdateSuppressed,
    mentionPathMap: mentionMenu.mentionPathMap,
    onValueChange,
    textareaRef,
    value,
  })
  const imageAttachments = getChatImageAttachments(attachments)
  const legacyImageAttachments = imageAttachments.filter((attachment) => !attachment.path)
  const hasContent = value.trim().length > 0 || attachments.length > 0
  const resolvedActionButtonMode =
    actionButtonMode === 'auto'
      ? isStreaming && hasContent && typeof onQueue === 'function'
        ? 'queue'
        : isStreaming && typeof onAbort === 'function' && !hasContent
          ? 'abort'
          : 'send'
      : actionButtonMode
  const canAbort = resolvedActionButtonMode === 'abort' && typeof onAbort === 'function'
  const canQueue = resolvedActionButtonMode === 'queue' && typeof onQueue === 'function'
  const canAlternateFollowUp = isStreaming && typeof onAlternateFollowUp === 'function'
  const gitBranchTooltip = gitBranchState?.hasRepository ? 'Switch branch' : 'Open a git-backed folder to view branches'

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled

  function handleAbort() {
    if (!canAbort) {
      return
    }

    onAbort()
  }

  function submitFollowUp(
    callback: (value: string, attachments: ChatAttachment[], mentionPathMap: ReadonlyMap<string, string>) => void,
  ) {
    if (!canSend) return
    mentionMenu.closeMenu()
    const mentionPathMap = new Map(mentionMenu.mentionPathMapRef.current)
    callback(mentionMenu.expandValueForSend(value), attachments, mentionPathMap)
    onValueChange('')
    onAttachmentsChange?.([])
    mentionMenu.clearMentionPathMap()
    setAttachmentError(null)
  }

  function handleQueue() {
    if (!canQueue || !onQueue) return
    submitFollowUp(onQueue)
  }

  function handleAlternateFollowUp() {
    if (!canAlternateFollowUp || !onAlternateFollowUp) return
    submitFollowUp(onAlternateFollowUp)
  }

  function handleSend() {
    submitFollowUp(onSend)
  }

  function handlePrimaryAction() {
    if (canAbort) {
      handleAbort()
      return
    }

    if (canQueue) {
      handleQueue()
      return
    }

    handleSend()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const textarea = textareaRef.current
      const imageReference = textarea
        ? findChatImageReferenceForDeletion({
            imageCount: legacyImageAttachments.length,
            key: e.key,
            selectionEnd: textarea.selectionEnd,
            selectionStart: textarea.selectionStart,
            text: value,
          })
        : null
      if (imageReference) {
        e.preventDefault()
        const nextState = removeChatImageReference({
          attachments,
          imageNumber: imageReference.imageNumber,
          text: value,
        })
        onAttachmentsChange?.(nextState.attachments)
        onValueChange(nextState.text)
        window.requestAnimationFrame(() => {
          const nextCursor = Math.min(imageReference.start, nextState.text.length)
          textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
        })
        return
      }
    }

    if (mentionMenu.handleKeyDown(e)) {
      return
    }

    if (mentionNavigation.handleKeyDown(e)) {
      return
    }

    if (canToggleChatMode && isChatModeToggleShortcut(e)) {
      const nextChatMode = getNextChatMode(selectedChatMode, chatModeOptions)
      if (nextChatMode) {
        e.preventDefault()
        onChatModeChange?.(nextChatMode)
      }
      return
    }

    if (canQueue && canAlternateFollowUp) {
      const followUpShortcutAction = resolveChatFollowUpShortcutAction(e)
      if (followUpShortcutAction) {
        e.preventDefault()
        if (followUpShortcutAction === 'alternate') handleAlternateFollowUp()
        else handleQueue()
        return
      }
    }

    if (sendOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handlePrimaryAction()
    }

    if (!sendOnEnter && e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handlePrimaryAction()
    }

    if (e.key === 'Escape' && isEditing && onCancelEdit) {
      e.preventDefault()
      onCancelEdit()
    }
  }

  async function persistNativeAttachment(file: File, sourcePath: string): Promise<ChatAttachment> {
    const stored = await window.tidecodeHistory.storeChatAttachment({
      conversationId,
      sourcePath,
    })
    if (stored.kind === 'folder') {
      return {
        fileName: stored.fileName,
        id: createClientId(),
        kind: 'folder',
        mimeType: stored.mimeType,
        path: stored.path,
        sizeBytes: stored.sizeBytes,
      }
    }
    if (isSupportedImageMimeType(file.type)) {
      const imageResult = await readChatAttachmentsFromFiles([file], [])
      const imageAttachment = imageResult.attachments.find((attachment) => attachment.kind === 'image')
      if (imageAttachment?.kind === 'image') {
        return {
          ...imageAttachment,
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

  async function handleAttachments(files: readonly File[]) {
    if (!canManageAttachments || disabled || files.length === 0) {
      return
    }

    const initialInsertionPosition = textareaRef.current?.selectionStart ?? value.length
    const availableSlots = Math.max(CHAT_ATTACHMENT_MAX_COUNT - attachments.length, 0)
    if (availableSlots === 0) {
      setAttachmentError(`You can attach up to ${CHAT_ATTACHMENT_MAX_COUNT} items per message.`)
      return
    }
    const nextNewAttachments: ChatAttachment[] = []
    const errors: string[] = []
    for (const file of files.slice(0, availableSlots)) {
      let sourcePath = ''
      try {
        sourcePath = window.tidecodeFileDrop?.getPathForFile(file)?.trim() ?? ''
      } catch {
        sourcePath = ''
      }
      try {
        if (sourcePath.length > 0) {
          nextNewAttachments.push(await persistNativeAttachment(file, sourcePath))
          continue
        }
        const fallbackResult = await readChatAttachmentsFromFiles(
          [file],
          [...attachments, ...nextNewAttachments],
        )
        for (const attachment of fallbackResult.attachments) {
          if (attachment.kind === 'image') {
            const stored = await window.tidecodeHistory.storeChatImageAttachment({
              conversationId,
              dataUrl: attachment.dataUrl,
              fileName: attachment.fileName,
            })
            nextNewAttachments.push({
              ...attachment,
              fileName: stored.fileName,
              path: stored.path,
            })
          } else {
            nextNewAttachments.push(attachment)
          }
        }
        errors.push(...fallbackResult.errors)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Unable to attach ${file.name || 'item'}.`)
      }
    }
    if (files.length > availableSlots) {
      errors.push(`You can attach up to ${CHAT_ATTACHMENT_MAX_COUNT} items per message.`)
    }

    if (nextNewAttachments.length > 0) {
      const nextAttachments = [...attachments, ...nextNewAttachments]
      const insertionPosition = textareaRef.current?.selectionStart ?? initialInsertionPosition
      onAttachmentsChange?.(nextAttachments)
      mentionMenu.insertMentionReferences(
        nextNewAttachments
          .filter((attachment): attachment is Extract<ChatAttachment, { path: string }> => 'path' in attachment && Boolean(attachment.path))
          .map((attachment) => ({
            label: attachment.fileName,
            path: attachment.path,
          })),
        insertionPosition,
      )
    }

    setAttachmentError(errors[0] ?? null)
  }

  async function handleAttachmentPaths(paths: readonly string[]) {
    if (!canManageAttachments || disabled || paths.length === 0) {
      return
    }
    const availableSlots = Math.max(CHAT_ATTACHMENT_MAX_COUNT - attachments.length, 0)
    if (availableSlots === 0) {
      setAttachmentError(`You can attach up to ${CHAT_ATTACHMENT_MAX_COUNT} items per message.`)
      return
    }
    const nextAttachments: ChatAttachment[] = []
    const errors: string[] = []
    for (const sourcePath of paths.slice(0, availableSlots)) {
      try {
        const stored = await window.tidecodeHistory.storeChatAttachment({
          conversationId,
          sourcePath,
        })
        nextAttachments.push({
          fileName: stored.fileName,
          id: createClientId(),
          kind: stored.kind,
          mimeType: stored.mimeType,
          path: stored.path,
          sizeBytes: stored.sizeBytes,
        })
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Unable to attach ${sourcePath}.`)
      }
    }
    if (paths.length > availableSlots) {
      errors.push(`You can attach up to ${CHAT_ATTACHMENT_MAX_COUNT} items per message.`)
    }
    if (nextAttachments.length > 0) {
      onAttachmentsChange?.([...attachments, ...nextAttachments])
      mentionMenu.insertMentionReferences(
        nextAttachments
          .filter((attachment): attachment is Extract<ChatAttachment, { kind: 'file' | 'folder' }> => (
            attachment.kind === 'file' || attachment.kind === 'folder'
          ))
          .map((attachment) => ({
          label: attachment.fileName,
          path: attachment.path,
          })),
      )
    }
    setAttachmentError(errors[0] ?? null)
  }

  function insertWorkspaceClipboardMentions(input: {
    entries: readonly { isDirectory: boolean; relativePath: string }[]
    workspaceRootPath: string
  }) {
    const normalizedWorkspaceRootPath = workspaceRootPath?.trim() ?? ''
    if (
      normalizedWorkspaceRootPath.length === 0 ||
      normalizeWorkspaceRootPathForComparison(normalizedWorkspaceRootPath) !==
        normalizeWorkspaceRootPathForComparison(input.workspaceRootPath)
    ) {
      return false
    }

    const normalizedRoot = normalizedWorkspaceRootPath.replace(/[\\/]+$/u, '')
    const workspaceName = normalizedRoot.split(/[\\/]/u).filter(Boolean).at(-1) ?? ''
    if (!workspaceName) {
      return false
    }

    const references = input.entries.flatMap((entry) => {
      const normalizedRelativePath = entry.relativePath.trim().replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '')
      if (!normalizedRelativePath) {
        return []
      }
      const label = normalizedRelativePath.split('/').filter(Boolean).at(-1)
      if (!label) {
        return []
      }
      return [{
        label,
        path: `@workspace/${workspaceName}/${normalizedRelativePath}${entry.isDirectory ? '/' : ''}`,
      }]
    })
    if (references.length === 0) {
      return false
    }

    mentionMenu.insertMentionReferences(references)
    setAttachmentError(null)
    return true
  }

  async function handleClipboardFilePaste(files: readonly File[]) {
    try {
      const workspaceFiles = await window.tidecodeClipboard.readWorkspaceFiles()
      if (workspaceFiles && insertWorkspaceClipboardMentions(workspaceFiles)) {
        return
      }
    } catch {
      // Fall through to the normal external attachment path.
    }

    if (files.length > 0) {
      await handleAttachments(files)
      return
    }

    try {
      const paths = await window.tidecodeClipboard.readFiles()
      await handleAttachmentPaths(paths)
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Unable to read files from the clipboard.')
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!canManageAttachments || disabled) {
      return
    }

    const files = Array.from(event.clipboardData.files)
    const hasFiles = files.length > 0 || Array.from(event.clipboardData.types).includes('Files')
    if (hasFiles) {
      event.preventDefault()
      void handleClipboardFilePaste(files)
      return
    }
  }

  function handleAttachmentDragOver(event: DragEvent<HTMLDivElement>) {
    if (!canManageAttachments || disabled || !Array.from(event.dataTransfer.types).includes('Files')) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleAttachmentDrop(event: DragEvent<HTMLDivElement>) {
    if (!canManageAttachments || disabled || !Array.from(event.dataTransfer.types).includes('Files')) {
      return
    }
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) {
      void handleAttachments(files)
      return
    }
    const paths: string[] = []
    for (const item of Array.from(event.dataTransfer.items)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      try {
        const sourcePath = window.tidecodeFileDrop?.getPathForFile(file)?.trim() ?? ''
        if (sourcePath) paths.push(sourcePath)
      } catch {
        // Ignore items without a native path.
      }
    }
    void handleAttachmentPaths(paths)
  }

  function handleManualAttachClick() {
    if (!canManageAttachments || disabled) {
      return
    }

    setIsAttachmentMenuOpen((current) => !current)
  }

  function handleAttachFileClick() {
    setIsAttachmentMenuOpen(false)
    fileInputRef.current?.click()
  }

  async function handleAttachFolderClick() {
    setIsAttachmentMenuOpen(false)
    if (!canManageAttachments || disabled) {
      return
    }
    if (attachments.length >= CHAT_ATTACHMENT_MAX_COUNT) {
      setAttachmentError(`You can attach up to ${CHAT_ATTACHMENT_MAX_COUNT} items per message.`)
      return
    }
    try {
      const stored = await window.tidecodeHistory.pickAndStoreChatAttachmentFolder(conversationId)
      if (!stored) {
        return
      }
      const attachment: ChatAttachment = {
        fileName: stored.fileName,
        id: createClientId(),
        kind: 'folder',
        mimeType: stored.mimeType,
        path: stored.path,
        sizeBytes: stored.sizeBytes,
      }
      onAttachmentsChange?.([...attachments, attachment])
      mentionMenu.insertMentionReferences([{
        label: attachment.fileName,
        path: attachment.path,
      }])
      setAttachmentError(null)
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Unable to attach folder.')
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    void handleAttachments(files)
  }

  useEffect(() => {
    if (focusSignal === undefined) {
      return
    }

    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    textarea.focus()
    const contentLength = textarea.value.length
    textarea.setSelectionRange(contentLength, contentLength)
  }, [focusSignal])

  useEffect(() => {
    const cancelEditing = onCancelEdit
    if (!isInline || !isEditing || !cancelEditing) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const container = containerRef.current
      if (!container) {
        return
      }

      const boundary = editClickBoundaryRef?.current
      if (!boundary) {
        return
      }

      if (event.target instanceof Node && boundary.contains(event.target) && !container.contains(event.target)) {
        if (event.target instanceof Element) {
          if (event.target.closest('[data-floating-menu-root="true"]')) {
            return
          }
        }

        cancelEditing?.()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [editClickBoundaryRef, isInline, isEditing, onCancelEdit])

  useEffect(() => {
    if (!isAttachmentMenuOpen) {
      return
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Element && target.closest('[data-attachment-menu-root="true"]')) {
        return
      }
      setIsAttachmentMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isAttachmentMenuOpen])

  useEffect(() => {
    if (value.trim().length > 0 || disabled) {
      return
    }

    clearMentionPathMap()
  }, [clearMentionPathMap, disabled, value])

  useEffect(() => {
    const nextValue = ensureChatImageReferences(value, attachments)
    if (nextValue !== value) {
      onValueChange(nextValue)
    }
  }, [attachments, onValueChange, value])

  useEffect(() => {
    if (!canManageAttachments || attachments.length === 0) {
      return
    }
    const activeMentionPaths = new Set(
      findChatMentionMatches(value, mentionMenu.mentionPathMap)
        .map((match) => match.path)
        .filter((path): path is string => Boolean(path)),
    )
    const nextAttachments = attachments.filter((attachment) => {
      if (!('path' in attachment) || !attachment.path) {
        return true
      }
      return activeMentionPaths.has(attachment.path)
    })
    if (nextAttachments.length !== attachments.length) {
      onAttachmentsChange?.(nextAttachments)
    }
  }, [attachments, canManageAttachments, mentionMenu.mentionPathMap, onAttachmentsChange, value])

  const followUpActionLabel = followUpBehavior === 'steer' ? 'Steer message' : 'Queue message'

  return (
    <div
      ref={containerRef}
      className="non-selectable-ui w-full"
      onDragOver={handleAttachmentDragOver}
      onDrop={handleAttachmentDrop}
    >
      <div className={`${chatInputSurfaceClassName} ${chatConversationSurfacePaddingClassName}`}>
        {isEditing && !isInline ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-action/25 bg-action/10 px-3 py-2 text-xs text-foreground">
            <span>Editing message</span>
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileInputChange}
          className="hidden"
          tabIndex={-1}
        />

        <div ref={mentionMenu.anchorRef} className="relative">
          <ChatMentionTextarea
            imageAttachments={imageAttachments}
            textareaRef={textareaRef}
            value={value}
            onBeforeInput={mentionNavigation.handleBeforeInput}
            onChange={(event) => mentionMenu.handleValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onClick={mentionNavigation.handleClick}
            onBlur={mentionMenu.handleBlur}
            onFocus={mentionMenu.handleFocus}
            onSelect={() => {
              const cursorPosition = textareaRef.current?.selectionStart ?? value.length
              mentionMenu.updateTriggerState(value, cursorPosition)
            }}
            placeholder={isEditing ? 'Edit your message...' : 'Type a message...'}
            disabled={disabled}
            rows={1}
            mentionPathMap={mentionMenu.mentionPathMap}
            style={{ fieldSizing: 'content' } as CSSProperties}
          />

          <ChatMentionMenu
            anchorRef={mentionMenu.anchorRef}
            isOpen={mentionMenu.isOpen}
            loading={mentionMenu.isIndexLoading}
            menuRef={mentionMenu.menuRef}
            menuStyle={mentionMenu.menuStyle}
            onSelect={mentionMenu.handleSelectMention}
            onSelectCategory={mentionMenu.handleSelectCategory}
            onHighlightIndex={mentionMenu.setHighlightedIndex}
            onResetHighlight={() => mentionMenu.setHighlightedIndex(mentionMenu.selectedIndex)}
            results={mentionMenu.searchResults}
            highlightedIndex={mentionMenu.highlightedIndex}
            selectedMenuType={mentionMenu.selectedMenuType}
            searchQuery={mentionMenu.searchQuery}
            workspaceRootAvailable={mentionMenu.workspaceRootAvailable}
          />
        </div>

        {attachmentError ? <p className="mt-2 text-sm text-danger-foreground">{attachmentError}</p> : null}

        <div
          className={isMobileViewport
            ? 'mt-2 flex min-w-0 items-center gap-1.5'
            : 'mt-1 flex items-end justify-between gap-3'}
        >
          {showRuntimeControls ? (
            <div
              data-mobile-runtime-controls={isMobileViewport ? 'true' : undefined}
              className={isMobileViewport
                ? 'grid min-w-0 flex-1 grid-cols-[auto_auto_5.25rem_auto] items-center justify-start gap-1.5'
                : 'flex min-w-0 flex-1 flex-wrap items-center gap-2 md:flex-nowrap'}
            >
              {canManageAttachments ? (
                <div className="relative" data-attachment-menu-root="true">
                  <Tooltip content="Attach">
                    <button
                      type="button"
                      onClick={handleManualAttachClick}
                      disabled={disabled}
                      aria-label="Attach file or folder"
                      aria-expanded={isAttachmentMenuOpen}
                      className="group flex h-8 w-8 items-center justify-center bg-transparent text-foreground disabled:cursor-not-allowed disabled:text-disabled-foreground"
                    >
                      <Paperclip size={14} className="shrink-0 transition-colors duration-150 group-hover:text-foreground" />
                    </button>
                  </Tooltip>
                  {isAttachmentMenuOpen ? (
                    <div
                      data-floating-menu-root="true"
                      className="absolute bottom-10 left-0 z-[1200] min-w-[150px] rounded-lg border border-border bg-surface p-1 shadow-soft"
                    >
                      <button
                        type="button"
                        onClick={handleAttachFileClick}
                        className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm text-foreground hover:bg-surface-muted"
                      >
                        <File size={14} />
                        Attach File
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAttachFolderClick()}
                        className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm text-foreground hover:bg-surface-muted"
                      >
                        <Folder size={14} />
                        Attach Folder
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showChatModeSelector ? (
                <Tooltip content="Select mode (Ctrl + .)" hideWhenTriggerExpanded triggerClassName={isMobileViewport ? 'min-w-0' : undefined}>
                  <ChatModeSelectorField
                    value={selectedChatMode}
                    onChange={onChatModeChange ?? (() => undefined)}
                    options={chatModeOptions}
                    disabled={chatModeSelectorDisabled}
                  />
                </Tooltip>
              ) : null}

              {showModelSelector ? (
                <Tooltip content={modelSelectorTooltipContent} hideWhenTriggerExpanded triggerClassName={isMobileViewport ? 'min-w-0 w-full' : undefined}>
                  <ModelSelectorField
                    value={selectedModelId}
                    onChange={onModelChange ?? (() => undefined)}
                    options={modelOptions}
                    className={isMobileViewport ? 'min-w-0 w-[5.25rem]' : undefined}
                    disabled={isModelSelectorDisabled}
                    fullWidth={isMobileViewport}
                    isLoading={isModelSelectorLoading}
                    labelClassName={isMobileViewport ? 'max-w-[3.75rem]' : undefined}
                    triggerClassName={isMobileViewport ? 'min-w-0 overflow-hidden' : undefined}
                  />
                </Tooltip>
              ) : null}

              {showReasoningControl ? (
                <Tooltip
                  content={hasReasoningToggle ? 'Turn reasoning on or off' : 'Set reasoning effort'}
                  hideWhenTriggerExpanded
                  triggerClassName={isMobileViewport ? 'min-w-0' : undefined}
                >
                  <ReasoningEffortBlock
                    options={reasoningEffortOptions}
                    value={reasoningEffort}
                    onChange={onReasoningEffortChange}
                    disabled={isReasoningEffortDisabled}
                  />
                </Tooltip>
              ) : null}
            </div>
          ) : null}

          <div
            className={isMobileViewport
              ? 'flex shrink-0 items-center justify-end gap-1.5'
              : 'flex shrink-0 flex-wrap items-center justify-end gap-2 self-end'}
          >
            {showRefactorCandidatesIndicator ? (
              <RefactorCandidatesIndicator
                candidates={refactorCandidates}
                disabled={disabled && !canAbort}
                isLoading={refactorCandidatesLoading}
                onSelectCandidate={onRefactorCandidateSelect}
              />
            ) : null}
            {contextUsage ? (
              <ContextIndicator
                disabled={disabled && !canAbort}
                compressDisabled={disabled || isStreaming || compactDisabled}
                isCompressing={isCompressingChat}
                onCompress={onCompressChat}
                usage={contextUsage}
              />
            ) : null}

            <Tooltip
              content={
                canAbort
                  ? 'Stop generating'
                  : canQueue
                    ? followUpActionLabel
                    : isEditing
                      ? 'Send edited message'
                      : 'Send message'
              }
            >
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={canAbort ? false : !canSend}
                aria-label={
                  canAbort
                    ? 'Stop generating'
                    : canQueue
                      ? followUpActionLabel
                      : isEditing
                        ? 'Send edited message'
                        : 'Send message'
                }
                className={[
                  'inline-flex h-9 w-9 items-center justify-center rounded-full p-0 leading-none transition-[background-color,color,transform] duration-150',
                  canAbort || canSend
                    ? 'chat-send-button-enabled cursor-pointer active:scale-95'
                    : 'chat-send-button-disabled cursor-not-allowed',
                ].join(' ')}
              >
                {canAbort ? (
                  <Square className="block shrink-0" size={14} strokeWidth={2.5} fill="currentColor" />
                ) : canQueue ? (
                  <Clock className="block shrink-0" size={16} strokeWidth={2.5} />
                ) : (
                  <ArrowUp className="block shrink-0" size={16} strokeWidth={2} />
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {showDetachedFooterControls ? (
<div className="mt-2 hidden min-w-0 items-center gap-3 px-2 md:flex">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
            {showRuntimeTargetControl ? (
              <Tooltip content="Select runtime target" hideWhenTriggerExpanded>
                <RuntimeTargetSelectorField triggerClassName="chat-footer-control-trigger" />
              </Tooltip>
            ) : null}

            {showTerminalExecutionModeControl ? (
              <Tooltip
                content="Select terminal execution mode"
                hideWhenTriggerExpanded
                triggerClassName="min-w-0 max-w-full"
              >
                <TerminalExecutionModeSelectorField
                  triggerClassName="chat-footer-control-trigger"
                  value={terminalExecutionMode}
                  onChange={onTerminalExecutionModeChange}
                />
              </Tooltip>
            ) : null}
          </div>

          <div className="flex min-w-0 max-w-[50%] shrink items-center justify-end gap-2">
            {codexUsage ? (
              <div className="shrink-0">
                <CodexUsageIndicator usage={codexUsage} />
              </div>
            ) : null}
            {showGitBranchSelector && gitBranchState ? (
              <Tooltip
                content={gitBranchTooltip}
                hideWhenTriggerExpanded
                triggerClassName="min-w-0 max-w-full flex-1"
              >
                <GitBranchSelectorField
                  branches={gitBranchState.branches}
                  currentBranch={gitBranchState.currentBranch}
                  remoteBranches={gitBranchState.remoteBranches}
                  disabled={disabled}
                  errorMessage={gitBranchError}
                  hasRepository={gitBranchState.hasRepository}
                  isDetachedHead={gitBranchState.isDetachedHead}
                  isLoading={gitBranchLoading}
                  isSwitching={gitBranchSwitching}
                  onChange={onGitBranchChange ?? (() => undefined)}
                  onCreateBranch={onGitBranchCreate ?? (() => undefined)}
                  onRefresh={onGitBranchRefresh}
                  triggerClassName="chat-footer-control-trigger w-full"
                />
              </Tooltip>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
