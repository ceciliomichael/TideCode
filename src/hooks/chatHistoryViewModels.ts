import type { AppLanguage } from '../lib/appSettings'
import { getChatAttachmentSummary } from '../lib/chatAttachments'
import { getConversationPreviewContent } from '../lib/chatMessageMetadata'
import { collapseChatMentionMarkup } from '../lib/chatMentions'
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

export const CHATS_FOLDER_NAME = 'Chats'

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
    return CHATS_FOLDER_NAME
  }

  return folderSummaries.find((folder) => folder.id === selectedFolderId)?.name ?? CHATS_FOLDER_NAME
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
  const collapsed = collapseChatMentionMarkup(seed)
  const normalized = collapsed.trim().replace(/\s+/g, ' ')
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
  familySize: number,
  latestCompactionSequence: number,
): ConversationPreview {
  const hasCompactionFamily = familySize > 1 || summary.compaction !== undefined

  return {
    ...(summary.compaction ? { compaction: summary.compaction } : {}),
    ...(hasCompactionFamily
      ? { compactionLabel: summary.compaction ? `Compact ${summary.compaction.sequence}` : 'Original' }
      : {}),
    hasRunningTask: runningConversationIds.has(summary.id),
    hasCompactionFamily,
    id: summary.id,
    isLatestCompaction:
      summary.compaction !== undefined &&
      summary.compaction.sequence === latestCompactionSequence,
    title: summary.title,
    preview: summary.preview,
    updatedAt: summary.updatedAt,
    updatedAtLabel: formatUpdatedAtLabel(summary.updatedAt, language),
    folderId: summary.folderId,
    isArchived: summary.isArchived,
    isActive: summary.id === activeConversationId,
    isPinned: summary.isArchived ? false : summary.isPinned,
  }
}

export const PINNED_FOLDER_ID = 'pinned'
export const ARCHIVED_FOLDER_ID = 'archived'

function getCompactionRootId(summary: ConversationSummary) {
  return summary.compaction?.rootConversationId ?? summary.id
}

function buildCompactionFamilyStats(conversationSummaries: readonly ConversationSummary[]) {
  const familyStats = new Map<string, { latestSequence: number; size: number }>()

  for (const summary of conversationSummaries) {
    const rootConversationId = getCompactionRootId(summary)
    const currentStats = familyStats.get(rootConversationId) ?? {
      latestSequence: 0,
      size: 0,
    }
    familyStats.set(rootConversationId, {
      latestSequence: Math.max(currentStats.latestSequence, summary.compaction?.sequence ?? 0),
      size: currentStats.size + 1,
    })
  }

  return familyStats
}

export function orderConversationFamilies(conversationSummaries: readonly ConversationSummary[]) {
  const families = new Map<string, ConversationSummary[]>()
  for (const summary of conversationSummaries) {
    const rootConversationId = getCompactionRootId(summary)
    const family = families.get(rootConversationId) ?? []
    family.push(summary)
    families.set(rootConversationId, family)
  }

  return [...families.values()]
    .sort((leftFamily, rightFamily) => {
      const leftUpdatedAt = Math.max(...leftFamily.map((summary) => summary.updatedAt))
      const rightUpdatedAt = Math.max(...rightFamily.map((summary) => summary.updatedAt))
      return rightUpdatedAt - leftUpdatedAt
    })
    .flatMap((family) =>
      [...family].sort((left, right) => {
        const leftSequence = left.compaction?.sequence ?? 0
        const rightSequence = right.compaction?.sequence ?? 0
        return leftSequence - rightSequence || left.updatedAt - right.updatedAt
      }),
    )
}

