import { statSync } from 'node:fs'
import path from 'node:path'
import type { ModelMessage } from 'ai'
import {
  buildWorkspaceInstructionsHiddenContext,
  extractHiddenUserContexts,
  WORKSPACE_INSTRUCTIONS_REVISION_CHANGED_PROMPT,
} from '../../../../src/lib/hiddenUserContext'

const WORKSPACE_INSTRUCTIONS_REPO_PATH = 'AGENTS.md'
export const WORKSPACE_INSTRUCTIONS_HIDDEN_CONTEXT_KIND = 'workspace_instructions'

const WORKSPACE_INSTRUCTIONS_CONTEXT_PATTERN =
  /<hidden_user_context\b(?=[^>]*\bkind="workspace_instructions")[^>]*>[\s\S]*?<\/hidden_user_context>/gu

export function buildWorkspaceInstructionsRuntimeBlock() {
  return [
    '<workspace_instruction_context>',
    `- When root \`${WORKSPACE_INSTRUCTIONS_REPO_PATH}\` exists, the runtime supplies a revision-aware hidden bootstrap context for its repository instructions.`,
    `- The bootstrap does not contain the file contents. Read the current \`${WORKSPACE_INSTRUCTIONS_REPO_PATH}\` only when that exact revision has not already been read into the model context. If the same revision is already available from earlier history or tool output, reuse it and do not read it again.`,
    `- If the bootstrap revision changes, read the updated \`${WORKSPACE_INSTRUCTIONS_REPO_PATH}\` before project work.`,
    '- If no workspace-instructions bootstrap is present, continue without attempting that bootstrap read.',
    '</workspace_instruction_context>',
  ].join('\n')
}

function stripWorkspaceInstructionsContext(value: string) {
  return value
    .replace(WORKSPACE_INSTRUCTIONS_CONTEXT_PATTERN, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function stripWorkspaceInstructionsFromMessages(messages: readonly ModelMessage[]) {
  return messages.map((message): ModelMessage => {
    if (message.role !== 'user') return message
    if (typeof message.content === 'string') {
      return { ...message, content: stripWorkspaceInstructionsContext(message.content) }
    }
    return {
      ...message,
      content: message.content
        .map((part) => part.type === 'text'
          ? { ...part, text: stripWorkspaceInstructionsContext(part.text) }
          : part)
        .filter((part) => part.type !== 'text' || part.text.length > 0),
    }
  })
}

function getWorkspaceInstructionsContexts(messages: readonly ModelMessage[]) {
  return messages.flatMap((message, messageIndex) => {
    if (message.role !== 'user') return []
    const textParts = typeof message.content === 'string'
      ? [message.content]
      : message.content
        .filter((part): part is { text: string; type: 'text' } => part.type === 'text')
        .map((part) => part.text)

    return textParts.flatMap((text) => extractHiddenUserContexts(text)
      .filter((context) => context.kind === WORKSPACE_INSTRUCTIONS_HIDDEN_CONTEXT_KIND)
      .map((context) => ({ context, messageIndex })))
  })
}

function isWorkspaceInstructionsRevisionChanged(
  messages: readonly ModelMessage[],
  revision: string,
) {
  const contexts = getWorkspaceInstructionsContexts(messages)
  const latest = contexts.at(-1)
  if (!latest) return false
  if (latest.context.state !== revision) return true

  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user')
  if (latest.messageIndex !== latestUserIndex) return false

  const previous = contexts.at(-2)
  return previous !== undefined
    && previous.context.state !== latest.context.state
    && !latest.context.content.includes(WORKSPACE_INSTRUCTIONS_REVISION_CHANGED_PROMPT)
}

export function applyWorkspaceInstructionsContext(
  messages: readonly ModelMessage[],
  workspaceRootPath: string | null,
): ModelMessage[] {
  const projectedMessages = stripWorkspaceInstructionsFromMessages(messages)
  if (!workspaceRootPath) return projectedMessages

  let revision: string
  try {
    const fileStats = statSync(path.join(workspaceRootPath, WORKSPACE_INSTRUCTIONS_REPO_PATH))
    if (!fileStats.isFile()) return projectedMessages
    revision = `${fileStats.mtimeMs}:${fileStats.size}`
  } catch {
    return projectedMessages
  }

  const hiddenContext = buildWorkspaceInstructionsHiddenContext(revision, {
    revisionChanged: isWorkspaceInstructionsRevisionChanged(messages, revision),
  }).content
  const targetIndex = projectedMessages.findLastIndex((message) => message.role === 'user')
  if (targetIndex < 0) {
    return [...projectedMessages, { role: 'user', content: hiddenContext }]
  }

  return projectedMessages.map((message, index): ModelMessage => {
    if (index !== targetIndex || message.role !== 'user') return message
    if (typeof message.content === 'string') {
      return {
        ...message,
        content: [message.content.trim(), hiddenContext].filter(Boolean).join('\n\n'),
      }
    }
    return {
      ...message,
      content: [...message.content, { type: 'text', text: hiddenContext }],
    }
  })
}
