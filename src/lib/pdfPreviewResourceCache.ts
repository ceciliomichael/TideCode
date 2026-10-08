export interface PdfResourceLease<T> {
  promise: Promise<T>
  release: () => void
}

interface ResourceEntry<T> {
  promise: Promise<T>
  dispose: () => void
  references: number
  sourceBytes: number
  expiry?: ReturnType<typeof setTimeout>
  retired: boolean
}

// Active documents are pinned; inactive workers survive only a short tab-switch grace period.
export class PdfPreviewResourceCache<T> {
  private readonly entries = new Map<string, ResourceEntry<T>>()

  constructor(
    private readonly create: (key: string) => { promise: Promise<T>; dispose: () => void },
    private readonly graceMs = 1_000,
    private readonly maxSourceBytes = 32 * 1024 * 1024,
  ) {}

  acquire(key: string): PdfResourceLease<T> {
    let entry = this.entries.get(key)
    if (!entry) {
      const resource = this.create(key)
      entry = { ...resource, references: 0, sourceBytes: key.length * 2, retired: false }
      const createdEntry = entry
      entry.promise = resource.promise.catch((error: unknown) => {
        this.disposeEntry(key, createdEntry)
        throw error
      })
      this.entries.set(key, entry)
    }
    clearTimeout(entry.expiry)
    entry.expiry = undefined
    entry.references += 1
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.prune()

    let released = false
    const leasedEntry = entry
    return {
      promise: entry.promise,
      release: () => {
        if (released) {
          return
        }
        released = true
        leasedEntry.references -= 1
        if (leasedEntry.references !== 0) {
          return
        }
        if (leasedEntry.retired) {
          this.disposeEntry(key, leasedEntry)
          return
        }
        leasedEntry.expiry = setTimeout(() => this.disposeEntry(key, leasedEntry), this.graceMs)
        this.prune()
      },
    }
  }

  clear() {
    for (const [key, entry] of this.entries) {
      entry.retired = true
      this.entries.delete(key)
      if (entry.references === 0) {
        this.disposeEntry(key, entry)
      }
    }
  }

  private prune() {
    let sourceBytes = 0
    for (const entry of this.entries.values()) {
      sourceBytes += entry.sourceBytes
    }
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= 3 && sourceBytes <= this.maxSourceBytes) {
        break
      }
      if (entry.references !== 0) {
        continue
      }
      sourceBytes -= entry.sourceBytes
      this.disposeEntry(key, entry)
    }
  }

  private disposeEntry(key: string, entry: ResourceEntry<T>) {
    clearTimeout(entry.expiry)
    if (this.entries.get(key) === entry) {
      this.entries.delete(key)
    }
    entry.retired = true
    const dispose = entry.dispose
    entry.dispose = () => undefined
    dispose()
  }
}
