import type { ModelMessage } from 'ai'
import type { ChatProviderId, ReasoningEffort } from '../../src/types/chat'
import { parseTouchedFilesFromNumstat } from './serviceHelpers'
import {
  collectIdentifiers,
  collectKeywords,
  collectQuotedPhrases,
  dedupePreservingOrder,
  decorateTopicWithScope,
  deriveCommitScope,
  deriveCommitType,
  deriveSubjectVerb,
  deriveTopicCandidate,
  extractTouchedFilesFromDiff,
  joinReadableList,
  MAX_PROMPT_FILE_COUNT,
  parseNumstatEntries,
  summarizeNumstatForPrompt,
  summarizeTouchedFiles,
  truncateDiffForPrompt,
  truncateSubject,
  type CommitMessagePromptContext,
} from './commitMessageAnalysis'

const MODEL_SYSTEM_PROMPT = [
  'You write production-grade git commit messages from staged diffs.',
  'Stay strictly grounded in the visible diff and metadata.',
  'Do not output markdown fences, analysis, or commentary.',
  'You must exclusively use the English language.',
].join(' ')

interface ActiveModelSelection {
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
}

interface GenerateCommitMessageInput {
  diffText: string
  numstatText: string
  selection: ActiveModelSelection | null
}

export function buildCommitMessagePrompt(input: { diffText: string; numstatText: string }): CommitMessagePromptContext {
  const touchedFiles = dedupePreservingOrder([
    ...parseTouchedFilesFromNumstat(input.numstatText),
    ...extractTouchedFilesFromDiff(input.diffText),
  ])
  const diffSnippet = truncateDiffForPrompt(input.diffText)
  const identifiers = collectIdentifiers(input.diffText)
  const keywords = collectKeywords(input.diffText, touchedFiles)
  const quotedPhrases = collectQuotedPhrases(input.diffText)
  const topFiles = touchedFiles.slice(0, MAX_PROMPT_FILE_COUNT)
  const fileList = topFiles.length > 0 ? topFiles.join('\n') : '(none detected)'
  const numstatList = summarizeNumstatForPrompt(input.numstatText)
  const identifierList = identifiers.length > 0 ? identifiers.join('\n') : '(none detected)'
  const keywordList = keywords.length > 0 ? keywords.join(', ') : '(none detected)'
  const quotedPhraseList = quotedPhrases.length > 0 ? quotedPhrases.join('\n') : '(none detected)'

  const promptText = [
    'Write a git commit message for this staged diff.',
    '',
    'Output format:',
    '1. Line 1 must be a conventional commit subject no longer than 72 characters.',
    '2. Add a blank line.',
    '3. Then write 2-4 bullet points, each starting with "- ".',
    '',
    'Rules:',
    '- Be specific about the dominant behavior, tool, bug, prompt, test, or config change.',
    '- Ground every claim in the provided diff, identifiers, keywords, and numstat.',
    '- Prefer concrete nouns from the diff over file-count summaries.',
    '- Mention tests only when they changed.',
    '- Do not mention AI, prompts, merge requests, review flow, or truncation.',
    '- Do not use generic filler like "update implementation details", "changed modules", "misc fixes", or "various updates".',
    '- Do not repeat the touched-file list as the subject.',
    '',
    'Staged numstat (top changes only):',
    numstatList,
    '',
    'Touched files (top changes only):',
    fileList,
    '',
    'Changed identifiers and test names:',
    identifierList,
    '',
    'High-signal keywords:',
    keywordList,
    '',
    'Useful quoted phrases from changed lines:',
    quotedPhraseList,
    '',
    'Unified diff excerpt:',
    diffSnippet,
  ].join('\n')

  return {
    identifiers,
    keywords,
    promptText,
    quotedPhrases,
    touchedFiles,
  }
}

