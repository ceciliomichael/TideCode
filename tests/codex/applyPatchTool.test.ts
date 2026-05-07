import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyPatchInWorkspace, parseApplyPatch } from '../../electron/chat/shared/applyPatch'
import { createAgentTools } from '../../electron/chat/shared/tools'

async function withHttpServer(
  handler: Parameters<typeof createServer>[0],
  fn: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('failed to start local http server')
  }

  try {
    await fn(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

test('parseApplyPatch reads add and update hunks', () => {
  const parsed = parseApplyPatch(`*** Begin Patch
*** Add File: src/new.ts
+export const value = 1
*** Update File: src/existing.ts
@@
-old
+new
*** End Patch`)

  assert.equal(parsed.hunks.length, 2)
  assert.equal(parsed.hunks[0]?.type, 'add')
  assert.equal(parsed.hunks[1]?.type, 'update')
})

test('parseApplyPatch accepts heredoc-wrapped patch text', () => {
  const wrappedWithCat = parseApplyPatch(`cat <<'EOF'
*** Begin Patch
*** Add File: src/cat.txt
+cat
*** End Patch
EOF`)
  assert.equal(wrappedWithCat.hunks.length, 1)
  assert.equal(wrappedWithCat.hunks[0]?.type, 'add')

  const wrappedRaw = parseApplyPatch(`<<PATCH
*** Begin Patch
*** Add File: src/raw.txt
+raw
*** End Patch
PATCH`)
  assert.equal(wrappedRaw.hunks.length, 1)
  assert.equal(wrappedRaw.hunks[0]?.type, 'add')
})

test('parseApplyPatch accepts Codex-style applypatch heredoc wrapper', () => {
  const parsed = parseApplyPatch(`applypatch <<'PATCH'
*** Begin Patch
*** Add File: src/alias.txt
+alias
*** End Patch
PATCH`)

  assert.equal(parsed.hunks.length, 1)
  assert.equal(parsed.hunks[0]?.type, 'add')
})

test('parseApplyPatch accepts first update chunk without explicit context marker', () => {
  const parsed = parseApplyPatch(`*** Begin Patch
*** Update File: src/existing.ts
 import value from './value'
+import other from './other'
*** End Patch`)

  assert.deepEqual(parsed.hunks, [
    {
      chunks: [
        {
          newLines: ["import value from './value'", "import other from './other'"],
          oldLines: ["import value from './value'"],
        },
      ],
      path: 'src/existing.ts',
      type: 'update',
    },
  ])
})

test('parseApplyPatch preserves bare empty lines in update hunks as context', () => {
  const parsed = parseApplyPatch(`*** Begin Patch
*** Update File: file.txt
@@
 before

 after
*** End Patch`)

  assert.deepEqual(parsed.hunks, [
    {
      chunks: [
        {
          newLines: ['before', '', 'after'],
          oldLines: ['before', '', 'after'],
        },
      ],
      path: 'file.txt',
      type: 'update',
    },
  ])
})

test('applyPatchInWorkspace rejects stale update hunks instead of re-anchoring them', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-reanchor-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'accountService.ts')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(
    targetFilePath,
    [
      "import * as fs from 'node:fs/promises';",
      "import * as path from 'node:path';",
      "import {",
      '\tACCOUNTS_DIR,',
      '\tAUTH_FILE_PATHS,',
      '\tCODEX_AUTH_FILE_PATH,',
      '\tdecodeIdTokenClaims,',
      '\tWORKSPACE_AUTH_FILE_PATH,',
      '\tdeleteAuthJsonFile,',
      '\treadAuthJsonFile,',
      '\twriteAuthJsonFile',
      "} from './authService';",
      '',
      'function isStoredCodexAuthFile(candidate: unknown) {',
      '  return Boolean(candidate)',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  try {
    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        `*** Begin Patch
*** Update File: ${targetFilePath}
@@
 import * as fs from 'node:fs/promises';
+import { createHash } from 'node:crypto';
 import * as path from 'node:path';
 import {
 \tACCOUNTS_DIR,
 \tAUTH_FILE_PATHS,
 \tCODEX_AUTH_FILE_PATH,
+\tdecodeIdTokenClaims,
 \tWORKSPACE_AUTH_FILE_PATH,
 \tdeleteAuthJsonFile,
 \treadAuthJsonFile,
 \twriteAuthJsonFile
 } from './authService';
*** End Patch`,
      ),
      /Failed to find expected lines in src[/\\]accountService\.ts/u,
    )

    assert.equal(
      await fs.readFile(targetFilePath, 'utf8'),
      [
        "import * as fs from 'node:fs/promises';",
        "import * as path from 'node:path';",
        "import {",
        '\tACCOUNTS_DIR,',
        '\tAUTH_FILE_PATHS,',
        '\tCODEX_AUTH_FILE_PATH,',
        '\tdecodeIdTokenClaims,',
        '\tWORKSPACE_AUTH_FILE_PATH,',
        '\tdeleteAuthJsonFile,',
        '\treadAuthJsonFile,',
        '\twriteAuthJsonFile',
        "} from './authService';",
        '',
        'function isStoredCodexAuthFile(candidate: unknown) {',
        '  return Boolean(candidate)',
        '}',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace rejects accidental line-wrap differences in hunk context', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-wrap-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'footer.tsx')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(
    targetFilePath,
    [
      '<footer className="rounded-2xl border border-[#F0F2F6] bg-white p-6 shadow-sm">',
      '<p className="mt-4 text-sm leading-6 text-[#606266]">',
      'A simple landing page structure for products that need a',
      'confident first impression.',
      '</p>',
      '</footer>',
      '',
    ].join('\n'),
    'utf8',
  )

  try {
    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        `*** Begin Patch
*** Update File: ${targetFilePath}
@@
 <footer className="rounded-2xl border border-[#F0F2F6] bg-white p-6 shadow-sm">
 <p className="mt-4 text-sm leading-6 text-[#606266]">
 A simple landing page structure for products that need a confident
 first impression.
 </p>
*** End Patch`,
      ),
      /Failed to find expected lines in src[/\\]footer\.tsx/u,
    )

    assert.equal(
      await fs.readFile(targetFilePath, 'utf8'),
      [
        '<footer className="rounded-2xl border border-[#F0F2F6] bg-white p-6 shadow-sm">',
        '<p className="mt-4 text-sm leading-6 text-[#606266]">',
        'A simple landing page structure for products that need a',
        'confident first impression.',
        '</p>',
        '</footer>',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace rejects update patches that do not change file content', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-noop-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'same.ts')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(targetFilePath, 'alpha\nbeta\n', 'utf8')

  try {
    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        `*** Begin Patch
*** Update File: src/same.ts
@@
 alpha
 beta
*** End Patch`,
      ),
      /Patch did not change src[/\\]same\.ts/u,
    )

    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'alpha\nbeta\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace rejects line-ending-only update patches', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-eol-noop-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'same-crlf.ts')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(targetFilePath, 'alpha\r\nbeta\r\n', 'utf8')

  try {
    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        `*** Begin Patch
*** Update File: src/same-crlf.ts
@@
 alpha
 beta
*** End Patch`,
      ),
      /Patch did not change src[/\\]same-crlf\.ts/u,
    )

    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'alpha\r\nbeta\r\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace matches CRLF files using LF patch text and writes LF', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-crlf-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'RouteTable.tsx')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(
    targetFilePath,
    [
      'import { SegmentedField } from "../../components/SegmentedField";',
      'import {',
      '  getRouteOwnerFilterStorageKey,',
      '} from "./routeTablePreferences";',
      '',
    ].join('\r\n'),
    'utf8',
  )

  try {
    const result = await applyPatchInWorkspace(
      workspaceRootPath,
      `*** Begin Patch
*** Update File: src/RouteTable.tsx
@@
 import { SegmentedField } from "../../components/SegmentedField";
 import {
   getRouteOwnerFilterStorageKey,
+  ROUTE_OWNER_FILTER_ALL,
 } from "./routeTablePreferences";
*** End Patch`,
    )

    assert.equal(result.changes.length, 1)
    assert.equal(
      await fs.readFile(targetFilePath, 'utf8'),
      [
        'import { SegmentedField } from "../../components/SegmentedField";',
        'import {',
        '  getRouteOwnerFilterStorageKey,',
        '  ROUTE_OWNER_FILTER_ALL,',
        '} from "./routeTablePreferences";',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace normalizes mixed line endings around an insertion to LF', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-mixed-eol-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'mixed.txt')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(targetFilePath, 'alpha\r\nbeta\ngamma\r\ndelta\n', 'utf8')

  try {
    const result = await applyPatchInWorkspace(
      workspaceRootPath,
      `*** Begin Patch
*** Update File: src/mixed.txt
@@
 beta
+inserted
 gamma
*** End Patch`,
    )

    assert.equal(result.changes.length, 1)
    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'alpha\nbeta\ninserted\ngamma\ndelta\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace still rejects tab and space mismatches after line-ending normalization', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-tabs-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'tabs.ts')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(targetFilePath, 'function value() {\r\n\treturn 1\r\n}\r\n', 'utf8')

  try {
    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        `*** Begin Patch
*** Update File: src/tabs.ts
@@
 function value() {
   return 1
 }
*** End Patch`,
      ),
      /Failed to find expected lines in src[/\\]tabs\.ts/u,
    )

    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'function value() {\r\n\treturn 1\r\n}\r\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace does not write earlier hunks when a later hunk fails', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-atomic-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'existing.ts')
  const createdFilePath = path.join(workspaceRootPath, 'src', 'created.ts')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(targetFilePath, 'alpha\nbeta\n', 'utf8')

  try {
    const beforeChanges: Array<{ absolutePath: string; nextAbsolutePath?: string }> = []

    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        `*** Begin Patch
*** Add File: src/created.ts
+export const created = true;
*** Update File: src/existing.ts
@@
 missing
+replacement
*** End Patch`,
        {
          onBeforeChange: (input) => {
            beforeChanges.push(input)
          },
        },
      ),
      /Failed to find expected lines in src[/\\]existing\.ts/u,
    )

    await assert.rejects(fs.readFile(createdFilePath, 'utf8'))
    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'alpha\nbeta\n')
    assert.deepEqual(beforeChanges, [])
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace applies add, update, move, and delete operations', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-'))
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'existing.ts'), 'alpha\nbeta\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'remove.ts'), 'remove me\n', 'utf8')

  try {
    const result = await applyPatchInWorkspace(
      workspaceRootPath,
      `*** Begin Patch
*** Add File: src/new.ts
+export const created = true;
*** Update File: src/existing.ts
*** Move to: src/renamed.ts
@@
 alpha
-beta
+gamma
*** Delete File: src/remove.ts
*** End Patch`,
    )

    assert.equal(result.changes.length, 3)
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'src', 'new.ts'), 'utf8'), 'export const created = true;\n')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'src', 'renamed.ts'), 'utf8'), 'alpha\ngamma\n')
    await assert.rejects(fs.readFile(path.join(workspaceRootPath, 'src', 'existing.ts'), 'utf8'))
    await assert.rejects(fs.readFile(path.join(workspaceRootPath, 'src', 'remove.ts'), 'utf8'))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace reports each path before mutation for checkpoint capture', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-capture-'))
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'existing.ts'), 'alpha\nbeta\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'target.ts'), 'old target\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'remove.ts'), 'remove me\n', 'utf8')

  try {
    const beforeChanges: Array<{ absolutePath: string; nextAbsolutePath?: string }> = []

    await applyPatchInWorkspace(
      workspaceRootPath,
      `*** Begin Patch
*** Add File: src/new.ts
+export const created = true;
*** Update File: src/existing.ts
*** Move to: src/target.ts
@@
 alpha
-beta
+gamma
*** Delete File: src/remove.ts
*** End Patch`,
      {
        onBeforeChange: (input) => {
          beforeChanges.push(input)
        },
      },
    )

    assert.deepEqual(beforeChanges, [
      {
        absolutePath: path.join(workspaceRootPath, 'src', 'new.ts'),
      },
      {
        absolutePath: path.join(workspaceRootPath, 'src', 'existing.ts'),
        nextAbsolutePath: path.join(workspaceRootPath, 'src', 'target.ts'),
      },
      {
        absolutePath: path.join(workspaceRootPath, 'src', 'remove.ts'),
      },
    ])
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools omits write tools in plan mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'plan',
      },
    )

    assert.ok('list' in tools)
    assert.ok('read' in tools)
    assert.ok(!('write' in tools))
    assert.ok(!('apply_patch' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools exposes write tools in agent mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools({
      workspaceRootPath,
    }, {
      chatMode: 'agent',
    })

    assert.ok('write' in tools)
    assert.ok('apply_patch' in tools)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools exposes Codex apply_patch as a grammar-backed freeform tool', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
        providerId: 'codex',
      },
    )

    const applyPatchTool = tools.apply_patch as {
      args?: { format?: { definition?: string; syntax?: string; type?: string }; name?: string }
      type?: string
    }

    assert.equal(applyPatchTool.type, 'provider')
    assert.equal(applyPatchTool.args?.name, 'apply_patch')
    assert.equal(applyPatchTool.args?.format?.type, 'grammar')
    assert.equal(applyPatchTool.args?.format?.syntax, 'lark')
    assert.match(applyPatchTool.args?.format?.definition ?? '', /start: begin_patch hunk\+ end_patch/u)
    assert.match(applyPatchTool.args?.description ?? '', /latest read is the source of truth/u)
    assert.match(applyPatchTool.args?.description ?? '', /LF line endings/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools exposes Codex web_search as a provider tool', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
        providerId: 'codex',
      },
    )

    const webSearchTool = tools.web_search as { id?: string; type?: string }

    assert.equal(webSearchTool.type, 'provider')
    assert.equal(webSearchTool.id, 'openai.web_search')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools exposes webfetch for non-Codex providers', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
        providerId: 'openai-compatible',
      },
    )

    assert.ok('webfetch' in tools)
    assert.ok(!('web_search' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('webfetch fetches and normalizes HTML content', async () => {
  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<html><body><h1>Hello</h1><p>World</p><a href="https://example.com">Link</a></body></html>')
    },
    async (baseUrl) => {
      const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

      try {
        const tools = await createAgentTools(
          {
            workspaceRootPath,
          },
          {
            chatMode: 'agent',
            providerId: 'openai-compatible',
          },
        )

        const webfetchTool = tools.webfetch as {
          execute: (input: { format?: string; timeout?: number; url: string }) => Promise<{
            body?: string
            status: 'error' | 'success'
            summary: string
          }>
        }

        const result = await webfetchTool.execute({
          format: 'markdown',
          url: `${baseUrl}/docs`,
        })

        assert.equal(result.status, 'success')
        assert.match(result.summary, /Fetched http:\/\/127\.0\.0\.1:/u)
        assert.match(result.body ?? '', /Hello/u)
        assert.match(result.body ?? '', /World/u)
        assert.match(result.body ?? '', /Link \(https:\/\/example\.com\)/u)
      } finally {
        await fs.rm(workspaceRootPath, { force: true, recursive: true })
      }
    },
  )
})

