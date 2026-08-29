import {
  buildChatMentionPathMap,
  collapseChatMentionMarkup,
  restoreChatMentionPathMap,
} from './chatMentions'

export interface RestoredChatComposerDraft {
  mentionPathMap: Map<string, string>
  value: string
}

/**
 * Converts persisted/send-ready mention markup back into the composer format.
 * The visible composer uses @labels, while the send pipeline expands those
 * labels back to [[action:path]] using the returned path map.
 */
export function restoreChatComposerDraft(
  content: string,
  persistedMentionPathMap?: Readonly<Record<string, string>>,
): RestoredChatComposerDraft {
  const mentionPathMap = persistedMentionPathMap
    ? restoreChatMentionPathMap(persistedMentionPathMap)
    : buildChatMentionPathMap(content)

  return {
    mentionPathMap,
    value: collapseChatMentionMarkup(content, mentionPathMap),
  }
}
