import { mkdir, mkdtemp, writeFile, access, symlink, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import net from 'node:net'

const require = createRequire(import.meta.url)
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createPdfFixture(pageCount = 12) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>'),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`
}

const resourceScenarioModule = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspacePdfPreviewView } from '/src/components/workspaceExplorer/workspacePdfPreview/WorkspacePdfPreviewView.tsx';
import { preloadWorkspaceMonacoRuntime } from '/src/lib/workspaceMonacoPreload.ts';
import { getShikiRuntime } from '/src/lib/shikiRuntime.ts';
let pdfRoot, pdfContainer;
export function mountPdf(dataUrl) {
  pdfContainer = document.createElement('div');
  Object.assign(pdfContainer.style, { position: 'fixed', inset: '40px', zIndex: '9999', background: 'white' });
  document.body.append(pdfContainer);
  pdfRoot = createRoot(pdfContainer);
  pdfRoot.render(React.createElement(WorkspacePdfPreviewView, { fileName: 'fixture.pdf', previewDataUrl: dataUrl, relativePath: 'fixture.pdf', tabKey: 'memory-fixture' }));
}
export function scrollPdf() {
  const viewport = pdfContainer.querySelector('.workspace-pdf-preview .overflow-auto');
  viewport.scrollTop = viewport.scrollHeight;
}
export function unmountPdf() {
  pdfRoot.unmount(); pdfContainer.remove(); pdfRoot = null; pdfContainer = null;
}
export async function exerciseMonaco() {
  const monaco = await preloadWorkspaceMonacoRuntime();
  const container = document.createElement('div');
  Object.assign(container.style, { position: 'fixed', inset: '40px', zIndex: '9999' });
  document.body.append(container);
  const model = monaco.editor.createModel('export const answer: number = 42', 'typescript');
  const editor = monaco.editor.create(container, { model, theme: 'tidecode-dark' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const highlighter = await getShikiRuntime();
  const languages = highlighter.getLoadedLanguages();
  const tokens = monaco.editor.tokenize(model.getValue(), 'typescript');
  highlighter.codeToTokens(model.getValue(), { lang: 'typescript', theme: 'github-light-default' });
  const tokensAfterChatHighlight = monaco.editor.tokenize(model.getValue(), 'typescript');
  const themePreserved = JSON.stringify(tokens) === JSON.stringify(tokensAfterChatHighlight);
  editor.dispose(); model.dispose(); container.remove();
  return { languages, tokens, themePreserved };
}
`

if (!process.versions.electron) {
  const root = path.resolve(option('--root', workspace))
  const mode = option('--mode', 'built')
  if (!['built', 'dev'].includes(mode)) {
    throw new Error('--mode must be built or dev')
  }
  if (args.includes('--resources') && mode !== 'dev') {
    throw new Error('--resources requires --mode dev to exercise source components')
  }
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'tidecode-memory-profile-'))
  const home = path.join(fixture, 'home')
  const appData = path.join(fixture, 'app-data')
  const history = path.join(home, '.tidecode', 'history')
  await mkdir(history, { recursive: true })
  await mkdir(appData, { recursive: true })
  await writeFile(path.join(fixture, 'pdf-data-url.txt'), createPdfFixture())
  const historyMiB = Number(option('--history-mib', '32'))
  if (!Number.isFinite(historyMiB) || historyMiB < 0 || historyMiB > 256) {
    throw new Error('--history-mib must be between 0 and 256')
  }
  const content = 'Synthetic profiling transcript.\n'.repeat(Math.ceil(historyMiB * 1024 * 1024 / 32 / 32))
  for (let index = 0; index < 32; index += 1) {
    await writeFile(path.join(history, `profile-${index}.json`), JSON.stringify({
      agentContextRootPath: home, chatMode: 'agent', createdAt: index + 1,
      folderId: null, id: `profile-${index}`, title: `Memory fixture ${index}`,
      updatedAt: index + 1,
      messages: [{ content, id: `message-${index}`, role: 'user', timestamp: index + 1, reasoningEffort: 'minimal' }],
    }))
  }
  if (root !== workspace) {
    try {
      await access(path.join(root, 'node_modules'))
    } catch {
      await symlink(path.join(workspace, 'node_modules'), path.join(root, 'node_modules'), 'junction')
    }
  }
  let server
  let devUrl = ''
  if (mode === 'dev') {
    const [{ createServer }, { default: react }, { default: tailwindcss }] = await Promise.all([
      import('vite'), import('@vitejs/plugin-react'), import('@tailwindcss/vite'),
    ])
    server = await createServer({
      root, configFile: false, plugins: [react(), tailwindcss(), {
        name: 'tidecode-memory-scenario',
        resolveId: (id) => id === '/__memory-profile' ? '\0memory-profile' : undefined,
        load: (id) => id === '\0memory-profile' ? resourceScenarioModule : undefined,
      }],
      resolve: { alias: [{
        find: /^monaco-editor\/esm\/vs\/language\/typescript\/ts\.worker(?:\.js)?$/,
        replacement: path.join(root, 'src/components/workspaceExplorer/workspaceFileEditor/workspaceTypeScript.worker.js'),
      }] },
      server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/dist*/**', '**/release/**', '**/build/**'] } },
    })
    await server.listen()
    devUrl = server.resolvedUrls.local[0]
  }
  const env = {
    ...process.env, USERPROFILE: home, HOME: home,
    TIDECODE_RUN_SERVICE_NAMESPACE: `profile-${path.basename(fixture).slice(-6)}`,
    TIDECODE_RUN_SERVICE_ENTRY: path.join(root, 'dist-cli-runtime/run-service.mjs'),
    TIDECODE_RUN_SERVICE_RUNTIME_ROOT: path.join(root, 'dist-cli-runtime'),
  }
  const portProbe = net.createServer()
  await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
  env.TIDECODE_REMOTE_PORT = String(portProbe.address().port)
  await new Promise((resolve) => portProbe.close(resolve))
  delete env.ELECTRON_RUN_AS_NODE
  delete env.TIDECODE_SETTINGS_HOME
  delete env.VITE_DEV_SERVER_URL
  if (devUrl) {
    env.VITE_DEV_SERVER_URL = devUrl
  }
  const child = spawn(require('electron'), [fileURLToPath(import.meta.url), '--electron',
    '--root', root, '--fixture', fixture, '--mode', mode,
    '--seconds', option('--seconds', '40'),
    '--recovery-seconds', option('--recovery-seconds', '30'),
    ...(args.includes('--resources') ? ['--resources'] : []),
  ], { env, windowsHide: true, stdio: 'inherit' })
  const driverSamples = []
  const driverTimer = setInterval(() => {
    driverSamples.push({ elapsedMs: Date.now(), ...process.memoryUsage() })
  }, 2_000)
  child.on('error', (error) => { console.error(error); process.exitCode = 1 })
  const code = await new Promise((resolve) => child.on('exit', resolve))
  clearInterval(driverTimer)
  const reportPath = path.join(fixture, 'report.json')
  let scenarioFailed = false
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    scenarioFailed = report.failures.length > 0
    report.driverSamples = driverSamples
    report.driverNote = mode === 'dev' ? 'The driver hosts Vite; its RSS is separate from Electron app memory.' : 'The driver is profiling overhead and is separate from Electron app memory.'
    await writeFile(reportPath, JSON.stringify(report, null, 2))
  } catch (error) {
    scenarioFailed = true
    console.error('Unable to append profiling driver measurements', error)
  }
  await server?.close()
  process.exitCode = scenarioFailed ? 1 : code ?? 1
} else {
  // Electron waits for its entry module to finish before firing ready. Keep the
  // asynchronous scenario outside top-level await to avoid blocking that event.
  void (async () => {
  console.log('Starting isolated Electron memory profile')
  const { app, BrowserWindow, webContents } = await import('electron')
  app.commandLine.appendSwitch('enable-precise-memory-info')
  const fixture = option('--fixture')
  const root = option('--root')
  app.setName(`TideCode memory profile ${path.basename(fixture).slice(-6)}`)
  app.setPath('home', path.join(fixture, 'home'))
  app.setPath('appData', path.join(fixture, 'app-data'))
  app.setPath('userData', path.join(fixture, 'app-data', 'profile'))
  const samples = []
  const failures = []
  const resourceChecks = []
  const startedAt = Date.now()
  async function sample(phase) {
    const processes = app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, ...memory }))
    const renderers = []
    for (const contents of webContents.getAllWebContents()) {
      if (contents.getType() !== 'window' || contents.isDestroyed()) {
        continue
      }
      try {
        const renderer = await contents.executeJavaScript(`({
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
          domNodes: document.getElementsByTagName('*').length,
          canvasPixels: Array.from(document.querySelectorAll('canvas')).reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
          pdf: (() => {
            const viewport = document.querySelector('.workspace-pdf-preview .overflow-auto');
            return viewport ? {
              height: viewport.clientHeight, width: viewport.clientWidth,
              canvases: Array.from(viewport.querySelectorAll('canvas')).map(canvas => ({ width: canvas.width, height: canvas.height, top: canvas.getBoundingClientRect().top })),
              text: viewport.textContent.slice(0, 300),
            } : null;
          })(),
        })`)
        if (!contents.debugger.isAttached()) {
          contents.debugger.attach('1.3')
        }
        const { targetInfos } = await contents.debugger.sendCommand('Target.getTargets')
        const workerCount = targetInfos.filter((target) => ['worker', 'shared_worker', 'service_worker'].includes(target.type)).length
        renderers.push({ pid: contents.getOSProcessId(), workerCount, ...renderer })
      } catch {
        // A window can close between enumeration and sampling.
      }
    }
    const value = { phase, elapsedMs: Date.now() - startedAt, processes, renderers, main: process.memoryUsage() }
    samples.push(value)
    console.log(JSON.stringify(value))
    return value
  }
  try {
    console.log('Loading built application')
    await import(pathToFileURL(path.join(root, 'dist-electron/main.js')).href)
    console.log('Waiting for application ready')
    await app.whenReady()
    let mainWindow
    for (let attempt = 0; attempt < 100; attempt += 1) {
      mainWindow = BrowserWindow.getAllWindows().find((window) => window.getBounds().width > 500)
      if (mainWindow && !mainWindow.webContents.isLoading()) {
        break
      }
      await wait(200)
    }
    if (!mainWindow) {
      throw new Error('The application window did not start')
    }
    await wait(5_000)
    const seconds = Number(option('--seconds', '40'))
    await sample('startup')
    for (let index = 0; index < Math.ceil(seconds / 2); index += 1) {
      await wait(2_000)
      await sample('idle')
    }
    for (let index = 0; index < 3; index += 1) {
      await mainWindow.webContents.executeJavaScript('window.tidecodeHistory.listConversations().then(result => result.length)')
      await sample('history-list')
    }
    for (let index = 0; index < 12; index += 1) {
      const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
        const target = Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Memory fixture ${index}'));
        target?.click(); return Boolean(target);
      })()`)
      if (!clicked) {
        failures.push(`Chat fixture ${index} was not found in the visible sidebar`)
        break
      }
      await wait(500)
      await sample('chat-switch')
    }
    for (let index = 0; index < Math.ceil(Number(option('--recovery-seconds', '30')) / 2); index += 1) {
      await wait(2_000)
      await sample('recovery')
    }
    if (args.includes('--resources') && option('--mode') === 'dev') {
      const contents = mainWindow.webContents
      const dataUrl = await readFile(path.join(fixture, 'pdf-data-url.txt'), 'utf8')
      for (let index = 0; index < 3; index += 1) {
        await contents.executeJavaScript(`import('/__memory-profile').then(module => module.mountPdf(${JSON.stringify(dataUrl)}))`)
        await wait(3_000)
        const open = await sample('pdf-open')
        const pdfRenderer = open.renderers.find((renderer) => renderer.pdf)
        if (!pdfRenderer || pdfRenderer.canvasPixels === 0 || pdfRenderer.canvasPixels > 12 * 1024 * 1024) {
          failures.push('PDF viewport rendering did not produce a bounded visible canvas')
        }
        await contents.executeJavaScript("import('/__memory-profile').then(module => module.scrollPdf())")
        await wait(1_000)
        await sample('pdf-scroll')
        await contents.executeJavaScript("import('/__memory-profile').then(module => module.unmountPdf())")
        await wait(2_000)
        const closed = await sample('pdf-close')
        resourceChecks.push({ phase: 'pdf-release', iteration: index, workerCounts: closed.renderers.map((renderer) => renderer.workerCount) })
        if (closed.renderers.some((renderer) => renderer.pdf || renderer.canvasPixels > 0 || renderer.workerCount > 0)) {
          failures.push('PDF close left a canvas or worker alive')
        }
      }
      const monaco = await contents.executeJavaScript("import('/__memory-profile').then(module => module.exerciseMonaco())")
      console.log(JSON.stringify({ phase: 'monaco-languages', ...monaco }))
      resourceChecks.push({ phase: 'monaco-languages', ...monaco })
      if (monaco.languages.includes('python') || !monaco.languages.includes('typescript')) {
        failures.push('Monaco language grammars were not loaded on demand')
      }
      if (!monaco.themePreserved) {
        failures.push('Chat highlighting changed Monaco syntax token colors')
      }
      await sample('monaco-close')
    }
  } catch (error) {
    failures.push(error.stack ?? String(error))
    process.exitCode = 1
  } finally {
    const report = { mode: option('--mode'), root, fixture, samples, failures, resourceChecks,
      note: 'Electron child process metrics are KiB; JS heap and main process memory are bytes. Built mode uses the built renderer in an unpackaged isolated Electron host. No forced GC.' }
    await writeFile(path.join(fixture, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`Memory report: ${path.join(fixture, 'report.json')}`)
    // This scenario only reads history and selects chats. It never starts an AI
    // run or terminal, so no detached profiling service needs to be shut down.
    app.quit()
  }
  })().catch((error) => { console.error(error); process.exit(1) })
}
