import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react'

interface ExternalFileDropItem {
  path?: string
}

type DropFileCandidate = ExternalFileDropItem | File | (File & { path?: string })

function getExternalFilePath(file: DropFileCandidate) {
  const legacyPathCandidate = (file as ExternalFileDropItem).path
  if (typeof legacyPathCandidate === 'string') {
    const legacyPath = legacyPathCandidate.trim()
    if (legacyPath.length > 0) {
      return legacyPath
    }
  }


  if (typeof window === 'undefined') {
    return null
  }

  const nativePath = window.echosphereFileDrop?.getPathForFile(file as File)
  if (typeof nativePath !== 'string') {
    return null
  }

  const trimmedNativePath = nativePath.trim()
  return trimmedNativePath.length > 0 ? trimmedNativePath : null
}

function getExternalFilePathsFromFileList(files: ArrayLike<ExternalFileDropItem | File> | null | undefined) {
  if (!files) {
    return []
  }

  const filePaths: string[] = []
  for (const file of Array.from(files)) {
    const filePath = getExternalFilePath(file)
    if (!filePath) {
      continue
    }

    filePaths.push(filePath)
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

export async function getExternalClipboardFilePaths(event: ReactClipboardEvent<HTMLElement>) {
  if (typeof window !== 'undefined' && window.echosphereClipboard) {
    try {
      const osPaths = await window.echosphereClipboard.readFiles()
      if (osPaths.length > 0) {
        return osPaths
      }
    } catch (e) {
      console.error('Failed to read OS clipboard files', e)
    }
  }

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
