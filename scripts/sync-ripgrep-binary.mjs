import { mkdir, access, copyFile, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRootPath = path.resolve(__dirname, '..')
const executableName = process.platform === 'win32' ? 'rg.exe' : 'rg'

const ripgrepPkgDir = path.dirname(require.resolve('@vscode/ripgrep/package.json'))
const sourcePath = path.join(ripgrepPkgDir, 'bin', executableName)
const targetDirectoryPath = path.join(repoRootPath, 'resources', 'ripgrep')
const targetPath = path.join(targetDirectoryPath, executableName)

// 1. Ensure Ripgrep binary exists in node_modules
try {
  await access(sourcePath)
} catch {
  console.log('[setup] Ripgrep binary missing in @vscode/ripgrep. Downloading prebuilt binary...')
  const postinstallScript = path.join(ripgrepPkgDir, 'lib', 'postinstall.js')
  execSync(`node "${postinstallScript}"`, { stdio: 'inherit' })
  await access(sourcePath)
}

// 2. Sync to resources directory if modified or missing
await mkdir(targetDirectoryPath, { recursive: true })
let shouldCopy = true
try {
  const [srcStat, tgtStat] = await Promise.all([stat(sourcePath), stat(targetPath)])
  if (srcStat.size === tgtStat.size && tgtStat.size > 0) {
    shouldCopy = false
  }
} catch {
  shouldCopy = true
}

if (shouldCopy) {
  await copyFile(sourcePath, targetPath)
  console.log(`[setup] Synced ripgrep binary to ${targetPath}`)
} else {
  console.log('[setup] Ripgrep binary up to date.')
}

// 3. On Windows, proactively handle electron-builder winCodeSign symlink issues for non-admin users
if (process.platform === 'win32') {
  try {
    const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Admin'
    const cacheDir = path.join(userHome, 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign')
    const targetUnpacked = path.join(cacheDir, 'winCodeSign-2.6.0')
    
    // Check if targetUnpacked exists
    let unpackedExists = false
    try {
      await access(targetUnpacked)
      unpackedExists = true
    } catch {
      unpackedExists = false
    }

    if (!unpackedExists) {
      // Find 7z archive in cacheDir if available
      try {
        const files = await readdir(cacheDir)
        const archive = files.find(f => f.endsWith('.7z'))
        const sevenZipExe = path.join(repoRootPath, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')
        
        if (archive) {
          const archivePath = path.join(cacheDir, archive)
          const sevenZipExists = await access(sevenZipExe).then(() => true).catch(() => false)
          if (sevenZipExists) {
            console.log('[setup] Pre-unpacking winCodeSign cache to avoid Windows symlink privilege errors...')
            execSync(`"${sevenZipExe}" x -bd "${archivePath}" "-o${targetUnpacked}" "-xr!darwin" -y`, { stdio: 'ignore' })
            console.log('[setup] winCodeSign cache ready.')
          }
        }
      } catch {
        // Cache directory not yet created by electron-builder, will be handled on build
      }
    }
  } catch {
    // Non-critical optimization, ignore error
  }
}


