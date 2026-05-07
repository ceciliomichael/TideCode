import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react'

interface ExternalFileDropItem {
  path: string
}

function getExternalFilePathsFromFileList(files: ArrayLike<ExternalFileDropItem> | null | undefined) {
  if (!files) {
    return []
  }

  const filePaths: string[] = []
  for (const file of Array.from(files)) {
    if (typeof file.path !== 'string') {
      continue
    }

    const trimmedPath = file.path.trim()
    if (trimmedPath.length === 0) {
      continue
    }

    filePaths.push(trimmedPath)
  }

  return filePaths
}

export function getExternalFilePaths(event: ReactDragEvent<HTMLElement>) {
  const filePaths = getExternalFilePathsFromFileList(event.dataTransfer.files)
  if (filePaths.length > 0) {
    return filePaths
  }

  const items = Array.from(event.dataTransfer.items)
  const fallbackPaths: string[] = []
  for (const item of items) {
    if (item.kind !== 'file') {
      continue
    }

    const file = item.getAsFile() as ExternalFileDropItem | null
    if (!file) {
      continue
    }

    fallbackPaths.push(...getExternalFilePathsFromFileList([file]))
  }

  return fallbackPaths
}

export function getExternalClipboardFilePaths(event: ReactClipboardEvent<HTMLElement>) {
  const filePaths = getExternalFilePathsFromFileList(event.clipboardData.files)
  if (filePaths.length > 0) {
    return filePaths
  }

  const items = Array.from(event.clipboardData.items)
  const fallbackPaths: string[] = []
  for (const item of items) {
    if (item.kind !== 'file') {
      continue
    }

    const file = item.getAsFile() as ExternalFileDropItem | null
    if (!file) {
      continue
    }

    fallbackPaths.push(...getExternalFilePathsFromFileList([file]))
  }

  return fallbackPaths
}
