export interface RemoteAttachmentFileEntry {
  file: File
  relativePath: string
}

export type RemoteAttachmentSelection =
  | { file: File; kind: 'file' }
  | { files: RemoteAttachmentFileEntry[]; kind: 'folder'; name: string }

interface BrowserFileSystemEntry {
  isDirectory: boolean
  isFile: boolean
  name: string
}

interface BrowserFileSystemFileEntry extends BrowserFileSystemEntry {
  file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void
}

interface BrowserFileSystemDirectoryReader {
  readEntries: (
    success: (entries: BrowserFileSystemEntry[]) => void,
    failure?: (error: DOMException) => void,
  ) => void
}

interface BrowserFileSystemDirectoryEntry extends BrowserFileSystemEntry {
  createReader: () => BrowserFileSystemDirectoryReader
}

function getEntry(item: DataTransferItem) {
  const candidate = item as DataTransferItem & {
    webkitGetAsEntry?: () => BrowserFileSystemEntry | null
  }
  return candidate.webkitGetAsEntry?.() ?? null
}

function readFileEntry(entry: BrowserFileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject))
}

async function readDirectoryEntries(entry: BrowserFileSystemDirectoryEntry) {
  const reader = entry.createReader()
  const entries: BrowserFileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<BrowserFileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return entries
    entries.push(...batch)
  }
}

async function collectDirectoryFiles(
  entry: BrowserFileSystemDirectoryEntry,
  prefix = '',
): Promise<RemoteAttachmentFileEntry[]> {
  const files: RemoteAttachmentFileEntry[] = []
  for (const child of await readDirectoryEntries(entry)) {
    const relativePath = prefix ? `${prefix}/${child.name}` : child.name
    if (child.isFile) {
      files.push({
        file: await readFileEntry(child as BrowserFileSystemFileEntry),
        relativePath,
      })
      continue
    }
    if (child.isDirectory) {
      files.push(...await collectDirectoryFiles(child as BrowserFileSystemDirectoryEntry, relativePath))
    }
  }
  return files
}

export async function collectRemoteAttachmentSelections(
  items: ArrayLike<DataTransferItem> | null | undefined,
  files: ArrayLike<File> | null | undefined,
): Promise<RemoteAttachmentSelection[]> {
  const itemList = Array.from(items ?? [])
  const selections: RemoteAttachmentSelection[] = []
  let usedEntries = false

  for (const item of itemList) {
    if (item.kind !== 'file') continue
    const entry = getEntry(item)
    if (!entry) continue
    usedEntries = true
    if (entry.isFile) {
      selections.push({ file: await readFileEntry(entry as unknown as BrowserFileSystemFileEntry), kind: 'file' })
      continue
    }
    if (entry.isDirectory) {
      selections.push({
        files: await collectDirectoryFiles(entry as unknown as BrowserFileSystemDirectoryEntry),
        kind: 'folder',
        name: entry.name,
      })
    }
  }

  if (usedEntries) return selections
  return Array.from(files ?? []).map((file) => ({ file, kind: 'file' as const }))
}
