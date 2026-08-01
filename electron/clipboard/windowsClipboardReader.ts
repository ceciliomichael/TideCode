import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

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
    return new Promise((resolve) => {
      if (this.isShuttingDown) {
        resolve([])
        return
      }
      this.pendingRequests.push(resolve)
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
      }
    })
  }
}

export const windowsClipboard = new WindowsClipboardReader()
