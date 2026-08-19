import type { GitModelSelection } from './modelTextGeneration'
import { normalizeGeneratedCommitMessageWithDescription } from './commitMessageFormatting'
import { generateCommitMessageFromDiff } from './commitMessageGenerator'
import {
  readStagedDiffText,
  readStagedNumstatText,
} from './repositoryContext'
import { parseTouchedFilesFromNumstat } from './serviceHelpers'

export interface GenerateStagedCommitMessageInput {
  repoRootPath: string
  selection: GitModelSelection | null
}

export interface GeneratedStagedCommitMessage {
  diffText: string
  message: string
  numstatText: string
  touchedFiles: string[]
}

export async function generateStagedCommitMessage(
  input: GenerateStagedCommitMessageInput,
): Promise<GeneratedStagedCommitMessage> {
  const [diffText, numstatText] = await Promise.all([
    readStagedDiffText(input.repoRootPath),
    readStagedNumstatText(input.repoRootPath),
  ])
  const touchedFiles = parseTouchedFilesFromNumstat(numstatText)
  const generatedMessage = await generateCommitMessageFromDiff({
    diffText,
    numstatText,
    selection: input.selection,
  })

  return {
    diffText,
    message: normalizeGeneratedCommitMessageWithDescription(generatedMessage, touchedFiles),
    numstatText,
    touchedFiles,
  }
}
