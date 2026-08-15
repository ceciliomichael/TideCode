import { chmod, copyFile, cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDirectory, '..')
const electronOutputDirectory = path.join(workspaceRoot, 'dist-electron', 'cli')
const electronOutputFile = path.join(electronOutputDirectory, 'index.js')
const consoleRuntimeDirectory = path.join(workspaceRoot, 'dist-cli-runtime')
const consoleOutputFile = path.join(consoleRuntimeDirectory, 'index.mjs')
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

await rm(consoleRuntimeDirectory, { force: true, recursive: true })
await Promise.all([
  mkdir(electronOutputDirectory, { recursive: true }),
  mkdir(consoleRuntimeDirectory, { recursive: true }),
])

const entryPoint = path.join(workspaceRoot, 'electron', 'cli', 'index.ts')
const sharedBuildOptions = {
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
}

await Promise.all([
  build({
    ...sharedBuildOptions,
    packages: 'external',
    external: ['electron', 'node-pty'],
    outfile: electronOutputFile,
  }),
  build({
    ...sharedBuildOptions,
    alias: { electron: electronShimPath },
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    external: ['node-pty'],
    outfile: consoleOutputFile,
  }),
])

await Promise.all([
  copyFile(process.execPath, consoleNodeExecutable),
  cp(nodePtySource, nodePtyDestination, { recursive: true }),
  cp(promptsSource, promptsDestination, { recursive: true }),
])

if (process.platform !== 'win32') {
  await chmod(consoleNodeExecutable, 0o755)
}

console.log(`Built Electron CLI at ${path.relative(workspaceRoot, electronOutputFile)}`)
console.log(`Built console CLI runtime at ${path.relative(workspaceRoot, consoleRuntimeDirectory)}`)
