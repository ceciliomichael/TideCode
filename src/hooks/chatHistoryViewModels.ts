import type { AppLanguage } from '../lib/appSettings'
import { getChatAttachmentSummary } from '../lib/chatAttachments'
import { getConversationPreviewContent } from '../lib/chatMessageMetadata'
import type {
  ChatAttachment,
  FolderMoveDirection,
  ConversationFolderSummary,
  ConversationGroupPreview,
  ConversationPreview,
  ReorderConversationFolderInput,
  ConversationRecord,
  ConversationSummary,
} from '../types/chat'

const relativeTimeFormatterCache = new Map<AppLanguage, Intl.RelativeTimeFormat>()
const shortDateFormatterCache = new Map<AppLanguage, Intl.DateTimeFormat>()

export const UNFILED_FOLDER_NAME = 'Unfiled'

function getRelativeTimeFormatter(language: AppLanguage) {
  const cachedFormatter = relativeTimeFormatterCache.get(language)
  if (cachedFormatter) {
    return cachedFormatter
  }

  const nextFormatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  relativeTimeFormatterCache.set(language, nextFormatter)
  return nextFormatter
}

function getShortDateFormatter(language: AppLanguage) {
  const cachedFormatter = shortDateFormatterCache.get(language)
  if (cachedFormatter) {
    return cachedFormatter
  }

  const nextFormatter = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' })
  shortDateFormatterCache.set(language, nextFormatter)
  return nextFormatter
}

export function getSelectedFolderName(
  folderSummaries: ConversationFolderSummary[],
  selectedFolderId: string | null,
) {
  if (selectedFolderId === null) {
    return UNFILED_FOLDER_NAME
  }

  return folderSummaries.find((folder) => folder.id === selectedFolderId)?.name ?? UNFILED_FOLDER_NAME
}

function normalizeFolderPath(folderPath: string) {
  return folderPath.trim().replace(/\\/g, '/')
}

export function getFolderIdForWorkspacePath(
  folderSummaries: ConversationFolderSummary[],
  workspacePath: string | null,
) {
  const normalizedWorkspacePath = workspacePath ? normalizeFolderPath(workspacePath) : ''
  if (normalizedWorkspacePath.length === 0) {
    return null
  }

  const matchedFolder = folderSummaries.find(
    (folder) =>
      normalizeFolderPath(folder.path).localeCompare(normalizedWorkspacePath, undefined, {
        sensitivity: 'base',
      }) === 0,
  )

  return matchedFolder?.id ?? null
}

function formatUpdatedAtLabel(timestamp: number, language: AppLanguage) {
  const relativeTimeFormatter = getRelativeTimeFormatter(language)
  const differenceMs = timestamp - Date.now()
  const differenceMinutes = Math.round(differenceMs / 60000)

  if (Math.abs(differenceMinutes) < 1) {
    return relativeTimeFormatter.format(0, 'minute')
  }

  if (Math.abs(differenceMinutes) < 60) {
    return relativeTimeFormatter.format(differenceMinutes, 'minute')
  }

  const differenceHours = Math.round(differenceMinutes / 60)
  if (Math.abs(differenceHours) < 24) {
    return relativeTimeFormatter.format(differenceHours, 'hour')
  }

  const differenceDays = Math.round(differenceHours / 24)
  if (Math.abs(differenceDays) < 7) {
    return relativeTimeFormatter.format(differenceDays, 'day')
  }

  return getShortDateFormatter(language).format(timestamp)
}

export function getConversationTitle(seed: string) {
  const normalized = seed.trim().replace(/\s+/g, ' ')
  if (normalized.length === 0) {
    return 'New chat'
  }

  const conciseTitle = normalized.split(' ').slice(0, 7).join(' ')
  return conciseTitle.length > 48 ? `${conciseTitle.slice(0, 45)}...` : conciseTitle
}

export function getConversationTitleFromInput(seed: string, attachments: readonly ChatAttachment[]) {
  const normalized = seed.trim().replace(/\s+/g, ' ')
  if (normalized.length > 0) {
    return getConversationTitle(normalized)
  }

  const attachmentSummary = getChatAttachmentSummary(attachments)
  if (!attachmentSummary) {
    return 'New chat'
  }

  const prefixedTitle = `Attached ${attachmentSummary}`
  return prefixedTitle.length > 48 ? `${prefixedTitle.slice(0, 45)}...` : prefixedTitle
}

