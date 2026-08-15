import type { ModelMessage } from 'ai'
import { normalizeAssistantMessageContent } from '../../../src/lib/chatMessageContent'
import {
  COMPRESSION_ACKNOWLEDGEMENT_TEXT,
  parseCompressedHistoryMessage,
} from '../../../src/lib/chatCompression'
import { EXECUTION_MODE_CONTEXT_PATTERN } from '../../../src/lib/executionModeContext'
import { getToolResultModelContent, parseStructuredToolResultContent } from '../../../src/lib/toolResultContent'
import type { ChatMode, Message, AppTerminalExecutionMode } from '../../../src/types/chat'
import type { AgentOrchestrationMode } from './orchestration'
import { buildChatModeSystemPrompt } from './prompts/mode'
import {
  ensureChatImageReferences,
  getChatImageAttachments,
  splitChatImageReferenceSegments,
} from '../../../src/lib/chatImageReferences'

type ToolModelMessage = Extract<ModelMessage, { role: 'tool' }>
type ToolResultContentPart = ToolModelMessage['content'][number]
type AssistantModelMessage = Extract<ModelMessage, { role: 'assistant' }>
type AssistantContentPart = Exclude<AssistantModelMessage['content'], string>[number]

interface CanonicalToolCall {
  argumentsValue: Record<string, unknown>
  toolName: string
}

export interface BuildChatPromptOptions {
  includeAssistantReasoningParts?: boolean
  includeExecutionModeContext?: boolean
  includeImageAttachments?: boolean
  orchestrationMode?: AgentOrchestrationMode
  terminalExecutionMode?: AppTerminalExecutionMode
}

type UserTextPart = {
  text: string
  type: 'text'
}

type UserFilePart = {
  data: {
    data: string
    type: 'data'
  }
  filename?: string
  mediaType: string
  type: 'file'
}

type UserContentPart = UserTextPart | UserFilePart

type UserModelMessage = Extract<ModelMessage, { role: 'user' }>

export function buildExecutionModeContext(terminalExecutionMode: AppTerminalExecutionMode) {
  const details =
    terminalExecutionMode === 'sandbox'
      ? [
          'Terminal execution mode: sandbox.',
          'Filesystem access is limited to the workspace. A loaded skill may provide a specific skill directory for its own referenced resources.',
        ]
      : [
          'Terminal execution mode: full access.',
          'Filesystem tools and terminal commands may access paths outside the workspace only when required by the user request or a loaded skill.',
        ]

  return [
    `<execution_mode_context mode="${terminalExecutionMode}">`,
    ...details,
    '</execution_mode_context>',
  ].join('\n')
}

function appendExecutionModeContext(
  message: UserModelMessage,
  terminalExecutionMode: AppTerminalExecutionMode,
): UserModelMessage {
  const notice = buildExecutionModeContext(terminalExecutionMode)
  const content =
    typeof message.content === 'string'
      ? `${message.content}\n\n${notice}`
      : [...message.content, { text: notice, type: 'text' as const }]

  return {
    ...message,
    content,
  }
}

function getExecutionModeFromUserMessage(message: UserModelMessage) {
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
  const matches = Array.from(text.matchAll(EXECUTION_MODE_CONTEXT_PATTERN))
  const mode = matches.at(-1)?.[1]
  return mode === 'sandbox' || mode === 'full' ? mode : null
}

export function ensureCurrentExecutionModeContext(
  messages: ModelMessage[],
  terminalExecutionMode: AppTerminalExecutionMode,
) {
  const nextMessages = [...messages]
  const userMessageIndexes = nextMessages
    .map((message, index) => message.role === 'user' ? index : -1)
    .filter((index) => index >= 0)
  const latestUserMessageIndex = userMessageIndexes.at(-1)
  if (latestUserMessageIndex === undefined) {
    return nextMessages
  }

  let lastContextMode: AppTerminalExecutionMode | null = null
  for (let position = userMessageIndexes.length - 1; position >= 0; position -= 1) {
    const messageIndex = userMessageIndexes[position]
    const message = nextMessages[messageIndex] as UserModelMessage
    const mode = getExecutionModeFromUserMessage(message)
    if (mode) {
      lastContextMode = mode
      break
    }
  }

  const shouldAppend = lastContextMode === null || lastContextMode !== terminalExecutionMode
  if (!shouldAppend) {
    return nextMessages
  }

  // Establish the initial mode at the start of the user-visible history so it
  // behaves like version 1 of the execution context. Later mode changes belong
  // on the latest user message so they take effect immediately.
  const targetUserMessageIndex = lastContextMode === null
    ? userMessageIndexes[0]
    : latestUserMessageIndex
  nextMessages[targetUserMessageIndex] = appendExecutionModeContext(
    nextMessages[targetUserMessageIndex] as UserModelMessage,
    terminalExecutionMode,
  )
  return nextMessages
}

