import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'
import type { AgentToolRegistry } from '../../electron/chat/shared/tools/registry'

function createCaptureRegistry(): AgentToolRegistry {
  const entries = [{
    description: 'Capture the provided value.',
    execute: async (input: unknown) => ({
      body: JSON.stringify(input),
      status: 'success' as const,
      summary: 'Captured input.',
    }),
    inputSchema: { type: 'object' as const },
    name: 'capture',
    namespace: 'test',
  }]

  return {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
}

test('Code Mode preserves long String.raw payload bindings with Markdown backticks', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry())
  const markdown = '# Plan\nUse `GetUserByID`; preserve ${literal} and C:\\temp\\route.\n'
  const malformedProgram = [
    'const content = String.raw\x60' + markdown + '\x60;',
    'return await tools.capture({ content });',
  ].join('\n')

  try {
    const result = await executor.run(malformedProgram, { allowedToolNames: ['capture'] })
    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.deepEqual(result.toolCalls[0]?.arguments, { content: markdown })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode repairs arbitrary payload binding names used as explicit tool values', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry())
  const markdown = '# Plan\nPlace the adapter in the existing `backend` Go module as `backend/cmd/routegate-mcp`.\n'
  const malformedProgram = [
    'const plan = \x60' + markdown + '\x60;',
    'return await tools.capture({ content: plan });',
  ].join('\n')

  try {
    const result = await executor.run(malformedProgram, { allowedToolNames: ['capture'] })
    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.deepEqual(result.toolCalls[0]?.arguments, { content: markdown })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode repairs a missing colon in a simple tool argument property', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry())

  try {
    const result = await executor.run(
      'return await tools.capture({ include "*.go", limit: 200 })',
      { allowedToolNames: ['capture'] },
    )
    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.deepEqual(result.toolCalls[0]?.arguments, { include: '*.go', limit: 200 })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode does not guess structural repairs for truncated programs', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry())

  try {
    const result = await executor.run('return { value: [1, 2')
    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /invalid JavaScript/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode sandbox allows host API words as harmless local identifiers', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "const http = { status: 200 }; const module = { kind: 'local' }; const process = 'local'; return { http: http.status, module: module.kind, process }",
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { http: 200, module: 'local', process: 'local' })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode sandbox rejects actual static module loading before tools run', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "import http from 'node:http'\nreturn await tools.capture({ request: typeof http.request })",
      { allowedToolNames: ['capture'] },
    )
    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /sandbox runtime does not allow module loading \(node:http\)/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode sandbox fails closed when module parsing rejects function-body-only syntax', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "with ({}) {}\nreturn await import('node:os');",
      { allowedToolNames: ['capture'] },
    )
    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /invalid JavaScript|module analysis|strict mode/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode Full Access lowers normal static Node imports reliably', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
  })

  try {
    const result = await executor.run(
      `import http from 'node:http'
import {
  basename as base,
  dirname
} from 'node:path'
import * as os from 'node:os'
return {
  base: base('/tmp/example.txt'),
  dir: dirname('/tmp/example.txt'),
  platform: typeof os.platform(),
  request: typeof http.request,
}`,
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, {
      base: 'example.txt',
      dir: '/tmp',
      platform: 'string',
      request: 'function',
    })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode Full Access resolves installed package imports', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
  })

  try {
    const result = await executor.run(
      `import { z } from 'zod' // normal package import
return z.object({ value: z.string() }).parse({ value: 'ok' })`,
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { value: 'ok' })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode parser accepts same-line and interleaved static imports', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
  })

  try {
    const sameLine = await executor.run("import http from 'node:http'; return typeof http.request")
    assert.equal(sameLine.status, 'success')
    assert.equal(sameLine.output, 'function')

    const interleaved = await executor.run(
      "const marker = 'before'; import { basename } from 'node:path'; return marker + ':' + basename('/tmp/example.txt')",
    )
    assert.equal(interleaved.status, 'success')
    assert.equal(interleaved.output, 'before:example.txt')
  } finally {
    await executor.dispose()
  }
})