function mapConversationPreview(
  summary: ConversationSummary,
  activeConversationId: string | null,
  runningConversationIds: ReadonlySet<string>,
  language: AppLanguage,
): ConversationPreview {
  return {
    hasRunningTask: runningConversationIds.has(summary.id),
    id: summary.id,
    title: summary.title,
    preview: summary.preview,
    updatedAtLabel: formatUpdatedAtLabel(summary.updatedAt, language),
    folderId: summary.folderId,
    isActive: summary.id === activeConversationId,
  }
}

export function buildConversationGroups(
  folderSummaries: ConversationFolderSummary[],
  conversationSummaries: ConversationSummary[],
  activeConversationId: string | null,
  selectedFolderId: string | null,
  runningConversationIds: ReadonlySet<string>,
  language: AppLanguage,
): ConversationGroupPreview[] {
  const groupedConversations = new Map<string | null, ConversationPreview[]>()
  groupedConversations.set(null, [])

  for (const folder of folderSummaries) {
    groupedConversations.set(folder.id, [])
  }

  for (const conversation of conversationSummaries) {
    const preview = mapConversationPreview(conversation, activeConversationId, runningConversationIds, language)
    const targetFolderId =
      conversation.folderId !== null && groupedConversations.has(conversation.folderId) ? conversation.folderId : null

    groupedConversations.get(targetFolderId)?.push(preview)
  }

  return [
    {
      folder: {
        id: null,
        name: UNFILED_FOLDER_NAME,
        path: null,
        conversationCount: groupedConversations.get(null)?.length ?? 0,
        isSelected: selectedFolderId === null,
      },
      conversations: groupedConversations.get(null) ?? [],
    },
    ...folderSummaries.map((folder) => ({
      folder: {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        conversationCount: groupedConversations.get(folder.id)?.length ?? 0,
        isSelected: selectedFolderId === folder.id,
      },
      conversations: groupedConversations.get(folder.id) ?? [],
    })),
  ]
}

export function buildConversationSummary(conversation: ConversationRecord): ConversationSummary {
  return {
    agentContextRootPath: conversation.agentContextRootPath,
    chatMode: conversation.chatMode,
    id: conversation.id,
    title: conversation.title,
    preview: getConversationPreviewContent(conversation.messages),
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    folderId: conversation.folderId,
  }
}

export function upsertConversationSummary(
  conversationSummaries: ConversationSummary[],
  conversation: ConversationRecord,
) {
  const nextSummary = buildConversationSummary(conversation)

  return [nextSummary, ...conversationSummaries.filter((summary) => summary.id !== conversation.id)].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )
}

export function removeConversationSummary(
  conversationSummaries: ConversationSummary[],
  conversationId: string,
) {
  return conversationSummaries.filter((summary) => summary.id !== conversationId)
}

export function insertFolderSummary(
  folderSummaries: ConversationFolderSummary[],
  nextFolder: ConversationFolderSummary,
) {
  return [nextFolder, ...folderSummaries]
}

export function moveFolderSummary(
  folderSummaries: ConversationFolderSummary[],
  folderId: string,
  direction: FolderMoveDirection,
) {
  const currentIndex = folderSummaries.findIndex((folder) => folder.id === folderId)
  if (currentIndex < 0) {
    return folderSummaries
  }

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (targetIndex < 0 || targetIndex >= folderSummaries.length) {
    return folderSummaries
  }

  const nextFolders = [...folderSummaries]
  const [movedFolder] = nextFolders.splice(currentIndex, 1)
  nextFolders.splice(targetIndex, 0, movedFolder)
  return nextFolders
}

export function reorderFolderSummary(
  folderSummaries: ConversationFolderSummary[],
  input: ReorderConversationFolderInput,
) {
  const { folderId, position, targetFolderId } = input
  if (folderId === targetFolderId) {
    return folderSummaries
  }

  const currentIndex = folderSummaries.findIndex((folder) => folder.id === folderId)
  const targetIndex = folderSummaries.findIndex((folder) => folder.id === targetFolderId)
  if (currentIndex < 0 || targetIndex < 0) {
    return folderSummaries
  }

  const nextFolders = [...folderSummaries]
  const [movedFolder] = nextFolders.splice(currentIndex, 1)
  const nextTargetIndex = nextFolders.findIndex((folder) => folder.id === targetFolderId)
  if (nextTargetIndex < 0) {
    return folderSummaries
  }

  const insertIndex = position === 'after' ? nextTargetIndex + 1 : nextTargetIndex
  nextFolders.splice(insertIndex, 0, movedFolder)
  return nextFolders
}
