import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams, execSync } from 'node:child_process'
import type { ChatImageAttachment } from '../../src/types/chat'
import {
  isImageExtension,
  readCliImageAttachment,
} from './cliImageAttachments'

interface ClipboardReadResult {
  image: ChatImageAttachment | null
  text: string | null
}

const EMPTY_CLIPBOARD_RESULT: ClipboardReadResult = { image: null, text: null }
const CLIPBOARD_READY_TIMEOUT_MS = 2000
// Materializing a large Windows clipboard image through System.Drawing can take
// several seconds. This is only a stuck-helper recovery limit; successful
// requests still resolve as soon as the image bytes are available.
const CLIPBOARD_REQUEST_TIMEOUT_MS = 30000

const WINDOWS_CLIPBOARD_SETUP_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::DoEvents()
[Console]::Out.WriteLine("READY")
`

const WINDOWS_CLIPBOARD_QUERY_SCRIPT = `
[System.Windows.Forms.Application]::DoEvents()
$hasClipboardImage = [System.Windows.Forms.Clipboard]::ContainsImage()
$hasClipboardFiles = $false
if (-not $hasClipboardImage) {
    [System.Windows.Forms.Application]::DoEvents()
    $hasClipboardFiles = [System.Windows.Forms.Clipboard]::ContainsFileDropList()
}
if ($hasClipboardImage) {
    [System.Windows.Forms.Application]::DoEvents()
    $img = [System.Windows.Forms.Clipboard]::GetImage()
    if ($null -ne $img) {
        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $b64 = [Convert]::ToBase64String($ms.ToArray())
        [Console]::Out.WriteLine("BASE64_START")
        [Console]::Out.WriteLine($b64)
        [Console]::Out.WriteLine("BASE64_END")
    }
} elseif ($hasClipboardFiles) {
    $files = [System.Windows.Forms.Clipboard]::GetFileDropList()
    foreach ($f in $files) { [Console]::Out.WriteLine("FILE:$f") }
} else {
    [System.Windows.Forms.Application]::DoEvents()
    if ([System.Windows.Forms.Clipboard]::ContainsText()) {
    $t = [System.Windows.Forms.Clipboard]::GetText()
    $textB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($t))
    [Console]::Out.WriteLine("TEXT_BASE64_START")
    [Console]::Out.WriteLine($textB64)
    [Console]::Out.WriteLine("TEXT_BASE64_END")
    }
}
[Console]::Out.WriteLine("EOF")
`

class WindowsClipboardDaemon {
  private ps: ChildProcessWithoutNullStreams | null = null
  private pendingRequests: Array<(result: ClipboardReadResult) => void> = []
  private currentLines: string[] = []
  private stdoutBuffer = ''
  private isShuttingDown = false
  private currentWorkspaceRoot: string | undefined
  private isReady = false
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((reason?: unknown) => void) | null = null
  private readQueue: Promise<void> = Promise.resolve()

  public constructor() {
    process.on('exit', () => {
      this.isShuttingDown = true
      if (this.ps) this.ps.kill()
    })
    this.ensureProcess()
  }

  private ensureProcess(): ChildProcessWithoutNullStreams | null {
    if (this.ps || this.isShuttingDown) return this.ps

    try {
      const child = spawn('powershell', ['-STA', '-NoProfile', '-Command', '-'], { windowsHide: true })
      this.ps = child
      this.isReady = false
      this.readyPromise = new Promise<void>((resolve, reject) => {
        this.resolveReady = resolve
        this.rejectReady = reject
      })

      child.stdout.on('data', (data: Buffer) => {
        this.stdoutBuffer += data.toString('utf8')
        let newlineIndex: number
        while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
          const rawLine = this.stdoutBuffer.slice(0, newlineIndex)
          this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
          if (line === 'READY') {
            this.isReady = true
            this.resolveReady?.()
            this.resolveReady = null
            this.rejectReady = null
            continue
          }

          if (line === 'EOF') {
            const request = this.pendingRequests.shift()
            const linesToParse = [...this.currentLines]
            this.currentLines = []
            if (request) {
              void this.parseLines(linesToParse, this.currentWorkspaceRoot)
                .then(request, () => request(EMPTY_CLIPBOARD_RESULT))
            }
            continue
          }

          if (line.length > 0) this.currentLines.push(line)
        }
      })

      child.on('error', (error) => {
        this.rejectReady?.(error)
        this.resolveReady = null
        this.rejectReady = null
      })
      child.on('exit', () => this.handleProcessExit(child))
      child.stdin.write(WINDOWS_CLIPBOARD_SETUP_SCRIPT)
      return child
    } catch {
      this.ps = null
      this.isReady = false
      this.readyPromise = null
      this.resolveReady = null
      this.rejectReady = null
      return null
    }
  }

  private handleProcessExit(child: ChildProcessWithoutNullStreams) {
    if (this.ps !== child) return

    this.ps = null
    this.isReady = false
    this.stdoutBuffer = ''
    this.currentLines = []
    this.rejectReady?.(new Error('Clipboard helper exited before it became ready'))
    this.readyPromise = null
    this.resolveReady = null
    this.rejectReady = null
    const pendingRequests = this.pendingRequests.splice(0)
    for (const request of pendingRequests) request(EMPTY_CLIPBOARD_RESULT)
  }

  private stopProcess(child: ChildProcessWithoutNullStreams) {
    if (this.ps !== child) return

    this.ps = null
    this.isReady = false
    this.stdoutBuffer = ''
    this.currentLines = []
    this.readyPromise = null
    this.resolveReady = null
    this.rejectReady = null
    const pendingRequests = this.pendingRequests.splice(0)
    for (const request of pendingRequests) request(EMPTY_CLIPBOARD_RESULT)
    child.kill()
  }

  private async waitUntilReady(child: ChildProcessWithoutNullStreams): Promise<boolean> {
    if (this.ps !== child || this.isShuttingDown) return false
    if (this.isReady) return true

    const readyPromise = this.readyPromise
    if (!readyPromise) return false

    let timeoutId: NodeJS.Timeout | undefined
    const becameReady = await Promise.race([
      readyPromise.then(() => true, () => false),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), CLIPBOARD_READY_TIMEOUT_MS)
      }),
    ])
    if (timeoutId) clearTimeout(timeoutId)

    const ready = becameReady && this.ps === child && this.isReady
    if (!ready) this.stopProcess(child)
    return ready
  }

  private async parseLines(lines: string[], workspaceRoot?: string): Promise<ClipboardReadResult> {
    let inImageBase64 = false
    let imageBase64 = ''
    let inTextBase64 = false
    let textBase64 = ''

    for (const line of lines) {
      if (line === 'BASE64_START') {
        inImageBase64 = true
        imageBase64 = ''
        continue
      }
      if (line === 'BASE64_END') {
        inImageBase64 = false
        const result = this.createImageResult(imageBase64)
        if (result) return result
        continue
      }
      if (line === 'TEXT_BASE64_START') {
        inTextBase64 = true
        textBase64 = ''
        continue
      }
      if (line === 'TEXT_BASE64_END') {
        inTextBase64 = false
        const text = Buffer.from(textBase64.replace(/\s+/g, ''), 'base64').toString('utf8')
        return this.createTextResult(text, workspaceRoot)
      }
      if (inImageBase64) {
        imageBase64 += line
        continue
      }
      if (inTextBase64) {
        textBase64 += line
        continue
      }
      if (line.startsWith('BASE64:')) {
        const result = this.createImageResult(line.slice('BASE64:'.length))
        if (result) return result
      } else if (line.startsWith('FILE:')) {
        const filePath = line.slice('FILE:'.length).trim()
        if (filePath && isImageExtension(filePath)) {
          const attachment = await readCliImageAttachment(filePath, workspaceRoot)
          if (attachment) return { image: attachment, text: null }
        }
      } else if (line.startsWith('TEXT:')) {
        return this.createTextResult(line.slice('TEXT:'.length), workspaceRoot)
      }
    }

    const imageResult = this.createImageResult(imageBase64)
    return imageResult ?? EMPTY_CLIPBOARD_RESULT
  }

  private createImageResult(base64: string): ClipboardReadResult | null {
    const cleanBase64 = base64.replace(/\s+/g, '')
    if (!cleanBase64) return null

    const buffer = Buffer.from(cleanBase64, 'base64')
    return {
      image: {
        id: randomUUID(),
        kind: 'image',
        fileName: 'clipboard-image.png',
        mimeType: 'image/png',
        sizeBytes: buffer.length,
        dataUrl: `data:image/png;base64,${cleanBase64}`,
      },
      text: null,
    }
  }

  private async createTextResult(text: string, workspaceRoot?: string): Promise<ClipboardReadResult> {
    if (text && isImageExtension(text.trim())) {
      const attachment = await readCliImageAttachment(text.trim(), workspaceRoot)
      if (attachment) return { image: attachment, text: null }
    }
    return { image: null, text: text || null }
  }

  private async readOnce(workspaceRoot?: string): Promise<ClipboardReadResult> {
    this.currentWorkspaceRoot = workspaceRoot
    const child = this.ensureProcess()
    if (!child || this.isShuttingDown || !(await this.waitUntilReady(child))) {
      return EMPTY_CLIPBOARD_RESULT
    }

    return new Promise((resolve) => {
      let settled = false
      const timer: { id?: NodeJS.Timeout } = {}
      const request = (result: ClipboardReadResult) => {
        if (settled) return
        settled = true
        if (timer.id) clearTimeout(timer.id)
        resolve(result)
      }
      timer.id = setTimeout(() => {
        const requestIndex = this.pendingRequests.indexOf(request)
        if (requestIndex >= 0) this.pendingRequests.splice(requestIndex, 1)
        request(EMPTY_CLIPBOARD_RESULT)
        this.stopProcess(child)
      }, CLIPBOARD_REQUEST_TIMEOUT_MS)

      this.pendingRequests.push(request)
      try {
        // PowerShell's stdin parser needs a blank line to finalize the
        // multi-line conditional before it executes the query.
        child.stdin.write(`${WINDOWS_CLIPBOARD_QUERY_SCRIPT}\n`)
      } catch {
        const requestIndex = this.pendingRequests.indexOf(request)
        if (requestIndex >= 0) this.pendingRequests.splice(requestIndex, 1)
        request(EMPTY_CLIPBOARD_RESULT)
        this.stopProcess(child)
      }
    })
  }

  public read(workspaceRoot?: string): Promise<ClipboardReadResult> {
    const result = this.readQueue.then(() => this.readOnce(workspaceRoot))
    this.readQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

let windowsDaemon: WindowsClipboardDaemon | null = null

function getWindowsClipboardDaemon(): WindowsClipboardDaemon {
  if (!windowsDaemon) windowsDaemon = new WindowsClipboardDaemon()
  return windowsDaemon
}

function tryReadElectronClipboard(): ChatImageAttachment | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron')
    if (electron?.clipboard?.readImage) {
      const nativeImg = electron.clipboard.readImage()
      if (!nativeImg.isEmpty()) {
        const buffer = nativeImg.toPNG()
        const size = nativeImg.getSize()
        return {
          id: randomUUID(),
          kind: 'image',
          fileName: 'clipboard-image.png',
          mimeType: 'image/png',
          sizeBytes: buffer.length,
          width: size.width,
          height: size.height,
          dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        }
      }
    }
  } catch {
    // Electron clipboard not available in standard Node runtime
  }
  return null
}

async function tryReadMacClipboard(workspaceRoot?: string): Promise<ClipboardReadResult> {
  try {
    const script = `
      try
        set theData to the clipboard as «class PNGf»
        return "PNG"
      on error
        try
          set theText to the clipboard as text
          return "TEXT:" & theText
        on error
          return ""
        end try
      end try
    `
    const output = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { encoding: 'utf8', timeout: 1500 }).trim()
    if (output === 'PNG') {
      const pngBase64 = execSync("osascript -e 'get the clipboard as «class PNGf»' | sed 's/«data PNGf//' | tr -d '» ' | xxd -r -p | base64", {
        encoding: 'utf8',
        timeout: 1500,
      }).trim()
      if (pngBase64) {
        return {
          image: {
            id: randomUUID(),
            kind: 'image',
            fileName: 'clipboard-image.png',
            mimeType: 'image/png',
            sizeBytes: Math.floor(pngBase64.length * 0.75),
            dataUrl: `data:image/png;base64,${pngBase64}`,
          },
          text: null,
        }
      }
    } else if (output.startsWith('TEXT:')) {
      const text = output.slice('TEXT:'.length)
      if (text && isImageExtension(text)) {
        const attachment = await readCliImageAttachment(text, workspaceRoot)
        if (attachment) return { image: attachment, text: null }
      }
      return { image: null, text }
    }
  } catch {
    // Fallback
  }
  return EMPTY_CLIPBOARD_RESULT
}

async function tryReadLinuxClipboard(): Promise<ClipboardReadResult> {
  try {
    const buffer = execSync('xclip -selection clipboard -t image/png -o 2>/dev/null || wl-paste --type image/png 2>/dev/null', {
      timeout: 1500,
      maxBuffer: 16 * 1024 * 1024,
    })
    if (buffer && buffer.length > 0) {
      return {
        image: {
          id: randomUUID(),
          kind: 'image',
          fileName: 'clipboard-image.png',
          mimeType: 'image/png',
          sizeBytes: buffer.length,
          dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        },
        text: null,
      }
    }
  } catch {
    // Fallback
  }
  return EMPTY_CLIPBOARD_RESULT
}

export async function readSystemClipboardImageOrText(workspaceRoot?: string): Promise<ClipboardReadResult> {
  const electronImg = tryReadElectronClipboard()
  if (electronImg) return { image: electronImg, text: null }

  if (process.platform === 'win32') return getWindowsClipboardDaemon().read(workspaceRoot)
  if (process.platform === 'darwin') return tryReadMacClipboard(workspaceRoot)
  return tryReadLinuxClipboard()
}

export function warmSystemClipboardReader(): void {
  if (process.platform === 'win32') getWindowsClipboardDaemon()
}
