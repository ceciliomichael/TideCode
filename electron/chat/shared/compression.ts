import type { ModelMessage } from 'ai'
import { normalizeAssistantMessageContent } from '../../../src/lib/chatMessageContent'
import { getToolResultModelContent } from '../../../src/lib/toolResultContent'
import type { ChatMode, Message, ReasoningEffort } from '../../../src/types/chat'
import { buildChatCompressionSystemPrompt } from './prompts/compression'

const PRIMARY_TRANSCRIPT_CHAR_LIMIT = 120_000
const SECONDARY_TRANSCRIPT_CHAR_LIMIT = 60_000
const FALLBACK_EXCERPT_CHAR_LIMIT = 240
const COMPRESSION_REQUEST_TIMEOUT_MS = 90_000

interface CompressionStreamFactoryInput {
  messages: ModelMessage[]
  model: string
  reasoningEffort: ReasoningEffort
  signal: AbortSignal
  system: string
}

type CompressionStreamFactory = (
  input: CompressionStreamFactoryInput,
) => Promise<{
  fullStream: AsyncIterable<{ text?: string; type: string }>
}>

export interface CompressChatHistoryInput {
  agentContextRootPath: string
  chatMode: ChatMode
  createStream: CompressionStreamFactory
  messages: Message[]
  modelId: string
  reasoningEffort: ReasoningEffort
}

function formatUserMessage(message: Message) {
  const textAttachments = (message.attachments ?? [])
    .filter((attachment) => attachment.kind === 'text')
    .map((attachment) => `Attachment (${attachment.fileName}):\n${attachment.textContent}`)
  return [message.content.trim(), ...textAttachments].filter((part) => part.length > 0).join('\n\n')
}

function formatAssistantMessage(message: Message, toolResultCallIds: ReadonlySet<string>) {
  const normalized = normalizeAssistantMessageContent(message)
  const content = normalized.content.trim()
  const parts = [content].filter((part) => part.length > 0)

  const completedInvocations = (message.toolInvocations ?? []).filter((invocation) => invocation.state !== 'running')
  if (completedInvocations.length > 0) {
    const invocationLines = completedInvocations.map((invocation) => {
      const resultContent = invocation.resultContent?.trim() ?? ''
      const resultSuffix =
        resultContent.length > 0 && !toolResultCallIds.has(invocation.id)
          ? `\nResult:\n${resultContent}`
          : ''
      return `Tool Invocation: ${invocation.toolName}\nArguments:\n${invocation.argumentsText}${resultSuffix}`
    })
    parts.push(invocationLines.join('\n\n'))
  }

  return parts.join('\n\n').trim()
}

function formatToolMessage(message: Message) {
  const content = getToolResultModelContent(message.content)
  return content.trim()
}

function formatConversationTranscriptBlocks(messages: Message[]) {
  const blocks: string[] = []
  const toolResultCallIds = new Set(
    messages
      .filter((message) => message.role === 'tool' && message.toolCallId)
      .map((message) => message.toolCallId as string),
  )

  messages.forEach((message, index) => {
    let roleLabel = ''
    let content = ''

    if (message.role === 'user') {
      roleLabel = 'USER'
      content = formatUserMessage(message)
    } else if (message.role === 'assistant') {
      roleLabel = 'ASSISTANT'
      content = formatAssistantMessage(message, toolResultCallIds)
    } else {
      roleLabel = 'TOOL_RESULT'
      content = formatToolMessage(message)
    }

    const normalizedContent = content.trim().length > 0 ? content.trim() : '[empty]'
    blocks.push(`Turn ${index + 1} | ${roleLabel}\n${normalizedContent}`)
  })

  return blocks
}

function trimTranscriptTail(blocks: string[], maxCharacters: number) {
  const fullTranscript = blocks.join('\n\n')
  if (fullTranscript.length <= maxCharacters) {
    return {
      transcript: fullTranscript,
      wasTrimmed: false,
    }
  }

  let transcript = ''

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    const separatorLength = transcript.length > 0 ? 2 : 0
    const nextLength = transcript.length + separatorLength + block.length
    if (nextLength <= maxCharacters) {
      transcript = transcript.length > 0 ? `${block}\n\n${transcript}` : block
      continue
    }

    const remainingCharacters = maxCharacters - transcript.length - separatorLength
    if (remainingCharacters > 0) {
      const tail = block.slice(block.length - remainingCharacters)
      transcript = transcript.length > 0 ? `${tail}\n\n${transcript}` : tail
    }
    break
  }

  return {
    transcript,
    wasTrimmed: true,
  }
}

function buildTranscriptCandidates(messages: Message[]) {
  const blocks = formatConversationTranscriptBlocks(messages)
  const fullTranscript = blocks.join('\n\n')
  if (fullTranscript.length <= PRIMARY_TRANSCRIPT_CHAR_LIMIT) {
    return [
      {
        transcript: fullTranscript,
        wasTrimmed: false,
      },
    ]
  }

  const primaryCandidate = trimTranscriptTail(blocks, PRIMARY_TRANSCRIPT_CHAR_LIMIT)
  const secondaryCandidate = trimTranscriptTail(blocks, SECONDARY_TRANSCRIPT_CHAR_LIMIT)
  if (secondaryCandidate.transcript === primaryCandidate.transcript) {
    return [primaryCandidate]
  }

  return [primaryCandidate, secondaryCandidate]
}

