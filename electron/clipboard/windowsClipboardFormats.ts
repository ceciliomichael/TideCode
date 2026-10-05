const DROPFILES_HEADER_SIZE = 20
const DROP_EFFECT_COPY = 1
const DROP_EFFECT_MOVE = 2

export const TIDECODE_WORKSPACE_CLIPBOARD_FORMAT = 'TideCode.WorkspaceFiles'

export type NativeFileClipboardMode = 'copy' | 'cut'

export function buildDropFilesBuffer(paths: readonly string[]) {
  const uniquePaths = Array.from(
    new Set(paths.map((filePath) => filePath.trim()).filter((filePath) => filePath.length > 0)),
  )
  const pathList = Buffer.from(`${uniquePaths.join('\0')}\0\0`, 'utf16le')
  const header = Buffer.alloc(DROPFILES_HEADER_SIZE)

  header.writeUInt32LE(DROPFILES_HEADER_SIZE, 0)
  header.writeUInt32LE(1, 16)

  return Buffer.concat([header, pathList])
}

export function buildPreferredDropEffectBuffer(mode: NativeFileClipboardMode) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(mode === 'cut' ? DROP_EFFECT_MOVE : DROP_EFFECT_COPY, 0)
  return buffer
}

export function shouldUseNativeWindowsClipboardFallback(
  directPaths: readonly string[],
  availableFormats: readonly string[],
) {
  if (directPaths.length > 0 || availableFormats.length === 0) {
    return false
  }
  return availableFormats.some((format) => {
    const normalizedFormat = format.toLowerCase()
    return normalizedFormat.includes('filegroupdescriptor') || normalizedFormat.includes('shell idlist')
  })
}
