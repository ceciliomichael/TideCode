import { normalizePathSeparators } from '../../../lib/filePathUtils'
import type { WorkspaceTab } from '../types'

export function findWorkspaceTabByKey(tabs: readonly WorkspaceTab[], activeTabKey: string | null) {
  if (!activeTabKey) {
    return null
  }

  const normalizedActiveTabKey = normalizePathSeparators(activeTabKey)
  return (
    tabs.find((tab) => normalizePathSeparators(tab.tabKey) === normalizedActiveTabKey) ??
    null
  )
}
