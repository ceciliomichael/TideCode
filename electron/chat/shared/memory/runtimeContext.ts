import type { ModelMessage } from 'ai'
import {
  buildWorkspaceDurableMemoryHiddenContext,
  buildWorkspaceMemoryHiddenContext,
  extractHiddenUserContexts,
  WORKSPACE_DURABLE_MEMORY_HIDDEN_CONTEXT_KIND,
  WORKSPACE_MEMORY_HIDDEN_CONTEXT_KIND,
} from '../../../../src/lib/hiddenUserContext'
import {
  refreshWorkspaceMemoryIndex,
  readWorkspaceDurableMemory,
} from '../../../memory/service'

const MEMORY_CONTEXT_KINDS = new Set([
  WORKSPACE_DURABLE_MEMORY_HIDDEN_CONTEXT_KIND,
  WORKSPACE_MEMORY_HIDDEN_CONTEXT_KIND,
])

function getMessageText(message: ModelMessage) {
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((part): part is typeof part & { text: string; type: 'text' } => (
      typeof part === 'object'
      && part !== null
      && part.type === 'text'
      && typeof part.text === 'string'
    ))
    .map((part) => part.text)
    .join('\n')
}

function stripWorkspaceMemoryContexts(value: string) {
  let next = value
  for (const context of extractHiddenUserContexts(value)) {
    if (MEMORY_CONTEXT_KINDS.has(context.kind)) {
      next = next.replace(context.content, '')
    }
  }
  return next.replace(/\n{3,}/gu, '\n\n').trim()
}

function stripWorkspaceMemoryContextsFromMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message): ModelMessage[] => {
    if (
      message.role === 'assistant'
      && typeof message.content === 'string'
      && message.content.startsWith('## Durable conversation memory\n')
    ) {
      return []
    }
    if (message.role !== 'user') return [message]
    if (typeof message.content === 'string') {
      return [{ ...message, content: stripWorkspaceMemoryContexts(message.content) }]
    }
    return [{
      ...message,
      content: message.content
        .map((part) => part.type === 'text'
          ? { ...part, text: stripWorkspaceMemoryContexts(part.text) }
          : part)
        .filter((part) => part.type !== 'text' || part.text.length > 0),
    }]
  })
}

export async function applyWorkspaceMemoryContext(
  messages: readonly ModelMessage[],
  workspaceRootPath: string | null,
  optionalMemoryEnabled: boolean,
): Promise<ModelMessage[]> {
  const projected = stripWorkspaceMemoryContextsFromMessages(messages)
  if (!workspaceRootPath) return projected

  const [durable, memory] = await Promise.all([
    readWorkspaceDurableMemory(workspaceRootPath),
    optionalMemoryEnabled ? refreshWorkspaceMemoryIndex(workspaceRootPath) : Promise.resolve(null),
  ])

  const contexts = [
    ...(durable
      ? [buildWorkspaceDurableMemoryHiddenContext(durable.revision, durable.content)]
      : []),
    buildWorkspaceMemoryHiddenContext({
      content: memory?.content ?? null,
      enabled: optionalMemoryEnabled,
      revision: memory?.revision ?? null,
    }),
  ]

  const hiddenContent = contexts.map((context) => context.content).join('\n\n')
  const targetIndex = projected.findLastIndex((message) => message.role === 'user')
  if (targetIndex < 0) {
    return [...projected, { role: 'user', content: hiddenContent }]
  }

  return projected.map((message, index): ModelMessage => {
    if (index !== targetIndex || message.role !== 'user') return message
    if (typeof message.content === 'string') {
      return {
        ...message,
        content: [message.content.trim(), hiddenContent].filter(Boolean).join('\n\n'),
      }
    }
    return {
      ...message,
      content: [...message.content, { type: 'text', text: hiddenContent }],
    }
  })
}

export function hasWorkspaceMemoryContext(messages: readonly ModelMessage[]) {
  return messages.some((message) => (
    message.role === 'user'
    && extractHiddenUserContexts(getMessageText(message))
      .some((context) => MEMORY_CONTEXT_KINDS.has(context.kind))
  ))
}