function buildUserContent(
  message: Message,
  includeImageAttachments: boolean,
): ModelMessage['content'] {
  const parts: UserContentPart[] = []
  const imageAttachments = getChatImageAttachments(message.attachments ?? [])
  const referencedImageIndexes = new Set<number>()
  const referencedContent = ensureChatImageReferences(message.content, imageAttachments)

  const appendText = (text: string) => {
    if (text.length === 0) return
    const previousPart = parts.at(-1)
    if (previousPart?.type === 'text') {
      previousPart.text += text
    } else {
      parts.push({ text, type: 'text' })
    }
  }

  if (!includeImageAttachments) {
    appendText(referencedContent)
  } else {
    for (const segment of splitChatImageReferenceSegments(referencedContent, imageAttachments.length)) {
      if (segment.type === 'text') {
        appendText(segment.text)
        continue
      }

      appendText(segment.text)
      const attachment = imageAttachments[segment.imageIndex]
      if (attachment && !referencedImageIndexes.has(segment.imageIndex)) {
        const normalizedMediaType = attachment.mimeType.trim() || 'image/png'
        const separatorIndex = attachment.dataUrl.indexOf(',')
        const base64Data = separatorIndex >= 0
          ? attachment.dataUrl.slice(separatorIndex + 1)
          : attachment.dataUrl
        parts.push({
          data: { data: base64Data, type: 'data' },
          filename: attachment.fileName,
          mediaType: normalizedMediaType,
          type: 'file',
        })
        referencedImageIndexes.add(segment.imageIndex)
      }
    }
  }

  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === 'image') continue
    const attachmentText = `Attachment ${attachment.fileName}:\n${attachment.textContent}`
    if (attachmentText.trim().length > 0) {
      parts.push({
        text: attachmentText,
        type: 'text',
      })
    }
  }

  if (parts.length === 0) {
    return ''
  }

  if (parts.length === 1 && parts[0]?.type === 'text') {
    return parts[0].text
  }

  return parts
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isImageModelContentPart(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  if (value.type === 'image' || value.type === 'image_url' || value.type === 'input_image') {
    return true
  }

  return value.type === 'file' && typeof value.mediaType === 'string' && /^image\//iu.test(value.mediaType)
}

function isTextModelContentPart(value: unknown): value is { text: string; type: 'text' } {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string'
}

export function hasImageAttachmentsInModelMessages(messages: readonly ModelMessage[]) {
  return messages.some((message) => (
    message.role === 'user' &&
    Array.isArray(message.content) &&
    message.content.some((part) => isImageModelContentPart(part))
  ))
}

export function stripImageAttachmentsFromModelMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user' || typeof message.content === 'string') {
      return message
    }

    const textContent = message.content
      .filter((part) => isTextModelContentPart(part))
      .map((part) => part.text)
      .join('')
    let imageNumber = 0
    const nextContent: Array<Record<string, unknown>> = []

    for (const part of message.content) {
      if (!isImageModelContentPart(part)) {
        nextContent.push(part as unknown as Record<string, unknown>)
        continue
      }

      imageNumber += 1
      const label = `[Image #${imageNumber}]`
      if (!textContent.includes(label)) {
        nextContent.push({ text: label, type: 'text' })
      }
    }

    if (!hasImageAttachmentsInModelMessages([message])) {
      return message
    }

    return {
      ...message,
      content: nextContent as unknown as UserModelMessage['content'],
    }
  })
}

function parseToolArguments(argumentsText: string) {
  try {
    const parsedValue = JSON.parse(argumentsText) as unknown
    if (typeof parsedValue !== 'object' || parsedValue === null) {
      return null
    }

    return parsedValue
  } catch {
    return null
  }
}