test('createAgentTools keeps JSON apply_patch fallback for non-Codex providers', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
        providerId: 'openai-compatible',
      },
    )

    const applyPatchTool = tools.apply_patch as {
      description?: string
      inputSchema?: unknown
      type?: string
    }

    assert.notEqual(applyPatchTool.type, 'provider')
    assert.ok(applyPatchTool.inputSchema)
    assert.match(applyPatchTool.description ?? '', /structured patch/u)
    assert.ok(!('web_search' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools describes grep as a file-or-directory scoped workspace search', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools({
      workspaceRootPath,
    }, {
      chatMode: 'agent',
    })

    assert.ok('grep' in tools)
    const grepTool = tools.grep as { description?: string }

    assert.match(grepTool.description ?? '', /Search file contents in visible workspace files/u)
    assert.match(grepTool.description ?? '', /read the matching files with `read`/u)
    assert.match(grepTool.description ?? '', /Treat grep results as hints, not full context/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools keeps plan mode descriptions on discovery-only tools', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'plan',
      },
    )

    const listTool = tools.list as { description?: string }
    const readTool = tools.read as { description?: string }
    const globTool = tools.glob as { description?: string }
    const grepTool = tools.grep as { description?: string }

    assert.match(listTool.description ?? '', /Use `read` after you find a file/u)
    assert.match(readTool.description ?? '', /Do not guess paths/u)
    assert.match(globTool.description ?? '', /Read the matched files with `read` before editing/u)
    assert.match(grepTool.description ?? '', /read the matching files with `read`/u)
    assert.doesNotMatch(readTool.description ?? '', /apply_patch|write/u)
    assert.doesNotMatch(grepTool.description ?? '', /apply_patch|write/u)
    assert.ok(!('write' in tools))
    assert.ok(!('apply_patch' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools describes read and apply_patch with exact path guidance', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
      },
    )

    assert.ok('read' in tools)
    assert.ok('apply_patch' in tools)
    assert.ok('write' in tools)

    const readTool = tools.read as { description?: string }
    const globTool = tools.glob as { description?: string }
    const grepTool = tools.grep as { description?: string }
    const applyPatchTool = tools.apply_patch as { description?: string }
    const writeTool = tools.write as { description?: string }

    assert.match(readTool.description ?? '', /Do not guess paths/u)
    assert.match(readTool.description ?? '', /The latest read is the source of truth for edits/u)
    assert.match(readTool.description ?? '', /After reading, use `apply_patch` for small edits or `write` for a full replacement/u)
    assert.match(applyPatchTool.description ?? '', /workspace-relative file paths like `src\/app\.ts`/u)
    assert.match(applyPatchTool.description ?? '', /Use `write` only when you need to replace a whole file/u)
    assert.match(applyPatchTool.description ?? '', /Do not use guessed paths/u)
    assert.match(applyPatchTool.description ?? '', /Patch only exact text from that read/u)
    assert.match(applyPatchTool.description ?? '', /The latest read is the source of truth/u)
    assert.match(applyPatchTool.description ?? '', /LF line endings/u)
    assert.match(applyPatchTool.description ?? '', /Order update hunks from top to bottom/u)
    assert.match(applyPatchTool.description ?? '', /grep results are only location hints/u)
    assert.match(globTool.description ?? '', /Read the matched files with `read` before editing/u)
    assert.match(grepTool.description ?? '', /After reading the target file, use `apply_patch`/u)
    assert.match(writeTool.description ?? '', /For small edits to an existing file, use `apply_patch` instead/u)
    assert.match(writeTool.description ?? '', /Do not call write when the target already has identical content/u)
    assert.match(writeTool.description ?? '', /LF line endings/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
