import { File, Folder, Paperclip, Plug, Wand2 } from 'lucide-react'
import type { McpState } from '../../types/mcp'
import type { ChatAttachment } from '../../types/chat'

export type ChatMentionMenuType = 'file' | 'folder' | 'attachment' | 'skill' | 'mcp'

export interface ChatMentionMenuItem {
  description: string
  kind: ChatMentionMenuType
  label: string
  relativePath: string
  isDirectory?: boolean
}

export const CHAT_MENTION_CATEGORIES: readonly {
  description: string
  icon: typeof File
  kind: ChatMentionMenuType
  label: string
}[] = [
  {
    description: 'Search for files',
    icon: File,
    kind: 'file',
    label: 'File',
  },
  {
    description: 'Search for folders',
    icon: Folder,
    kind: 'folder',
    label: 'Folder',
  },
  {
    description: 'Mention files attached to this chat',
    icon: Paperclip,
    kind: 'attachment',
    label: 'Attachments',
  },
  {
    description: 'Search for skills',
    icon: Wand2,
    kind: 'skill',
    label: 'Skills',
  },
  {
    description: 'Search for MCP servers',
    icon: Plug,
    kind: 'mcp',
    label: 'MCP',
  },
]

export function getMcpMentionEntries(state: McpState): ChatMentionMenuItem[] {
  return state.configs.filter((server) =>
    server.enabled && state.statuses[server.id]?.status === 'connected',
  ).map((server) => ({
    description: server.description || 'MCP server',
    kind: 'mcp',
    label: server.name,
    relativePath: `tools.available.search:${server.name}`,
  }))
}

export function getAttachmentMentionEntries(
  attachments: readonly (Pick<ChatAttachment, 'fileName' | 'kind'> & { path?: string })[],
): ChatMentionMenuItem[] {
  const entries = new Map<string, ChatMentionMenuItem>()
  for (const attachment of attachments) {
    if (!attachment.path) {
      continue
    }
    entries.set(attachment.path, {
      description: attachment.path,
      isDirectory: attachment.kind === 'folder',
      kind: 'attachment',
      label: attachment.fileName,
      relativePath: attachment.path,
    })
  }
  return [...entries.values()]
}

export function getChatMentionCategories(hasAttachments: boolean, hasConnectedMcp: boolean) {
  return CHAT_MENTION_CATEGORIES.filter((category) => {
    if (category.kind === 'attachment') {
      return hasAttachments
    }
    if (category.kind === 'mcp') {
      return hasConnectedMcp
    }
    return true
  })
}
