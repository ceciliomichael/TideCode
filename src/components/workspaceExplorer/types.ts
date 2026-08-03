export interface WorkspaceFileTab {
  kind: 'file'
  tabKey: string
  content: string
  originalContent: string | null
  errorMessage?: string
  fileName: string
  isBinary: boolean
  isTruncated: boolean
  modifiedTimeMs?: number
  previewDataUrl?: string
  previewError?: string
  previewMimeType?: string
  relativePath: string
  sizeBytes: number
  status: 'error' | 'loading' | 'ready'
}

export interface WorkspaceMarkdownPreviewTab {
  kind: 'markdown-preview'
  fileName: string
  relativePath: string
  tabKey: string
  content: string
  status: 'loading' | 'ready' | 'error'
  isTruncated: boolean
  errorMessage?: string
}

export interface WorkspaceSvgPreviewTab {
  kind: 'svg-preview'
  fileName: string
  relativePath: string
  tabKey: string
}

export type WorkspaceTab = WorkspaceFileTab | WorkspaceMarkdownPreviewTab | WorkspaceSvgPreviewTab
