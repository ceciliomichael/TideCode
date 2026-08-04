export interface MutableChatSelectionRef {
  current: string | null
}

export interface ChatSelectionRefs {
  activeConversationIdRef: MutableChatSelectionRef
  selectedFolderIdRef: MutableChatSelectionRef
}

export interface ChatSelectionSnapshot {
  activeConversationId: string | null
  selectedFolderId: string | null
}

export function syncChatSelectionRefs(
  refs: ChatSelectionRefs,
  selection: ChatSelectionSnapshot,
) {
  refs.activeConversationIdRef.current = selection.activeConversationId
  refs.selectedFolderIdRef.current = selection.selectedFolderId
}

export function readChatSelectionFromRefs(refs: ChatSelectionRefs): ChatSelectionSnapshot {
  return {
    activeConversationId: refs.activeConversationIdRef.current,
    selectedFolderId: refs.selectedFolderIdRef.current,
  }
}
