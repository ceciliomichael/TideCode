import { app, clipboard } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readClipboardFilesDirect } from './windowsDropFilesParser.ts'

class WindowsClipboardReader {
  private ps: ChildProcessWithoutNullStreams | null = null
  private pendingRequests: Array<(paths: string[]) => void> = []
  private currentPaths: string[] = []
  private isShuttingDown = false

  public constructor() {
    app.on('quit', () => {
      this.isShuttingDown = true
      if (this.ps) {
        this.ps.kill()
      }
    })
  }

  private getProcess() {
    if (!this.ps && !this.isShuttingDown) {
      this.ps = spawn('powershell', ['-STA', '-NoProfile', '-Command', '-'], { windowsHide: true })
      // Initialize UTF-8 encoding for PowerShell stdout
      this.ps.stdin.write('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8\n')
      this.ps.stdout.on('data', (data: Buffer) => {
        const lines = data.toString('utf8').split(/\r?\n/)
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed === 'EOF') {
            const req = this.pendingRequests.shift()
            if (req) req([...this.currentPaths])
            this.currentPaths = []
          } else if (trimmed.length > 0) {
            this.currentPaths.push(trimmed)
          }
        }
      })
      this.ps.on('exit', () => {
        this.ps = null
        for (const req of this.pendingRequests) {
          req([])
        }
        this.pendingRequests = []
      })
    }
    return this.ps
  }

  public async readFiles(): Promise<string[]> {
    // 1. Direct memory reading first (zero-latency < 1ms)
    try {
      const directPaths = readClipboardFilesDirect(clipboard)
      if (directPaths.length > 0) {
        return directPaths
      }
    } catch (directError) {
      console.warn('Direct clipboard buffer parsing encountered an issue, trying fallback:', directError)
    }

    // 2. PowerShell fallback only if direct memory parsing returned no files
    return new Promise((resolve) => {
      if (this.isShuttingDown) {
        resolve([])
        return
      }

      const timeoutId = setTimeout(() => {
        const index = this.pendingRequests.indexOf(resolve)
        if (index !== -1) {
          this.pendingRequests.splice(index, 1)
          resolve([])
        }
      }, 1500)

      this.pendingRequests.push((paths) => {
        clearTimeout(timeoutId)
        resolve(paths)
      })

      const ps = this.getProcess()
      if (ps) {
        ps.stdin.write(`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
    $files = [System.Windows.Forms.Clipboard]::GetFileDropList()
    foreach ($file in $files) { Write-Host $file }
}
Write-Host "EOF"\n`)
      } else {
        clearTimeout(timeoutId)
        resolve([])
      }
    })
  }
}

export const windowsClipboard = new WindowsClipboardReader()
