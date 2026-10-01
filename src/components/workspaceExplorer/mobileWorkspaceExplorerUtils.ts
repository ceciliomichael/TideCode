import { isDocxPreviewablePath } from '../../lib/docx-preview'
import { normalizePathSeparators } from '../../lib/filePathUtils'
import { isImagePreviewablePath } from '../../lib/image-preview'
import { isMarkdownPreviewablePath } from '../../lib/markdown-preview'
import { isPdfPreviewablePath } from '../../lib/pdf-preview'
import { isSvgPreviewablePath } from '../../lib/svg-preview'
import type { WorkspaceTab } from './types'

export type MobileWorkspaceExplorerView = 'explorer' | 'file' | 'preview'

function matchesPath(tab: WorkspaceTab, relativePath: string) {
  return normalizePathSeparators(tab.relativePath) === normalizePathSeparators(relativePath)
}

export function isMobileBinaryPreviewablePath(relativePath: string) {
  return (
    isDocxPreviewablePath(relativePath) ||
    isImagePreviewablePath(relativePath) ||
    isPdfPreviewablePath(relativePath)
  )
}

export function isMobilePreviewablePath(relativePath: string) {
  return (
    isMarkdownPreviewablePath(relativePath) ||
    isSvgPreviewablePath(relativePath) ||
    isMobileBinaryPreviewablePath(relativePath)
  )
}

export function findMobileWorkspaceFileViewTab(
  tabs: readonly WorkspaceTab[],
  relativePath: string,
): WorkspaceTab | null {
  const matchingTabs = tabs.filter((tab) => matchesPath(tab, relativePath))
  return (
    matchingTabs.find((tab) => tab.kind === 'file') ??
    matchingTabs.find((tab) => tab.kind === 'plan-preview') ??
    null
  )
}

export function findMobileWorkspacePreviewTab(
  tabs: readonly WorkspaceTab[],
  relativePath: string,
): WorkspaceTab | null {
  const matchingTabs = tabs.filter((tab) => matchesPath(tab, relativePath))
  const planPreview = matchingTabs.find((tab) => tab.kind === 'plan-preview')
  if (planPreview) {
    return planPreview
  }

  if (isMarkdownPreviewablePath(relativePath)) {
    return matchingTabs.find((tab) => tab.kind === 'markdown-preview') ?? null
  }

  if (isSvgPreviewablePath(relativePath)) {
    return matchingTabs.find((tab) => tab.kind === 'svg-preview') ?? null
  }

  if (isMobileBinaryPreviewablePath(relativePath)) {
    return matchingTabs.find((tab) => tab.kind === 'file') ?? null
  }

  return null
}
