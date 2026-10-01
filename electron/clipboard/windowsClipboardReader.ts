import { clipboard } from 'electron'
import { spawn } from 'node:child_process'
import { readClipboardDropFilesDirect, readClipboardFilesDirect } from './windowsDropFilesParser.ts'

const WINDOWS_CLIPBOARD_READ_TIMEOUT_MS = 2500
const WINDOWS_CLIPBOARD_READ_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
    $paths = @([System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [string]$_ })
    ConvertTo-Json -Compress -InputObject $paths
} else {
    Write-Output '[]'
}
`

function parseNativeFileDropList(output: string) {
  const trimmedOutput = output.trim()
  if (!trimmedOutput) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(trimmedOutput)
    const paths = Array.isArray(parsed) ? parsed : typeof parsed === 'string' ? [parsed] : []
    return Array.from(
      new Set(
        paths
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    )
  } catch (error) {
    console.warn('Failed to parse native Windows clipboard file list', error)
    return []
  }
}

class WindowsClipboardReader {
  private readNativeFileDropList(): Promise<string[]> {
    return new Promise((resolve) => {
      const process = spawn(
        'powershell',
        ['-STA', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_CLIPBOARD_READ_SCRIPT],
        { windowsHide: true },
      )
      let stdout = ''
      let settled = false
      const finish = (paths: string[]) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutId)
        resolve(paths)
      }
      const timeoutId = setTimeout(() => {
        process.kill()
        finish([])
      }, WINDOWS_CLIPBOARD_READ_TIMEOUT_MS)

      process.stdout.on('data', (data: Buffer) => {
        stdout += data.toString('utf8')
      })
      process.on('error', (error) => {
        console.warn('Native Windows clipboard reader failed to start', error)
        finish([])
      })
      process.on('close', (exitCode) => {
        if (exitCode !== 0) {
          finish([])
          return
        }
        finish(parseNativeFileDropList(stdout))
      })
    })
  }

  public async readFiles(): Promise<string[]> {
    try {
      const dropPaths = readClipboardDropFilesDirect(clipboard)
      if (dropPaths.length > 0) {
        return dropPaths
      }
    } catch (dropError) {
      console.warn('Direct CF_HDROP clipboard parsing encountered an issue, trying fallbacks:', dropError)
    }

    let directPaths: string[] = []

    // Direct memory reading is authoritative when it already contains
    // multiple paths. A single FileName/FileNameW path can be only the
    // focused Explorer item from a larger Windows selection, so confirm it
    // against the native file-drop list before returning it.
    try {
      directPaths = readClipboardFilesDirect(clipboard)
      if (directPaths.length > 1) {
        return directPaths
      }
    } catch (directError) {
      console.warn('Direct clipboard buffer parsing encountered an issue, trying fallback:', directError)
    }

    // Query the native Windows file-drop list in an isolated STA process.
    // Keeping each read independent avoids stale/partial output from a shared
    // PowerShell session and gives Windows Explorer multi-selection semantics.
    const nativePaths = await this.readNativeFileDropList()
    return nativePaths.length > 0 ? nativePaths : directPaths
  }
}

export const windowsClipboard = new WindowsClipboardReader()
