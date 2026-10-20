import { access, chmod, copyFile, cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDirectory, '..')
const electronOutputDirectory = path.join(workspaceRoot, 'dist-electron', 'cli')
const electronOutputFile = path.join(electronOutputDirectory, 'index.js')
const electronRunServiceDirectory = path.join(workspaceRoot, 'dist-electron', 'run-service')
const electronRunServiceOutputFile = path.join(electronRunServiceDirectory, 'index.js')
const consoleRuntimeDirectory = path.join(workspaceRoot, 'dist-cli-runtime')
const consoleOutputFile = path.join(consoleRuntimeDirectory, 'index.mjs')
const consoleRunServiceOutputFile = path.join(consoleRuntimeDirectory, 'run-service.mjs')
const consoleNodeExecutable = path.join(
  consoleRuntimeDirectory,
  process.platform === 'win32' ? 'node.exe' : 'node',
)
const electronShimPath = path.join(scriptDirectory, 'cli-electron-shim.mjs')
const nodePtySource = path.join(workspaceRoot, 'node_modules', 'node-pty')
const nodePtyDestination = path.join(consoleRuntimeDirectory, 'node_modules', 'node-pty')
const promptsSource = path.join(workspaceRoot, 'electron', 'chat', 'shared', 'prompts')
const promptsDestination = path.join(
  consoleRuntimeDirectory,
  'electron',
  'chat',
  'shared',
  'prompts',
)
const aiSource = path.join(workspaceRoot, 'electron', 'chat', 'shared', 'ai')
const aiDestination = path.join(consoleRuntimeDirectory, 'electron', 'chat', 'shared', 'ai')
const codeModeWorkerSource = path.join(workspaceRoot, 'electron/chat/shared/codeMode/v8/worker.mjs')

async function isNodePtyRuntimeFile(source) {
  const relativePath = path.relative(nodePtySource, source).split(path.sep).join('/')
  if (relativePath === '' || relativePath === 'package.json' || relativePath === 'LICENSE') {
    return true
  }

  if (relativePath === 'lib' || relativePath.startsWith('lib/')) {
    const sourceStats = await stat(source)
    return sourceStats.isDirectory() || (relativePath.endsWith('.js') && !relativePath.endsWith('.test.js'))
  }

  const nativeDirectories = ['build/Release', `prebuilds/${process.platform}-${process.arch}`]
  for (const directory of nativeDirectories) {
    if (directory.startsWith(`${relativePath}/`)) {
      return true
    }
    if (relativePath === directory || relativePath.startsWith(`${directory}/`)) {
      const sourceStats = await stat(source)
      return sourceStats.isDirectory() || /\.(node|dll|exe)$/.test(relativePath) || path.basename(source) === 'spawn-helper'
    }
  }
  return false
}

await rm(consoleRuntimeDirectory, { force: true, recursive: true })
await Promise.all([
  mkdir(electronOutputDirectory, { recursive: true }),
  mkdir(electronRunServiceDirectory, { recursive: true }),
  mkdir(consoleRuntimeDirectory, { recursive: true }),
])

const cliEntryPoint = path.join(workspaceRoot, 'electron', 'cli', 'index.ts')
const runServiceEntryPoint = path.join(workspaceRoot, 'electron', 'runService', 'index.ts')
const sharedBuildOptions = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
}
const consoleBuildOptions = {
  ...sharedBuildOptions,
  alias: { electron: electronShimPath },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  external: ['node-pty'],
}

await Promise.all([
  build({
    ...sharedBuildOptions,
    entryPoints: [cliEntryPoint],
    packages: 'external',
    external: ['electron', 'node-pty'],
    outfile: electronOutputFile,
  }),
  build({
    ...sharedBuildOptions,
    entryPoints: [runServiceEntryPoint],
    packages: 'external',
    external: ['electron', 'node-pty'],
    outfile: electronRunServiceOutputFile,
  }),
  build({
    ...consoleBuildOptions,
    entryPoints: [cliEntryPoint],
    outfile: consoleOutputFile,
  }),
  build({
    ...consoleBuildOptions,
    entryPoints: [runServiceEntryPoint],
    outfile: consoleRunServiceOutputFile,
  }),
])

await Promise.all([
  copyFile(process.execPath, consoleNodeExecutable),
  cp(nodePtySource, nodePtyDestination, { recursive: true, filter: isNodePtyRuntimeFile }),
  cp(promptsSource, promptsDestination, { recursive: true }),
  cp(aiSource, aiDestination, { recursive: true, filter: (source) =>
    source === aiSource || !path.extname(source) || source.endsWith('.md') }),
  copyFile(codeModeWorkerSource, path.join(consoleRuntimeDirectory, 'code-mode-worker.mjs')),
  copyFile(codeModeWorkerSource, path.join(workspaceRoot, 'dist-electron', 'code-mode-worker.mjs')),
  copyFile(codeModeWorkerSource, path.join(electronOutputDirectory, 'code-mode-worker.mjs')),
  copyFile(codeModeWorkerSource, path.join(electronRunServiceDirectory, 'code-mode-worker.mjs')),
  // isolated-vm is a build dependency shipped only with this Node runtime. It
  // must not be rebuilt against Electron or loaded into Electron's main process.
  ...['isolated-vm', 'node-gyp-build'].map((name) => cp(
    path.join(workspaceRoot, 'node_modules', name),
    path.join(consoleRuntimeDirectory, 'node_modules', name),
    { recursive: true, filter: (source) => {
      const relative = path.relative(path.join(workspaceRoot, 'node_modules', name), source).split(path.sep).join('/')
      if (relative.startsWith('prebuilds/')) {
        const target = `prebuilds/${process.platform}-${process.arch}`
        return relative === target || relative.startsWith(`${target}/`)
      }
      return !/^(src|tests|vendor|\.github)(\/|$)/.test(relative)
    } },
  )),
])

async function verifyPackagedAiInstructions(sourceDirectory, relativePath = '') {
  for (const entry of await readdir(path.join(sourceDirectory, relativePath), { withFileTypes: true })) {
    const relativeEntry = path.join(relativePath, entry.name)
    if (entry.isDirectory()) {
      await verifyPackagedAiInstructions(sourceDirectory, relativeEntry)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      await access(path.join(aiDestination, relativeEntry))
    }
  }
}

await verifyPackagedAiInstructions(aiSource)

if (process.platform !== 'win32') {
  await chmod(consoleNodeExecutable, 0o755)
}

console.log(`Built Electron CLI at ${path.relative(workspaceRoot, electronOutputFile)}`)
console.log(`Built Electron run service at ${path.relative(workspaceRoot, electronRunServiceOutputFile)}`)
console.log(`Built console CLI runtime at ${path.relative(workspaceRoot, consoleRuntimeDirectory)}`)
