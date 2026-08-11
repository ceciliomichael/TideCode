export const MAX_CACHED_WORKSPACE_FILES = 12
export const TEXT_FILE_PREFETCH_TTL_MS = 10_000

export function isWorkspaceFileCacheEntryFresh(
  createdAt: number,
  currentTime: number,
  isPersistentPreview: boolean,
) {
  return isPersistentPreview || currentTime - createdAt <= TEXT_FILE_PREFETCH_TTL_MS
}

export function shouldRetainConsumedWorkspaceFile(consume: boolean | undefined) {
  return consume !== true
}