function buildCanonicalToolCallIndex(inputMessages: readonly Message[]) {
  const canonicalToolCalls = new Map<string, CanonicalToolCall>()

  for (const message of inputMessages) {
    if (message.role !== 'tool' || !message.toolCallId) {
      continue
    }

    const parsedResult = parseStructuredToolResultContent(message.content)
    const metadata = parsedResult.metadata
    if (!metadata?.arguments || metadata.toolName.trim().length === 0) {
      continue
    }

    canonicalToolCalls.set(message.toolCallId, {
      argumentsValue: metadata.arguments,
      toolName: metadata.toolName,
    })
  }

  return canonicalToolCalls
}

function buildAssistantToolCallParts(
  message: Message,
  validToolCallIds: Set<string>,
  canonicalToolCalls: ReadonlyMap<string, CanonicalToolCall>,
) {
  const toolCallParts: AssistantContentPart[] = []

  for (const invocation of message.toolInvocations ?? []) {
    if (invocation.state === 'running') {
      continue
    }

    const canonicalToolCall = canonicalToolCalls.get(invocation.id)
    const parsedArguments = canonicalToolCall?.argumentsValue ?? parseToolArguments(invocation.argumentsText)
    const input = parsedArguments
    if (!input) {
      continue
    }

    validToolCallIds.add(invocation.id)
    toolCallParts.push({
      args: input,
      input,
      toolCallId: invocation.id,
      toolName: canonicalToolCall?.toolName ?? invocation.toolName,
      type: 'tool-call',
    } as AssistantContentPart)
  }

  return toolCallParts
}

function buildToolResultParts(message: Message, validToolCallIds: Set<string>): ToolResultContentPart[] {
  if (!message.toolCallId || !validToolCallIds.has(message.toolCallId)) {
    return []
  }

  const parsedStructuredResult = parseStructuredToolResultContent(message.content)
  const toolName = parsedStructuredResult.metadata?.toolName?.trim()
  if (!toolName) {
    return []
  }

  const outputText = getToolResultModelContent(message.content)
  if (!outputText) {
    return []
  }

  return [
    {
      output: {
        type: 'text',
        value: outputText,
      },
      toolCallId: message.toolCallId,
      toolName,
      type: 'tool-result',
    },
  ]
}

function toAssistantMessage(
  message: Message,
  validToolCallIds: Set<string>,
  canonicalToolCalls: ReadonlyMap<string, CanonicalToolCall>,
  options: Required<BuildChatPromptOptions>,
): ModelMessage | null {
  const normalized = normalizeAssistantMessageContent(message)
  const toolCallParts = buildAssistantToolCallParts(message, validToolCallIds, canonicalToolCalls)
  const reasoningText = normalized.reasoningContent.trim()
  const text = normalized.content.trim()
  const combinedAssistantText = text

  if (toolCallParts.length === 0) {
    if (!combinedAssistantText && (!options.includeAssistantReasoningParts || !reasoningText)) {
      return null
    }

    return {
      content:
        options.includeAssistantReasoningParts && reasoningText.length > 0
          ? [
              {
                text: reasoningText,
                type: 'reasoning' as const,
              },
              ...(combinedAssistantText.length > 0
                ? [
                    {
                      text: combinedAssistantText,
                      type: 'text' as const,
                    },
                  ]
                : []),
            ]
          : combinedAssistantText || reasoningText,
      role: 'assistant',
    }
  }

  const contentParts: AssistantContentPart[] = []

  if (options.includeAssistantReasoningParts && reasoningText) {
    contentParts.push({
      text: reasoningText,
      type: 'reasoning',
    })
  }

  if (combinedAssistantText) {
    contentParts.push({
      text: combinedAssistantText,
      type: 'text',
    })
  }

  contentParts.push(...toolCallParts)

  return {
    content: contentParts,
    role: 'assistant',
  }
}

function toToolMessage(message: Message, validToolCallIds: Set<string>): ToolModelMessage | null {
  const toolResultParts = buildToolResultParts(message, validToolCallIds)
  if (toolResultParts.length === 0) {
    return null
  }

  return {
    content: toolResultParts,
    role: 'tool',
  }
}

function appendModelMessage(messages: ModelMessage[], nextMessage: ModelMessage) {
  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role === 'tool' && nextMessage.role === 'tool') {
    // The AI SDK allows multiple `tool-result` parts in one tool message.
    // Combining consecutive tool history entries keeps the replay compact.
    lastMessage.content.push(...nextMessage.content)
    return
  }

  messages.push(nextMessage)
}

function buildLegacyCompactionHandoff(content: string): ModelMessage | null {
  const parsed = parseCompressedHistoryMessage(content)
  if (!parsed || parsed.summary.trim().length === 0) return null

  return {
    content: parsed.summary,
    role: 'assistant',
  }
}

