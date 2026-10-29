import '../../configureAppRoot'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '../../..')

test('real Electron AI browser is isolated from the user window and renders independent previews', {
  timeout: 45000,
  skip: process.env.TIDECODE_RUN_NATIVE_BROWSER_TESTS !== '1',
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tidecode-browser-agent-'))
  try {
    await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction')
    const entries = [
      'agentTabs', 'agentPageCapture', 'agentPageStructure',
      'agentPageInput', 'agentPageDiagnostics', 'agentAnnotations', 'agentBrowserHost',
      'agentCdpSession', 'agentCursor', 'agentObservation', 'agentLivePreview',
    ].map((name) => path.join(root, 'electron/browser', name + '.ts').replace(/\\/gu, '/'))
    await writeFile(path.join(directory, 'entry.ts'), entries.map((file) => 'export * from ' + JSON.stringify(file)).join('\n'))
    await build({
      entryPoints: [path.join(directory, 'entry.ts')],
      outfile: path.join(directory, 'agentBundle.cjs'),
      platform: 'node', bundle: true, format: 'cjs',
      external: ['electron'],
    })
    assert.doesNotMatch(await readFile(path.join(directory, 'agentBundle.cjs'), 'utf8'),
      /(?:require|import)\(["']sharp["']\)/u, 'native image addons must not be required by the main-process bundle')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(require('electron'), [
      path.join(root, 'tests/components/browser/fixtures/browserAgentIsolated.electron.cjs'), directory,
    ], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data) => { output += data.toString() })
    child.stderr.on('data', (data) => { output += data.toString() })
    const timeout = setTimeout(() => child.kill(), 40000)
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    }).finally(() => clearTimeout(timeout))
    assert.equal(exitCode, 0, 'Electron output: ' + output)
    assert.match(output, /BROWSER_ISOLATION_PASS/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
