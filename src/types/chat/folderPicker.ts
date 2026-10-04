export type FolderPickerRootKind =
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'drive'
  | 'home'
  | 'music'
  | 'other'
  | 'pictures'
  | 'videos'

export interface FolderPickerRoot {
  kind: FolderPickerRootKind
  label: string
  path: string
}

export interface FolderPickerBreadcrumb {
  label: string
  path: string
}

export interface FolderPickerEntry {
  name: string
  path: string
}

export interface FolderPickerDirectory {
  breadcrumbs: FolderPickerBreadcrumb[]
  entries: FolderPickerEntry[]
  parentPath: string | null
  path: string
}

export interface FolderPickerRoots {
  initialPath: string
  roots: FolderPickerRoot[]
}

export type FolderPickerClipboardMode = 'copy' | 'cut'