test('Code Mode static imports are available before ordinary statements execute', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
  })

  try {
    const result = await executor.run(
      "const name = basename('/tmp/example.txt'); import { basename } from 'node:path'; return name",
    )
    assert.equal(result.status, 'success')
    assert.equal(result.output, 'example.txt')
  } finally {
    await executor.dispose()
  }
})

test('Code Mode ESM imports use import conditions while require uses CommonJS conditions', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode code mode esm conditions '))
  const packageRoot = path.join(workspaceRootPath, 'node_modules', 'conditional-package')
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
    workspaceRootPath,
  })

  try {
    await fs.mkdir(packageRoot, { recursive: true })
    await fs.writeFile(path.join(workspaceRootPath, 'package.json'), '{"name":"workspace-fixture","private":true}\n', 'utf8')
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
      name: 'conditional-package',
      exports: {
        '.': { import: './import.mjs', require: './require.cjs' },
        './feature': { import: './feature.mjs', require: './feature.cjs' },
      },
    }), 'utf8')
    await fs.writeFile(path.join(packageRoot, 'import.mjs'), "export default 'esm-import'\n", 'utf8')
    await fs.writeFile(path.join(packageRoot, 'require.cjs'), "module.exports = 'cjs-require'\n", 'utf8')
    await fs.writeFile(path.join(packageRoot, 'feature.mjs'), "export default 'esm-feature'\n", 'utf8')
    await fs.writeFile(path.join(packageRoot, 'feature.cjs'), "module.exports = 'cjs-feature'\n", 'utf8')

    const result = await executor.run(
      "import value from 'conditional-package'; import feature from 'conditional-package/feature'; const dynamicValue = await import('conditional-package'); const dynamicFeature = await import('conditional-package/feature'); const requiredValue = require('conditional-package'); const requiredFeature = require('conditional-package/feature'); return [value, feature, dynamicValue.default, dynamicFeature.default, requiredValue, requiredFeature]",
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, ['esm-import', 'esm-feature', 'esm-import', 'esm-feature', 'cjs-require', 'cjs-feature'])
  } finally {
    await executor.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode Full Access resolves static and dynamic imports from the selected workspace', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-workspace-import-'))
  const packageRoot = path.join(workspaceRootPath, 'node_modules', 'workspace-only-package')
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
    workspaceRootPath,
  })

  try {
    await fs.mkdir(packageRoot, { recursive: true })
    await fs.writeFile(path.join(workspaceRootPath, 'package.json'), '{"name":"workspace-fixture","private":true}\n', 'utf8')
    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      '{"name":"workspace-only-package","main":"index.js"}\n',
      'utf8',
    )
    await fs.writeFile(path.join(packageRoot, 'index.js'), "module.exports = { source: 'workspace-only' }\n", 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'workspace-value.mjs'), "export default 'relative-workspace'\n", 'utf8')

    const staticPackage = await executor.run(
      "import pkg from 'workspace-only-package'; import value from './workspace-value.mjs'; return [pkg.source, value]",
    )
    assert.equal(staticPackage.status, 'success')
    assert.deepEqual(staticPackage.output, ['workspace-only', 'relative-workspace'])

    const dynamicSource = 'const pkg = await ' + 'import' + "('workspace-only-package'); return pkg.default.source"
    const dynamicPackage = await executor.run(dynamicSource)
    assert.equal(dynamicPackage.status, 'success')
    assert.equal(dynamicPackage.output, 'workspace-only')
  } finally {
    await executor.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode Full Access completes native HTTP work when its Promise is awaited', async () => {
  const server = createServer((_request, response) => {
    response.end('native-http-complete')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
  })
  try {
    const result = await executor.run(
      `import http from 'node:http';
return await new Promise((resolve, reject) => {
  http.get('http://127.0.0.1:${address.port}/', (response) => {
    let body = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { body += chunk })
    response.on('end', () => resolve(body))
  }).on('error', reject)
})`,
    )
    assert.equal(result.status, 'success')
    assert.equal(result.output, 'native-http-complete')
  } finally {
    await executor.dispose()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('Code Mode sandbox rejects imports exposed by narrow repairs and nested executable positions', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const programs = [
      "const payload = { label \"x\" }; const os = await import('node:os'); return await tools.capture({ payload, platform: os.platform() })",
      "async function load() { return await import('node:os') } return typeof (await load()).platform",
      "const rendered = `platform:${typeof (await import('node:os')).platform}`; return rendered",
    ]
    for (const source of programs) {
      const result = await executor.run(source, { allowedToolNames: ['capture'] })
      assert.equal(result.status, 'error')
      assert.equal(result.toolCalls.length, 0)
      assert.match(result.summary, /sandbox runtime does not allow module loading/u)
    }
  } finally {
    await executor.dispose()
  }
})

