import {
  buildDropFilesBuffer,
  buildPreferredDropEffectBuffer,
  TIDECODE_WORKSPACE_CLIPBOARD_FORMAT,
  type NativeFileClipboardMode,
} from './windowsClipboardFormats'

interface ClipboardWriter {
  clear(): void
  writeBuffer(format: string, buffer: Buffer): void
}

export {
  buildDropFilesBuffer,
  buildPreferredDropEffectBuffer,
  TIDECODE_WORKSPACE_CLIPBOARD_FORMAT,
  type NativeFileClipboardMode,
} from './windowsClipboardFormats'

export function writeWindowsFileClipboard(
  clipboard: ClipboardWriter,
  paths: readonly string[],
  mode: NativeFileClipboardMode,
  marker: string,
): void {
  const uniquePaths = Array.from(
    new Set(paths.map((filePath) => filePath.trim()).filter((filePath) => filePath.length > 0)),
  )
  if (uniquePaths.length === 0) {
    clipboard.clear()
    return
  }

  clipboard.clear()
  clipboard.writeBuffer('CF_HDROP', buildDropFilesBuffer(uniquePaths))
  clipboard.writeBuffer('Preferred DropEffect', buildPreferredDropEffectBuffer(mode))
  clipboard.writeBuffer(TIDECODE_WORKSPACE_CLIPBOARD_FORMAT, Buffer.from(marker, 'utf8'))
}
