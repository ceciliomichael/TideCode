import type { ModelMessage } from 'ai'
import { normalizeAssistantMessageContent } from '../../../src/lib/chatMessageContent'
import { getToolResultModelContent, parseStructuredToolResultContent } from '../../../src/lib/toolResultContent'
import type { ChatMode, Message, AppTerminalExecutionMode } from '../../../src/types/chat'
import { buildChatModeSystemPrompt } from './prompts/mode'

type ToolModelMessage = Extract<ModelMessage, { role: 'tool' }>

export interface BuildChatPromptOptions {
  availableSkillsBlock?: string | null
  includeAssistantReasoningParts?: boolean
  includeExecutionModeContext?: boolean
  terminalExecutionMode?: AppTerminalExecutionMode
}

type UserTextPart = {
  text: string
  type: 'text'
}

type UserImagePart = {
  image: string
  mediaType?: string
  type: 'image'
}

type UserContentPart = UserTextPart | UserImagePart

type UserModelMessage = Extract<ModelMessage, { role: 'user' }>

const EXECUTION_MODE_CONTEXT_PATTERN =
  /<execution_mode_context mode="(sandbox|full)">[\s\S]*?<\/execution_mode_context>/gu

export function buildExecutionModeContext(terminalExecutionMode: AppTerminalExecutionMode) {
  const details =
    terminalExecutionMode === 'sandbox'
      ? [
          'Terminal execution mode: sandbox.',
          'Filesystem access is limited to the workspace, with read/list/glob/grep and terminal working-directory access also allowed under the global ~/.agents directory.',
        ]
      : [
          'Terminal execution mode: full access.',
          'Filesystem tools and terminal commands may access paths outside the workspace.',
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

function buildUserContent(message: Message): ModelMessage['content'] {
  const parts: UserContentPart[] = []
  const originalContent = message.content

  if (originalContent.trim().length > 0) {
    parts.push({
      text: originalContent,
      type: 'text',
    })
  }

  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === 'image') {
      const normalizedMediaType = attachment.mimeType.trim()
      parts.push({
        image: attachment.dataUrl,
        ...(normalizedMediaType.length > 0 ? { mediaType: normalizedMediaType } : {}),
        type: 'image',
      })
      continue
    }

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

function buildAssistantToolCallParts(message: Message, validToolCallIds: Set<string>) {
  const toolCallParts: Array<any> = []

  for (const invocation of message.toolInvocations ?? []) {
    if (invocation.state === 'running') {
      continue
    }

    const parsedArguments = parseToolArguments(invocation.argumentsText)
    const rawArguments = invocation.argumentsText.trim().length > 0 ? invocation.argumentsText : null
    const input = parsedArguments ?? (invocation.toolName === 'apply_patch' ? rawArguments : null)
    if (!input) {
      continue
    }

    validToolCallIds.add(invocation.id)
    toolCallParts.push({
      args: input,
      input,
      toolCallId: invocation.id,
      toolName: invocation.toolName,
      type: 'tool-call',
    })
  }

  return toolCallParts
}

function buildToolResultParts(message: Message, validToolCallIds: Set<string>): any[] {
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
      result: outputText,
      toolCallId: message.toolCallId,
      toolName,
      type: 'tool-result',
    },
  ]
}

function toAssistantMessage(
  message: Message,
  validToolCallIds: Set<string>,
  options: Required<BuildChatPromptOptions>,
): ModelMessage | null {
  const normalized = normalizeAssistantMessageContent(message)
  const toolCallParts = buildAssistantToolCallParts(message, validToolCallIds)
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

  const contentParts: Array<any> = []

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

function toModelMessage(
  message: Message,
  validToolCallIds: Set<string>,
  options: Required<BuildChatPromptOptions>,
): ModelMessage | null {
  if (message.role === 'user') {
    const content = buildUserContent(message)
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
    return toAssistantMessage(message, validToolCallIds, options)
  }

  if (message.role === 'tool') {
    return toToolMessage(message, validToolCallIds)
  }

  return null
}

export function buildChatSystemPrompt(chatMode: ChatMode, workspaceRootPath: string, options?: BuildChatPromptOptions) {
  return buildChatModeSystemPrompt(chatMode, workspaceRootPath, {
    availableSkillsBlock: options?.availableSkillsBlock,
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
  const messages: ModelMessage[] = []
  const options: Required<BuildChatPromptOptions> = {
    availableSkillsBlock: inputOptions?.availableSkillsBlock ?? null,
    includeAssistantReasoningParts: inputOptions?.includeAssistantReasoningParts ?? true,
    includeExecutionModeContext: inputOptions?.includeExecutionModeContext ?? true,
    terminalExecutionMode: inputOptions?.terminalExecutionMode ?? 'sandbox',
  }

  for (const message of inputMessages) {
    const modelMessage = toModelMessage(message, validToolCallIds, options)
    if (!modelMessage) {
      continue
    }

    appendModelMessage(messages, modelMessage)
  }

  return options.includeExecutionModeContext
    ? ensureCurrentExecutionModeContext(messages, options.terminalExecutionMode)
    : messages
}
