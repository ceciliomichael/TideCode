import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
} from 'react'

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

const DRAG_SCROLL_EDGE_THRESHOLD_PX = 72
const DRAG_SCROLL_MAX_SPEED_PX = 22
const MIN_SCROLLBAR_GUTTER_WIDTH_PX = 12

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

export function getDragScrollVelocity(containerElement: HTMLElement, clientY: number) {
  const { bottom, top } = containerElement.getBoundingClientRect()
  const distanceFromTop = clientY - top
  const distanceFromBottom = bottom - clientY

  if (distanceFromTop < DRAG_SCROLL_EDGE_THRESHOLD_PX) {
    const intensity = 1 - Math.max(distanceFromTop, 0) / DRAG_SCROLL_EDGE_THRESHOLD_PX
    return -Math.ceil(intensity * DRAG_SCROLL_MAX_SPEED_PX)
  }

  if (distanceFromBottom < DRAG_SCROLL_EDGE_THRESHOLD_PX) {
    const intensity = 1 - Math.max(distanceFromBottom, 0) / DRAG_SCROLL_EDGE_THRESHOLD_PX
    return Math.ceil(intensity * DRAG_SCROLL_MAX_SPEED_PX)
  }

  return 0
}

export function isPointerInVerticalScrollbarGutter(containerElement: HTMLElement, clientX: number) {
  if (containerElement.scrollHeight <= containerElement.clientHeight) {
    return false
  }

  const { left, right } = containerElement.getBoundingClientRect()
  const scrollbarWidth = Math.max(MIN_SCROLLBAR_GUTTER_WIDTH_PX, containerElement.offsetWidth - containerElement.clientWidth)
  const isRtl = window.getComputedStyle(containerElement).direction === 'rtl'

  return isRtl
    ? clientX >= left && clientX <= left + scrollbarWidth
    : clientX <= right && clientX >= right - scrollbarWidth
}

export function scrollToDragScrollbarPosition(containerElement: HTMLElement, clientY: number) {
  const { height, top } = containerElement.getBoundingClientRect()
  const maxScrollTop = containerElement.scrollHeight - containerElement.clientHeight
  if (height <= 0 || maxScrollTop <= 0) {
    return
  }

  const scrollRatio = Math.min(Math.max((clientY - top) / height, 0), 1)
  containerElement.scrollTop = Math.round(maxScrollTop * scrollRatio)
}