export function buildConversationGroups(
  folderSummaries: ConversationFolderSummary[],
  conversationSummaries: ConversationSummary[],
  activeConversationId: string | null,
  selectedFolderId: string | null,
  runningConversationIds: ReadonlySet<string>,
  language: AppLanguage,
): ConversationGroupPreview[] {
  const groupedSummaries = new Map<string | null, ConversationSummary[]>()
  const familyStats = buildCompactionFamilyStats(conversationSummaries)
  groupedSummaries.set(null, [])
  const pinnedSummaries: ConversationSummary[] = []
  const archivedSummaries: ConversationSummary[] = []

  for (const folder of folderSummaries) {
    groupedSummaries.set(folder.id, [])
  }

  const activeConversationIsPinned =
    activeConversationId !== null &&
    conversationSummaries.find((c) => c.id === activeConversationId)?.isPinned === true

  for (const conversation of conversationSummaries) {
    if (conversation.isArchived) {
      archivedSummaries.push(conversation)
    } else if (conversation.isPinned) {
      pinnedSummaries.push(conversation)
    } else {
      const targetFolderId =
        conversation.folderId !== null && groupedSummaries.has(conversation.folderId) ? conversation.folderId : null

      groupedSummaries.get(targetFolderId)?.push(conversation)
    }
  }

  const mapSummaries = (summaries: readonly ConversationSummary[]) =>
    orderConversationFamilies(summaries).map((summary) => {
      const stats = familyStats.get(getCompactionRootId(summary)) ?? {
        latestSequence: 0,
        size: 1,
      }
      return mapConversationPreview(
        summary,
        activeConversationId,
        runningConversationIds,
        language,
        stats.size,
        stats.latestSequence,
      )
    })
  const pinnedConversations = mapSummaries(pinnedSummaries)
  const archivedConversations = mapSummaries(archivedSummaries)

  const pinnedGroup = {
    folder: {
      id: PINNED_FOLDER_ID,
      name: 'Pinned',
      path: null,
      conversationCount: pinnedConversations.length,
      isSelected: selectedFolderId === PINNED_FOLDER_ID || activeConversationIsPinned,
    },
    conversations: pinnedConversations,
  }

  const chatsGroup = {
    folder: {
      id: null,
      name: CHATS_FOLDER_NAME,
      path: null,
      conversationCount: groupedSummaries.get(null)?.length ?? 0,
      isSelected: selectedFolderId === null && !activeConversationIsPinned,
    },
    conversations: mapSummaries(groupedSummaries.get(null) ?? []),
  }

  const archivedGroup = {
    folder: {
      id: ARCHIVED_FOLDER_ID,
      name: 'Archived',
      path: null,
      conversationCount: archivedConversations.length,
      isSelected: selectedFolderId === ARCHIVED_FOLDER_ID,
    },
    conversations: archivedConversations,
  }

  const folderGroups = folderSummaries.map((folder) => ({
    folder: {
      id: folder.id,
      name: folder.name,
      path: folder.path,
      conversationCount: groupedSummaries.get(folder.id)?.length ?? 0,
      isSelected: selectedFolderId === folder.id && !activeConversationIsPinned,
    },
    conversations: mapSummaries(groupedSummaries.get(folder.id) ?? []),
  }))

  const groups = []
  
  if (pinnedConversations.length > 0) {
    groups.push(pinnedGroup)
  }

  // Push project folders first, then the Chats group at the bottom
  groups.push(...folderGroups)
  groups.push(chatsGroup)
  if (archivedConversations.length > 0) {
    groups.push(archivedGroup)
  }

  return groups
}

export function buildConversationSummary(conversation: ConversationRecord): ConversationSummary {
  return {
    agentContextRootPath: conversation.agentContextRootPath,
    chatMode: conversation.chatMode,
    ...(conversation.compaction ? { compaction: conversation.compaction } : {}),
    id: conversation.id,
    title: conversation.title,
    preview: getConversationPreviewContent(conversation.messages),
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    folderId: conversation.folderId,
    isArchived: conversation.isArchived,
    isPinned: conversation.isArchived ? false : conversation.isPinned,
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
  const existingIndex = folderSummaries.findIndex((folder) => folder.id === nextFolder.id)
  if (existingIndex < 0) return [...folderSummaries, nextFolder]

  const nextFolders = [...folderSummaries]
  nextFolders[existingIndex] = nextFolder
  return nextFolders
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