export function stripLegacyCompactionContainers(messages: readonly ModelMessage[]) {
  const projectedMessages: ModelMessage[] = []

  for (const message of messages) {
    if (message.role === 'user' && typeof message.content === 'string') {
      const handoff = buildLegacyCompactionHandoff(message.content)
      if (handoff) {
        appendModelMessage(projectedMessages, handoff)
        continue
      }
    }

    if (
      message.role === 'assistant' &&
      typeof message.content === 'string' &&
      message.content.trim() === COMPRESSION_ACKNOWLEDGEMENT_TEXT
    ) {
      continue
    }

    appendModelMessage(projectedMessages, message)
  }

  return projectedMessages
}

function toModelMessage(
  message: Message,
  validToolCallIds: Set<string>,
  canonicalToolCalls: ReadonlyMap<string, CanonicalToolCall>,
  options: Required<BuildChatPromptOptions>,
): ModelMessage | null {
  if (message.role === 'user') {
    const content = buildUserContent(message, options.includeImageAttachments)
    if (typeof content === 'string') {
      if (!content.trim()) {
        return null
      }
    } else if (content.length === 0) {
      return null
    }

    return {
      content: content as Extract<ModelMessage, { role: 'user' }>['content'],
      role: 'user',
    }
  }

  if (message.role === 'assistant') {
    return toAssistantMessage(message, validToolCallIds, canonicalToolCalls, options)
  }

  if (message.role === 'tool') {
    return toToolMessage(message, validToolCallIds)
  }

  return null
}

function toLegacyCompactionHandoff(message: Message): ModelMessage | null {
  if (message.role !== 'user' || typeof message.content !== 'string') return null
  return buildLegacyCompactionHandoff(message.content)
}

function isLegacyCompactionAcknowledgement(message: Message) {
  return message.role === 'assistant' && message.content.trim() === COMPRESSION_ACKNOWLEDGEMENT_TEXT
}

export function buildChatSystemPrompt(chatMode: ChatMode, workspaceRootPath: string, options?: BuildChatPromptOptions) {
  return buildChatModeSystemPrompt(chatMode, workspaceRootPath, {
    orchestrationMode: options?.orchestrationMode,
    terminalExecutionMode: options?.terminalExecutionMode,
  })
}

export function buildChatPrompt(input: {
  chatMode: ChatMode
  messages: Message[]
  options?: BuildChatPromptOptions
  workspaceRootPath: string
}): { messages: ModelMessage[]; system: string } {
  const terminalExecutionMode = input.options?.terminalExecutionMode ?? 'sandbox'
  return {
    messages: ensureCurrentExecutionModeContext(
      buildModelMessages(input.messages, input.options),
      terminalExecutionMode,
    ),
    system: buildChatSystemPrompt(input.chatMode, input.workspaceRootPath, input.options),
  }
}

export function buildModelMessages(
  inputMessages: Message[],
  inputOptions?: BuildChatPromptOptions,
): ModelMessage[] {
  const validToolCallIds = new Set<string>()
  const canonicalToolCalls = buildCanonicalToolCallIndex(inputMessages)
  const messages: ModelMessage[] = []
  const options: Required<BuildChatPromptOptions> = {
    includeAssistantReasoningParts: inputOptions?.includeAssistantReasoningParts ?? true,
    includeExecutionModeContext: inputOptions?.includeExecutionModeContext ?? true,
    includeImageAttachments: inputOptions?.includeImageAttachments ?? true,
    orchestrationMode: inputOptions?.orchestrationMode ?? 'direct',
    terminalExecutionMode: inputOptions?.terminalExecutionMode ?? 'sandbox',
  }

  for (const message of inputMessages) {
    const legacyCompactionHandoff = toLegacyCompactionHandoff(message)
    if (legacyCompactionHandoff) {
      appendModelMessage(messages, legacyCompactionHandoff)
      continue
    }

    if (isLegacyCompactionAcknowledgement(message)) {
      continue
    }

    const modelMessage = toModelMessage(message, validToolCallIds, canonicalToolCalls, options)
    if (!modelMessage) {
      continue
    }

    appendModelMessage(messages, modelMessage)
  }

  const legacySafeMessages = stripLegacyCompactionContainers(messages)
  return options.includeExecutionModeContext
    ? ensureCurrentExecutionModeContext(legacySafeMessages, options.terminalExecutionMode)
    : legacySafeMessages
}
