import { splitThinkingContent } from '../../src/lib/chatMessageContent'
import { summarizeNumstatForPrompt, truncateDiffForPrompt } from './commitMessageAnalysis'
import { generateGitModelText, type GitModelSelection } from './modelTextGeneration'
import { getCommitMessageBody, getCommitMessageSubject } from './serviceHelpers'

const MODEL_SYSTEM_PROMPT = [
  'You write production-grade GitHub pull request titles and descriptions from repository changes.',
  'Stay strictly grounded in the provided branch diff, commit list, and file statistics.',
  'Do not invent tests, commands, issue IDs, reviewers, deployment status, or behavior not visible in the input.',
  'Do not mention AI, prompts, or model generation.',
  'Use English only.',
].join(' ')

const MAX_PR_TITLE_LENGTH = 100
const MAX_PR_BODY_LENGTH = 6_000

export interface PullRequestMessageContext {
  commitLogText: string
  diffText: string
  numstatText: string
}

export interface PullRequestDetails {
  body: string
  title: string
}

export interface GeneratePullRequestDetailsInput extends PullRequestMessageContext {
  fallbackCommitMessage: string
  selection: GitModelSelection | null
}

function stripResponseWrappers(rawText: string) {
  return splitThinkingContent(rawText).content
    .replace(/^\x60\x60\x60(?:markdown|md|text)?\s*$/gimu, '')
    .replace(/^\x60\x60\x60\s*$/gmu, '')
    .trim()
}

function normalizeTitle(rawTitle: string) {
  const normalized = rawTitle
    .replace(/^TITLE\s*:\s*/iu, '')
    .replace(/^[-*#>\s]+/u, '')
    .replace(/^["'\x60]+|["'\x60]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()

  if (normalized.length <= MAX_PR_TITLE_LENGTH) {
    return normalized
  }

  const clipped = normalized.slice(0, MAX_PR_TITLE_LENGTH)
  const lastWhitespaceIndex = clipped.lastIndexOf(' ')
  return (lastWhitespaceIndex >= 30 ? clipped.slice(0, lastWhitespaceIndex) : clipped).trim()
}

export function normalizeGeneratedPullRequestDetails(
  rawText: string,
  fallbackCommitMessage: string,
): PullRequestDetails {
  const fallbackTitle = getCommitMessageSubject(fallbackCommitMessage)
  const fallbackBody = getCommitMessageBody(fallbackCommitMessage)
  const cleanedText = stripResponseWrappers(rawText)
  if (cleanedText.length === 0) {
    return { body: fallbackBody, title: fallbackTitle }
  }

  const lines = cleanedText.split(/\r?\n/u)
  const titleLineIndex = lines.findIndex((line) => /^TITLE\s*:/iu.test(line.trim()))
  const bodyLineIndex = lines.findIndex((line) => /^BODY\s*:\s*$/iu.test(line.trim()))
  const rawTitle = titleLineIndex >= 0
    ? lines[titleLineIndex]
    : lines.find((line) => line.trim().length > 0) ?? ''
  const title = normalizeTitle(rawTitle) || fallbackTitle

  let body = ''
  if (bodyLineIndex >= 0) {
    body = lines.slice(bodyLineIndex + 1).join('\n').trim()
  } else {
    const firstContentLineIndex = titleLineIndex >= 0
      ? titleLineIndex
      : lines.findIndex((line) => line.trim().length > 0)
    body = firstContentLineIndex >= 0 ? lines.slice(firstContentLineIndex + 1).join('\n').trim() : ''
  }

  if (body.length === 0) {
    body = fallbackBody
  } else if (body.length > MAX_PR_BODY_LENGTH) {
    body = body.slice(0, MAX_PR_BODY_LENGTH).trimEnd()
  }

  return { body, title }
}

export function buildPullRequestMessagePrompt(input: PullRequestMessageContext) {
  const commitLog = input.commitLogText.trim() || '(no commit summaries available)'
  const numstat = summarizeNumstatForPrompt(input.numstatText)
  const diffSnippet = truncateDiffForPrompt(input.diffText)

  return [
    'Write the title and body for a GitHub pull request covering the full branch change set.',
    '',
    'Return exactly this structure:',
    'TITLE: <concise title, at most 72 characters>',
    'BODY:',
    '## Summary',
    '- <specific change>',
    '- <specific change>',
    '',
    'Optionally add a ## Testing section only when test files or test behavior are visible in the input.',
    '',
    'Rules:',
    '- Summarize the complete branch diff, not only the newest commit.',
    '- Prefer concrete behavior and identifiers over file-count summaries.',
    '- Keep the body concise and useful to a reviewer.',
    '- Do not claim that tests were run unless the input explicitly proves that.',
    '- Do not add issue links, rollout notes, or compatibility claims unless present in the input.',
    '',
    'Branch commits:',
    commitLog,
    '',
    'Changed-file numstat:',
    numstat,
    '',
    'Branch diff excerpt:',
    diffSnippet,
  ].join('\n')
}

export async function generatePullRequestDetails(
  input: GeneratePullRequestDetailsInput,
): Promise<PullRequestDetails> {
  const fallbackDetails = normalizeGeneratedPullRequestDetails('', input.fallbackCommitMessage)
  if (!input.selection) {
    return fallbackDetails
  }

  try {
    const generatedText = await generateGitModelText({
      promptText: buildPullRequestMessagePrompt(input),
      selection: input.selection,
      systemPrompt: MODEL_SYSTEM_PROMPT,
    })
    return normalizeGeneratedPullRequestDetails(generatedText, input.fallbackCommitMessage)
  } catch {
    return fallbackDetails
  }
}
