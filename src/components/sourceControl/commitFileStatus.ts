import type { GitHistoryCommitFile } from '../../types/chat'

export function isDeletedCommitFile(file: GitHistoryCommitFile) {
  return file.status.trim().toUpperCase().startsWith('D')
}
