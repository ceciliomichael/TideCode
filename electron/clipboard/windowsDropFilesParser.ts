import { fileURLToPath } from 'node:url'

/**
 * Parses a Windows CF_HDROP (DROPFILES structure) binary buffer.
 *
 * Win32 DROPFILES layout:
 * - DWORD pFiles (4 bytes): Offset from start of buffer to file list (typically 20 bytes).
 * - POINT pt     (8 bytes): Drop point coordinates.
 * - BOOL  fNC    (4 bytes): Non-client area flag.
 * - BOOL  fWide  (4 bytes): 1 if paths are UTF-16LE (wide), 0 if ANSI.
 * - Files: Double-null-terminated list of null-terminated string paths.
 */
export function parseDropFilesBuffer(buffer: Buffer | null | undefined): string[] {
  if (!buffer || buffer.length < 20) {
    return []
  }

  const pFiles = buffer.readUInt32LE(0)
  if (pFiles < 20 || pFiles >= buffer.length) {
    return []
  }

  const fWide = buffer.readUInt32LE(16) !== 0
  const contentBuffer = buffer.subarray(pFiles)

  if (fWide) {
    const rawString = contentBuffer.toString('utf16le')
    return rawString
      .split('\0')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }

  const rawString = contentBuffer.toString('utf8')
  return rawString
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Parses a Windows FileNameW binary buffer (null-terminated UTF-16LE strings).
 */
export function parseFileNameWBuffer(buffer: Buffer | null | undefined): string[] {
  if (!buffer || buffer.length === 0) {
    return []
  }

  const rawString = buffer.toString('utf16le')
  return rawString
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Parses a Windows FileName binary buffer (null-terminated ANSI/UTF-8 strings).
 */
export function parseFileNameBuffer(buffer: Buffer | null | undefined): string[] {
  if (!buffer || buffer.length === 0) {
    return []
  }

  const rawString = buffer.toString('utf8')
  return rawString
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Parses a text/uri-list string containing file:// URIs.
 */
export function parseUriList(uriList: string | null | undefined): string[] {
  if (!uriList || typeof uriList !== 'string') {
    return []
  }

  const lines = uriList
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  const paths: string[] = []
  for (const line of lines) {
    if (line.startsWith('file://')) {
      try {
        const decodedPath = fileURLToPath(line)
        if (decodedPath && decodedPath.trim().length > 0) {
          paths.push(decodedPath.trim())
        }
      } catch {
        // If fileURLToPath fails on a malformed URL, fallback to raw stripping
        const fallbackPath = decodeURIComponent(line.replace(/^file:\/\/\/?/iu, ''))
        if (fallbackPath.length > 0) {
          paths.push(fallbackPath)
        }
      }
    } else if (/^[a-zA-Z]:[/\\]/u.test(line) || line.startsWith('/')) {
      paths.push(line)
    }
  }

  return paths
}

/**
 * Synchronously extracts file paths directly from Electron clipboard buffers.
 * Executes in memory with zero external subprocess calls.
 */
export function readClipboardFilesDirect(clipboard: {
  has?: (format: string) => boolean
  read?: (format: string) => string
  readBuffer?: (format: string) => Buffer
}): string[] {
  if (!clipboard) {
    return []
  }

  // 1. Try CF_HDROP (standard Windows file drop format containing all paths)
  if (typeof clipboard.readBuffer === 'function') {
    const hdropBuffer = clipboard.readBuffer('CF_HDROP')
    if (hdropBuffer && hdropBuffer.length >= 20) {
      const paths = parseDropFilesBuffer(hdropBuffer)
      if (paths.length > 0) {
        return Array.from(new Set(paths))
      }
    }
  }

  // 2. Try FileNameW (UTF-16LE encoded path list)
  if (typeof clipboard.readBuffer === 'function') {
    const fileNameWBuffer = clipboard.readBuffer('FileNameW')
    if (fileNameWBuffer && fileNameWBuffer.length > 0) {
      const paths = parseFileNameWBuffer(fileNameWBuffer)
      if (paths.length > 0) {
        return Array.from(new Set(paths))
      }
    }
  }

  // 3. Try FileName (ANSI/UTF-8 encoded path list)
  if (typeof clipboard.readBuffer === 'function') {
    const fileNameBuffer = clipboard.readBuffer('FileName')
    if (fileNameBuffer && fileNameBuffer.length > 0) {
      const paths = parseFileNameBuffer(fileNameBuffer)
      if (paths.length > 0) {
        return Array.from(new Set(paths))
      }
    }
  }

  // 4. Try text/uri-list
  if (typeof clipboard.read === 'function') {
    const uriList = clipboard.read('text/uri-list')
    if (uriList && uriList.trim().length > 0) {
      const paths = parseUriList(uriList)
      if (paths.length > 0) {
        return Array.from(new Set(paths))
      }
    }
  }

  return []
}
