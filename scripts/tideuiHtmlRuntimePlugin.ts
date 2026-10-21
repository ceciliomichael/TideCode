import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import type { Plugin } from 'vite'

export async function buildTideHtmlRuntime(root: string) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/components/tideui/html/TideUIHtmlRuntime.tsx'],
    bundle: true,
    write: false,
    metafile: true,
    outfile: 'tideui-html-runtime.js',
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    minify: true,
    // The optional HTML-widget runtime bundles its own preview component.
    // That component imports a local font as an inline asset; esbuild does not
    // inherit Vite's asset loader for this independent nested bundle.
    loader: { '.woff2': 'dataurl', '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const dependencies = [...new Set(Object.keys(result.metafile.inputs)
    .filter(file => file.startsWith('src/'))
    .map(file => file.split('?')[0]))]
  const inputs = await Promise.all(dependencies.map(async file => ({ content: await readFile(path.join(root, file), 'utf8'), extension: path.extname(file).slice(1) })))
  const scanner = new Scanner({ sources: [] })
  const appCss = await readFile(path.join(root, 'src/index.css'), 'utf8')
  const theme = appCss.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1]
  if (!theme) throw new Error('TideCode theme tokens were not found')
  const nativeCss = await readFile(path.join(root, 'src/components/tideui/tideui.css'), 'utf8')
  const compiler = await compile(`@import "tailwindcss";\n@theme {${theme}\n}\n${nativeCss}`, { base: path.join(root, 'src'), onDependency: () => {} })
  const tokens = Array.from(theme.matchAll(/(--[\w-]+)\s*:/g), match => match[1])
  const inheritTheme = `:host{display:block;${tokens.map(token => `${token}:inherit`).join(';')}}`
  return {
    script: result.outputFiles[0].text,
    styles: compiler.build(scanner.scanFiles(inputs)) + inheritTheme,
    dependencies: [...dependencies, 'src/index.css', 'src/components/tideui/tideui.css'],
  }
}

export function tideuiHtmlRuntimePlugin(): Plugin {
  const publicId = 'virtual:tideui-html-runtime'
  const virtualId = '\0' + publicId
  let root = ''
  let pending: ReturnType<typeof buildTideHtmlRuntime> | null = null
  return {
    name: 'tideui-html-runtime',
    configResolved(config) { root = config.root },
    resolveId: {
      filter: { id: /^virtual:tideui-html-runtime$/ },
      handler(id) { if (id === publicId) return virtualId },
    },
    load: {
      filter: { id: /^\0virtual:tideui-html-runtime$/ },
      async handler() {
        pending ??= buildTideHtmlRuntime(root)
        const runtime = await pending
        for (const file of runtime.dependencies) this.addWatchFile(path.join(root, file))
        return `export const script=${JSON.stringify(runtime.script)};export const styles=${JSON.stringify(runtime.styles)};`
      },
    },
    watchChange() { pending = null },
  }
}