test('Code Mode module analysis rejects additional strict-module mismatches before execution', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "const legacy = 010; const os = await import('node:os'); return legacy + typeof os.platform",
      { allowedToolNames: ['capture'] },
    )
    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /invalid JavaScript during module analysis/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode ignores import-like text in strings, comments, regexes, and repaired literal payloads', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })
  const literalPayload = "return await import('node:os') // literal `payload` only"

  try {
    const inert = await executor.run(
      `// import('node:os') is comment text
const stringValue = "import('node:os')"
const templateValue = \`import('node:os')\`
const regexValue = /import\\(/u.test(stringValue)
return { regexValue, stringValue, templateValue }`,
    )
    assert.equal(inert.status, 'success')
    assert.deepEqual(inert.output, { regexValue: true, stringValue: "import('node:os')", templateValue: "import('node:os')" })

    const malformedPayload = [
      'const content = String.raw\x60' + literalPayload + '\x60;',
      'return await tools.capture({ content });',
    ].join('\n')
    const payloadResult = await executor.run(malformedPayload, { allowedToolNames: ['capture'] })
    assert.equal(payloadResult.status, 'success')
    assert.equal(payloadResult.toolCalls.length, 1)
    assert.deepEqual(payloadResult.toolCalls[0]?.arguments, { content: literalPayload })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode workspace ESM resolution supports import-only packages, relative modules, file URLs, and clear missing-package failures', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode code mode workspace esm '))
  const packageRoot = path.join(workspaceRootPath, 'node_modules', 'import-only-package')
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
    workspaceRootPath,
  })

  try {
    await fs.mkdir(packageRoot, { recursive: true })
    await fs.writeFile(path.join(workspaceRootPath, 'package.json'), '{"name":"workspace-esm-fixture","private":true}\n', 'utf8')
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
      name: 'import-only-package',
      exports: { '.': { import: './import.mjs' } },
      type: 'module',
    }), 'utf8')
    await fs.writeFile(path.join(packageRoot, 'import.mjs'), "export default 'import-only'\n", 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'relative-esm.mjs'), "export default 'relative-esm'\n", 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'relative-cjs.cjs'), "module.exports = 'relative-cjs'\n", 'utf8')
    const fileUrl = pathToFileURL(path.join(workspaceRootPath, 'relative-esm.mjs')).href

    const result = await executor.run(
      `import only from 'import-only-package'; import relative from './relative-esm.mjs'; import fileValue from ${JSON.stringify(fileUrl)}; const dynamicOnly = await import('import-only-package'); const dynamicRelative = await import('./relative-esm.mjs'); const requiredRelative = require('./relative-cjs.cjs'); return [only, dynamicOnly.default, relative, fileValue, dynamicRelative.default, requiredRelative]`,
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, ['import-only', 'import-only', 'relative-esm', 'relative-esm', 'relative-esm', 'relative-cjs'])

    const importOnlyRequire = await executor.run("return require('import-only-package')")
    assert.equal(importOnlyRequire.status, 'error')
    assert.match(importOnlyRequire.summary, /package subpath.*not defined|No "exports" main defined|ERR_PACKAGE_PATH_NOT_EXPORTED/u)

    const missing = await executor.run("return await import('workspace-package-that-does-not-exist')")
    assert.equal(missing.status, 'error')
    assert.equal(missing.toolCalls.length, 0)
    assert.match(missing.summary, /could not resolve ES module|Cannot find package|ERR_MODULE_NOT_FOUND/u)
  } finally {
    await executor.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode static imports preserve side effects, live bindings, native forms, and nested shadowing', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-static-semantics-'))
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
    workspaceRootPath,
  })

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'package.json'), '{"name":"static-semantics","private":true,"type":"module"}\n', 'utf8')
    await fs.writeFile(
      path.join(workspaceRootPath, 'bindings.mjs'),
      "export default 'default-value'\nexport let count = 0\nexport const named = 'named-value'\nexport function increment() { count += 1 }\n",
      'utf8',
    )
    await fs.writeFile(
      path.join(workspaceRootPath, 'side-effect.mjs'),
      "globalThis.__tidecodeStaticSideEffect = (globalThis.__tidecodeStaticSideEffect ?? 0) + 1\n",
      'utf8',
    )

    const result = await executor.run(
      `const before = globalThis.__tidecodeStaticSideEffect ?? 0;
import './side-effect.mjs';
import defaultValue, { count, increment, named } from './bindings.mjs';
import * as namespace from './bindings.mjs';
increment();
const shadow = (() => { const named = 'shadow'; return named })();
await Promise.resolve();
return { before, count, defaultValue, named, namespaceNamed: namespace.named, shadow }`,
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, {
      before: 1,
      count: 1,
      defaultValue: 'default-value',
      named: 'named-value',
      namespaceNamed: 'named-value',
      shadow: 'shadow',
    })
  } finally {
    await executor.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode static imported bindings are read-only and missing exports fail before the program body', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-static-errors-'))
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
    workspaceRootPath,
  })

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'package.json'), '{"name":"static-errors","private":true,"type":"module"}\n', 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'bindings.mjs'), "export let count = 0\nexport const present = 'yes'\n", 'utf8')

    const assignment = await executor.run("import { count } from './bindings.mjs'; count = 2; return count")
    assert.equal(assignment.status, 'error')

    const missing = await executor.run(
      "import { missing } from './bindings.mjs'; return await tools.capture({ missing })",
      { allowedToolNames: ['capture'] },
    )
    assert.equal(missing.status, 'error')
    assert.equal(missing.toolCalls.length, 0)
    assert.match(missing.summary, /does not provide an export named|missing/u)
  } finally {
    await executor.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode generated dynamic-import bindings do not collide with user identifiers', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-generated-name-'))
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
    workspaceRootPath,
  })

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'package.json'), '{"name":"generated-name","private":true,"type":"module"}\n', 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'value.mjs'), "export default 'module-value'\n", 'utf8')
    const result = await executor.run(
      "const __tidecodeDynamicImport = 'user'; const __tidecodeDynamicImport1 = 'user-1'; const __tidecodeImportedModule0 = 'legacy-user'; const loaded = await import('./value.mjs'); return [__tidecodeDynamicImport, __tidecodeDynamicImport1, __tidecodeImportedModule0, loaded.default]",
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, ['user', 'user-1', 'legacy-user', 'module-value'])
  } finally {
    await executor.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode static imports preserve top-level await, return, and injected tools behavior', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-static-tools-'))
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
    workspaceRootPath,
  })

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'package.json'), '{"name":"static-tools","private":true,"type":"module"}\n', 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'value.mjs'), "export const value = 'from-module'\n", 'utf8')
    const result = await executor.run(
      "import { value } from './value.mjs'; await Promise.resolve(); const captured = await tools.capture({ value }); return captured.body",
      { allowedToolNames: ['capture'] },
    )
    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.output, '{"value":"from-module"}')
  } finally {
    await executor.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