export function buildHeuristicCommitMessageFromDiff(input: { diffText: string; numstatText: string }) {
  const promptContext = buildCommitMessagePrompt(input)
  const numstatEntries = parseNumstatEntries(input.numstatText)
  const commitType = deriveCommitType({
    diffText: input.diffText,
    numstatEntries,
    touchedFiles: promptContext.touchedFiles,
  })
  const scope = deriveCommitScope(promptContext.touchedFiles)
  const topic = decorateTopicWithScope(
    deriveTopicCandidate(
      {
        identifiers: promptContext.identifiers,
        keywords: promptContext.keywords,
        quotedPhrases: promptContext.quotedPhrases,
        touchedFiles: promptContext.touchedFiles,
      },
      scope,
    ),
    scope,
  )
  const subjectPrefix = scope ? `${commitType}(${scope}): ` : `${commitType}: `
  const subject = truncateSubject(`${subjectPrefix}${deriveSubjectVerb(commitType, input.diffText)} ${topic}`)

  const bulletCandidates = dedupePreservingOrder([
    promptContext.identifiers.length > 0
      ? `Update ${joinReadableList(promptContext.identifiers.slice(0, 2))}.`
      : '',
    promptContext.quotedPhrases.length > 0
      ? `Capture ${joinReadableList(promptContext.quotedPhrases.slice(0, 2))}.`
      : '',
    promptContext.touchedFiles.length > 0 ? `Touch ${summarizeTouchedFiles(promptContext.touchedFiles)}.` : '',
    promptContext.touchedFiles.some((filePath) => /(^|\/)(test|tests|__tests__)(\/|$)|\.test\./iu.test(filePath))
      ? `Refresh tests covering ${topic}.`
      : '',
    promptContext.touchedFiles.some((filePath) => /(^|\/)(docs?|readme)(\/|\.|$)/iu.test(filePath) || /\.md$/iu.test(filePath))
      ? `Refresh docs related to ${topic}.`
      : '',
  ]).filter((line) => line.length > 0)

  const bodyLines = (bulletCandidates.length > 0 ? bulletCandidates : ['Update the staged repository changes.'])
    .slice(0, 4)
    .map((line) => `- ${line}`)

  return `${subject}\n\n${bodyLines.join('\n')}`
}

async function readCommitMessageFromStream(stream: { fullStream: AsyncIterable<{ [key: string]: unknown; type: string }> }) {
  let generatedText = ''

  for await (const part of stream.fullStream) {
    if (part.type === 'text-delta' && typeof part.text === 'string') {
      generatedText += part.text
    }
  }

  return generatedText.trim()
}

async function generateCommitMessageWithModel(promptText: string, selection: ActiveModelSelection) {
  const messages: ModelMessage[] = [
    {
      content: promptText,
      role: 'user',
    },
  ]

  if (selection.providerId === 'codex') {
    const { createCodexClient } = await import('../chat/codex/client')
    const client = createCodexClient()
    const stream = await client.chat.completions.create({
      messages,
      model: selection.modelId,
      reasoningEffort: selection.reasoningEffort,
      system: MODEL_SYSTEM_PROMPT,
    })

    return readCommitMessageFromStream(stream)
  }

  const { readApiKeyChatProviderConfig } = await import('../chat/apiKey/config')
  const { createApiKeyChatClient } = await import('../chat/apiKey/client')
  const providerConfig = await readApiKeyChatProviderConfig(selection.providerId)
  const client = createApiKeyChatClient(providerConfig)
  const stream = await client.chat.completions.create({
    messages,
    model: selection.modelId,
    reasoningEffort: selection.reasoningEffort,
    system: MODEL_SYSTEM_PROMPT,
  })

  return readCommitMessageFromStream(stream)
}

export async function generateCommitMessageFromDiff(input: GenerateCommitMessageInput) {
  const promptContext = buildCommitMessagePrompt({
    diffText: input.diffText,
    numstatText: input.numstatText,
  })

  if (input.selection) {
    try {
      const generatedMessage = await generateCommitMessageWithModel(promptContext.promptText, input.selection)
      if (generatedMessage.length > 0) {
        return generatedMessage
      }
    } catch {
      // Fall back to a local summary when model generation is unavailable or misconfigured.
    }
  }

  return buildHeuristicCommitMessageFromDiff({
    diffText: input.diffText,
    numstatText: input.numstatText,
  })
}
