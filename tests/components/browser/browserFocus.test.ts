import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '../../..')

// Native focus checks open a real desktop window. Keep them explicitly opt-in
// so ordinary test runs never interrupt someone using their desktop.
test('Electron Browser keeps native focus through page load and accepts intentional page clicks', {
  timeout: 60000,
  skip: process.env.TIDECODE_RUN_NATIVE_BROWSER_TESTS !== '1',
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tidecode-browser-focus-'))
  try {
    await build({
      stdin: {
        contents: `
          import React from 'react'
          import { createRoot } from 'react-dom/client'
          import { BrowserPanel } from './src/components/browser/BrowserPanel'
          const { ipcRenderer } = require('electron')
          window.tidecodeBrowserDevTools = {
            open: (input) => ipcRenderer.invoke('open-devtools', input),
            close: async () => true,
            setVisible: async () => true,
            updateBounds: async () => true,
            onClosed: () => () => {},
            onShortcut: () => () => {},
            showDockMenu: async () => null,
          }
          createRoot(document.getElementById('root')).render(
            <BrowserPanel active={true} onClose={() => {}} projectKey="focus-regression" />
          )
        `,
        resolveDir: projectRoot,
        loader: 'tsx',
      },
      outfile: path.join(directory, 'renderer.js'),
      bundle: true,
      platform: 'browser',
      external: ['electron'],
      jsx: 'automatic',
      define: { 'import.meta.env.BASE_URL': '"/"' },
    })
    const applicationWindowSource = await readFile(path.join(projectRoot, 'electron/window/createApplicationWindow.ts'), 'utf8')
    const guestScript = applicationWindowSource.match(/const EMBEDDED_BROWSER_POINTER_FOCUS_SCRIPT = `([\s\S]*?)`/)
    assert.ok(guestScript)
    assert.match(applicationWindowSource, /executeJavaScript\(EMBEDDED_BROWSER_POINTER_FOCUS_SCRIPT, false\)/)
    await writeFile(path.join(directory, 'guest-script.json'), JSON.stringify(guestScript[1]))
    await writeFile(path.join(directory, 'index.html'), `
      <html><head><style>
        body { margin: 0; }
        input[aria-label="Search or enter address"] { position: fixed; top: 50px; left: 50px; width: 500px; height: 30px; }
        webview { position: fixed; top: 150px; left: 0; width: 600px !important; height: 300px !important; }
        [aria-label="Browser DevTools"] { position: fixed; top: 150px; left: 620px; width: 250px; height: 300px; }
        div.absolute.left-0.top-0 { position: fixed; top: 150px; left: 0; width: 600px; height: 300px; }
      </style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>
    `)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    for (const mode of ['fixed', 'warmup']) {
      const child = spawn(require('electron'), [path.join(import.meta.dirname, 'fixtures/browserFocus.electron.cjs'), directory, mode], {
        env: environment,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        output += chunk.toString()
      })
      const timeout = setTimeout(() => child.kill(), 20000)
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
      }).finally(() => clearTimeout(timeout))
      if (mode === 'fixed') {
        assert.equal(exitCode, 0, output)
        assert.match(output, /BROWSER_FOCUS_PASS/)
      } else {
        assert.equal(exitCode, 1, output)
        assert.match(output, /Native host focus lost/)
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
