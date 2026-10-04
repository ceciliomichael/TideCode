import { spawn } from 'node:child_process'

const DROPFILES_HEADER_SIZE = 20
const DROP_EFFECT_COPY = 1
const DROP_EFFECT_MOVE = 2
const WINDOWS_CLIPBOARD_WRITE_TIMEOUT_MS = 3000
export const TIDECODE_WORKSPACE_CLIPBOARD_FORMAT = 'TideCode.WorkspaceFiles'

const WINDOWS_CLIPBOARD_WRITE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:TIDECODE_CLIPBOARD_PAYLOAD))
$payload = $json | ConvertFrom-Json
$files = New-Object System.Collections.Specialized.StringCollection
foreach ($filePath in @($payload.paths)) {
  [void]$files.Add([string]$filePath)
}
$data = New-Object System.Windows.Forms.DataObject
$data.SetFileDropList($files)
$data.SetText(([string]::Join([Environment]::NewLine, @($payload.paths))), [System.Windows.Forms.TextDataFormat]::UnicodeText)
$effect = if ($payload.mode -eq 'cut') { [uint32]2 } else { [uint32]1 }
$effectBytes = [System.BitConverter]::GetBytes($effect)
$effectStream = New-Object System.IO.MemoryStream(,$effectBytes)
$data.SetData('Preferred DropEffect', $effectStream)
$markerBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$payload.marker)
$markerStream = New-Object System.IO.MemoryStream(,$markerBytes)
$data.SetData('TideCode.WorkspaceFiles', $markerStream)
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
`

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

export function writeWindowsFileClipboard(
  paths: readonly string[],
  mode: NativeFileClipboardMode,
  marker: string,
): Promise<void> {
  const uniquePaths = Array.from(
    new Set(paths.map((filePath) => filePath.trim()).filter((filePath) => filePath.length > 0)),
  )
  if (uniquePaths.length === 0) {
    return Promise.resolve()
  }

  const payload = Buffer.from(JSON.stringify({ marker, mode, paths: uniquePaths }), 'utf8').toString('base64')
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell',
      ['-STA', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_CLIPBOARD_WRITE_SCRIPT],
      {
        env: {
          ...process.env,
          TIDECODE_CLIPBOARD_PAYLOAD: payload,
        },
        windowsHide: true,
      },
    )
    let stderr = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeoutId)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const timeoutId = setTimeout(() => {
      child.kill()
      finish(new Error('Timed out while writing files to the Windows clipboard.'))
    }, WINDOWS_CLIPBOARD_WRITE_TIMEOUT_MS)

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf8')
    })
    child.on('error', (error) => finish(error))
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        finish(new Error(stderr.trim() || `Windows clipboard writer exited with code ${exitCode}.`))
        return
      }
      finish()
    })
  })
}