async function collectStreamedText(
  createStream: CompressionStreamFactory,
  input: CompressionStreamFactoryInput,
) {
  const stream = await createStream(input)
  let text = ''
  for await (const part of stream.fullStream) {
    if (part.type === 'text-delta' && typeof part.text === 'string') {
      text += part.text
    }
  }

  return text.trim()
}

async function collectCompressionText(
  createStream: CompressionStreamFactory,
  input: Omit<CompressionStreamFactoryInput, 'signal'>,
) {
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => {
    abortController.abort()
  }, COMPRESSION_REQUEST_TIMEOUT_MS)

  try {
    return await collectStreamedText(createStream, {
      ...input,
      signal: abortController.signal,
    })
  } catch (error) {
    console.warn('Chat compression model request failed; using local recovery.', error)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

function compactText(value: string, maxLength = FALLBACK_EXCERPT_CHAR_LIMIT) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function containsCampSections(summary: string) {
  const requiredSections = [
    'Goal',
    'Current State',
    'Done',
    'Decisions',
    'Open Items',
    'Key Refs',
    'Next Step',
  ]
  const normalized = summary.toLowerCase()
  return requiredSections.every((sectionName) => normalized.includes(sectionName.toLowerCase()))
}

function buildCampRepairPrompt(candidateSummary: string) {
  return [
    'Rewrite the following into strict CAMP format.',
    'Return only CAMP text with section headings on separate lines and multiline bullets.',
    'Do not include any preface like "Updated memory" or "Summary".',
    'You must exclusively use the English language.',
    '',
    candidateSummary,
  ].join('\n')
}

function collectCompletedToolNames(messages: Message[]) {
  const toolNames = new Set<string>()

  messages.forEach((message) => {
    message.toolInvocations?.forEach((invocation) => {
      if (invocation.state === 'running') {
        return
      }

      const toolName = invocation.toolName.trim()
      if (toolName.length > 0) {
        toolNames.add(toolName)
      }
    })
  })

  return [...toolNames]
}

function buildFallbackCampSummary(messages: Message[], wasTrimmed: boolean) {
  const firstUserMessage = messages.find((message) => message.role === 'user')
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')
  const completedToolNames = collectCompletedToolNames(messages)

  const goalText = firstUserMessage ? compactText(formatUserMessage(firstUserMessage)) : 'none'
  const currentStateParts = [
    wasTrimmed
      ? 'The transcript was trimmed to the most recent context before compression.'
      : 'The compression model returned no visible text on this run.',
  ]

  if (lastAssistantMessage) {
    currentStateParts.push(`Latest assistant context: ${compactText(formatAssistantMessage(lastAssistantMessage, new Set()))}`)
  }

  if (lastUserMessage) {
    currentStateParts.push(`Latest user request: ${compactText(formatUserMessage(lastUserMessage))}`)
  }

  if (completedToolNames.length > 0) {
    currentStateParts.push(`Tool activity: ${completedToolNames.join(', ')}`)
  }

  return [
    'Goal:',
    `- ${goalText || 'none'}`,
    '',
    'Current State:',
    ...currentStateParts.map((part) => `- ${part}`),
    '',
    'Done:',
    '- Preserved the latest conversation state locally so the next turn can continue.',
    '',
    'Decisions:',
    '- none',
    '',
    'Open Items:',
    `- ${lastUserMessage ? compactText(formatUserMessage(lastUserMessage)) : 'none'}`,
    '',
    'Key Refs:',
    `- ${completedToolNames.length > 0 ? completedToolNames.join(', ') : 'none'}`,
    '',
    'Next Step:',
    '- Continue from the latest user request and recent tool output.',
  ].join('\n')
}

function normalizeCompressionSummary(value: string) {
  const visibleText = value
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think\b[^>]*\/?>/gi, '')
    .trim()
  if (visibleText.length > 0) {
    return visibleText
  }

  return value.replace(/<\/?think\b[^>]*\/?>/gi, '').trim()
}

export async function compressChatHistory(input: CompressChatHistoryInput) {
  const systemPrompt = buildChatCompressionSystemPrompt(input.chatMode, input.agentContextRootPath)
  const transcriptCandidates = buildTranscriptCandidates(input.messages)

  for (const transcriptCandidate of transcriptCandidates) {
    const modelMessages: ModelMessage[] = [
      {
        role: 'user',
        content: `Full conversation transcript:\n\n${transcriptCandidate.transcript}`,
      },
    ]
    const rawSummary = await collectCompressionText(input.createStream, {
      messages: modelMessages,
      model: input.modelId,
      reasoningEffort: input.reasoningEffort,
      system: systemPrompt,
    })
    if (rawSummary === null) {
      break
    }
    const summary = normalizeCompressionSummary(rawSummary)

    if (summary.length === 0) {
      continue
    }

    if (containsCampSections(summary)) {
      return summary
    }

    const rawRepairedSummary = await collectCompressionText(input.createStream, {
      messages: [
        {
          role: 'user',
          content: buildCampRepairPrompt(summary),
        },
      ],
      model: input.modelId,
      reasoningEffort: input.reasoningEffort,
      system: systemPrompt,
    })
    if (rawRepairedSummary === null) {
      return summary
    }
    const repairedSummary = normalizeCompressionSummary(rawRepairedSummary)

    if (repairedSummary.length > 0) {
      return repairedSummary
    }
  }

  return buildFallbackCampSummary(
    input.messages,
    transcriptCandidates.length > 0 ? transcriptCandidates[0].wasTrimmed : false,
  )
}
