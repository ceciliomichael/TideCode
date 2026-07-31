import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyPatchInWorkspace, parseApplyPatch } from '../../electron/chat/shared/applyPatch'
import { createNativeAgentTools as createAgentTools } from '../../electron/chat/shared/tools'

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

test('parseApplyPatch keeps legacy XML patches compatible', () => {
  const parsed = parseApplyPatch(`<patch>
<add path="src/new.ts">
+export const value = 1
</add>
<update path="src/existing.ts">
@@
-old
+new
</update>
</patch>`)

  assert.equal(parsed.hunks.length, 2)
  assert.equal(parsed.hunks[0]?.type, 'add')
  assert.equal(parsed.hunks[1]?.type, 'update')
})

test('parseApplyPatch reads standard add, update, move, and delete hunks', () => {
  const parsed = parseApplyPatch(`*** Begin Patch
*** Add File: src/new.ts
+export const value = 1
*** Update File: src/existing.ts
*** Move to: src/renamed.ts
@@ function value()
-return 1
+return 2
*** Delete File: src/obsolete.ts
*** End Patch`)

  assert.equal(parsed.hunks.length, 3)
  assert.deepEqual(parsed.hunks[0], {
    contents: 'export const value = 1',
    path: 'src/new.ts',
    type: 'add',
  })
  assert.deepEqual(parsed.hunks[1], {
    chunks: [
      {
        changeContext: 'function value()',
        newLines: ['return 2'],
        oldLines: ['return 1'],
      },
    ],
    movePath: 'src/renamed.ts',
    path: 'src/existing.ts',
    type: 'update',
  })
  assert.deepEqual(parsed.hunks[2], {
    path: 'src/obsolete.ts',
    type: 'delete',
  })
})

test('parseApplyPatch rejects legacy XML control markers emitted as source lines', () => {
  assert.throws(
    () =>
      parseApplyPatch(`<patch>
<update path="src/app/layout.tsx">
@@
-</update>
</update>
</patch>`),
    /reserved marker "<\/update>" was emitted as source text/u,
  )
})

test('parseApplyPatch accepts heredoc-wrapped patch text', () => {
  const wrappedWithCat = parseApplyPatch(`cat <<'EOF'
<patch>
<add path="src/cat.txt">
+cat
</add>
</patch>
EOF`)
  assert.equal(wrappedWithCat.hunks.length, 1)
  assert.equal(wrappedWithCat.hunks[0]?.type, 'add')

  const wrappedRaw = parseApplyPatch(`<<PATCH
<patch>
<add path="src/raw.txt">
+raw
</add>
</patch>
PATCH`)
  assert.equal(wrappedRaw.hunks.length, 1)
  assert.equal(wrappedRaw.hunks[0]?.type, 'add')
})

test('parseApplyPatch accepts Codex-style applypatch heredoc wrapper', () => {
  const parsed = parseApplyPatch(`applypatch <<'PATCH'
<patch>
<add path="src/alias.txt">
+alias
</add>
</patch>
PATCH`)

  assert.equal(parsed.hunks.length, 1)
  assert.equal(parsed.hunks[0]?.type, 'add')
})

test('parseApplyPatch accepts first update chunk without explicit context marker', () => {
  const parsed = parseApplyPatch(`<patch>
<update path="src/existing.ts">
 import value from './value'
+import other from './other'
</update>
</patch>`)

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
  const parsed = parseApplyPatch(`<patch>
<update path="file.txt">
@@
 before

 after
</update>
</patch>`)

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
        `<patch>
<update path="${targetFilePath}">
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
</update>
</patch>`,
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
        `<patch>
<update path="${targetFilePath}">
@@
 <footer className="rounded-2xl border border-[#F0F2F6] bg-white p-6 shadow-sm">
 <p className="mt-4 text-sm leading-6 text-[#606266]">
 A simple landing page structure for products that need a confident
 first impression.
 </p>
</update>
</patch>`,
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

test('applyPatchInWorkspace tolerates indentation-only drift in hunk context', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-indent-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'footer.tsx')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(
    targetFilePath,
    [
      '<footer className="rounded-2xl border border-[#F0F2F6] bg-white p-6 shadow-sm">',
      '    <p className="mt-4 text-sm leading-6 text-[#606266]">',
      '    A simple landing page structure for products that need a',
      '    confident first impression.',
      '    </p>',
      '</footer>',
      '',
    ].join('\n'),
    'utf8',
  )

  try {
    const result = await applyPatchInWorkspace(
      workspaceRootPath,
      `<patch>
<update path="${targetFilePath}">
@@
 <footer className="rounded-2xl border border-[#F0F2F6] bg-white p-6 shadow-sm">
 <p className="mt-4 text-sm leading-6 text-[#606266]">
 A simple landing page structure for products that need a
 confident first impression.
 </p>
+<div className="mt-6 rounded-xl border border-[#F0F2F6] bg-white p-4">
+<p className="text-sm text-[#606266]">Added through a whitespace-tolerant patch.</p>
+</div>
</update>
</patch>`,
    )

    assert.equal(result.changes.length, 1)
    assert.equal(
      await fs.readFile(targetFilePath, 'utf8'),
      [
        '<footer className="rounded-2xl border border-[#F0F2F6] bg-white p-6 shadow-sm">',
        '    <p className="mt-4 text-sm leading-6 text-[#606266]">',
        '    A simple landing page structure for products that need a',
        '    confident first impression.',
        '    </p>',
        '<div className="mt-6 rounded-xl border border-[#F0F2F6] bg-white p-4">',
        '<p className="text-sm text-[#606266]">Added through a whitespace-tolerant patch.</p>',
        '</div>',
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
        `<patch>
<update path="src/same.ts">
@@
 alpha
 beta
</update>
</patch>`,
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
        `<patch>
<update path="src/same-crlf.ts">
@@
 alpha
 beta
</update>
</patch>`,
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
      `<patch>
<update path="src/RouteTable.tsx">
@@
 import { SegmentedField } from "../../components/SegmentedField";
 import {
   getRouteOwnerFilterStorageKey,
+  ROUTE_OWNER_FILTER_ALL,
 } from "./routeTablePreferences";
</update>
</patch>`,
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

test('applyPatchInWorkspace treats unified line numbers as hints when the source match is unique', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-offset-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'shifted.ts')
  await fs.mkdir(path.dirname(targetFilePath), { recursive: true })
  await fs.writeFile(targetFilePath, 'intro\nunchanged\nconst value = 1\noutro\n', 'utf8')

  try {
    await applyPatchInWorkspace(
      workspaceRootPath,
      `*** Begin Patch
*** Update File: src/shifted.ts
@@ -1,1 +1,1 @@
-const value = 1
+const value = 2
*** End Patch`,
    )

    assert.equal(
      await fs.readFile(targetFilePath, 'utf8'),
      'intro\nunchanged\nconst value = 2\noutro\n',
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace rejects ambiguous short hunks instead of editing the wrong match', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-ambiguous-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'repeated.ts')
  await fs.mkdir(path.dirname(targetFilePath), { recursive: true })
  await fs.writeFile(targetFilePath, 'const value = 1\nseparator\nconst value = 1\n', 'utf8')

  try {
    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        `*** Begin Patch
*** Update File: src/repeated.ts
@@
-const value = 1
+const value = 2
*** End Patch`,
      ),
      /Ambiguous patch hunk in src[/\\]repeated\.ts.*lines 1, 3/u,
    )
    assert.equal(
      await fs.readFile(targetFilePath, 'utf8'),
      'const value = 1\nseparator\nconst value = 1\n',
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace includes nearby current source when a hunk is stale', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-diagnostic-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'diagnostic.ts')
  await fs.mkdir(path.dirname(targetFilePath), { recursive: true })
  await fs.writeFile(targetFilePath, 'start\nconst alpha = 1\nconst current = true\nend\n', 'utf8')

  try {
    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        `*** Begin Patch
*** Update File: src/diagnostic.ts
@@
 const alpha = 1
-const stale = true
+const current = false
*** End Patch`,
      ),
      /Current source near the match.*2: const alpha = 1.*3: const current = true/su,
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
      `<patch>
<update path="src/mixed.txt">
@@
 beta
+inserted
 gamma
</update>
</patch>`,
    )

    assert.equal(result.changes.length, 1)
    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'alpha\nbeta\ninserted\ngamma\ndelta\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace tolerates tab and space indentation mismatches', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-patch-tabs-'))
  const targetFilePath = path.join(workspaceRootPath, 'src', 'tabs.ts')
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(targetFilePath, 'function value() {\r\n\treturn 1\r\n}\r\n', 'utf8')

  try {
    const result = await applyPatchInWorkspace(
      workspaceRootPath,
      `<patch>
<update path="src/tabs.ts">
@@
 function value() {
   return 1
 }
+export const done = true
</update>
</patch>`,
    )

    assert.equal(result.changes.length, 1)
    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'function value() {\n\treturn 1\n}\nexport const done = true\n')
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
        `<patch>
<add path="src/created.ts">
+export const created = true;
</add>
<update path="src/existing.ts">
@@
 missing
+replacement
</update>
</patch>`,
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
      `<patch>
<add path="src/new.ts">
+export const created = true;
</add>
<update path="src/existing.ts" move_to="src/renamed.ts">
@@
 alpha
-beta
+gamma
</update>
<delete path="src/remove.ts" />
</patch>`,
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
      `<patch>
<add path="src/new.ts">
+export const created = true;
</add>
<update path="src/existing.ts" move_to="src/target.ts">
@@
 alpha
-beta
+gamma
</update>
<delete path="src/remove.ts" />
</patch>`,
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
    assert.ok('kanban_board' in tools)
    assert.ok(!('write' in tools))
    assert.ok(!('replace_file_content' in tools))
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
    assert.ok('replace_file_content' in tools)
    assert.ok(!('apply_patch' in tools))
    assert.ok('kanban_board' in tools)
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

test('createAgentTools does not expose webfetch for non-Codex providers', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
        providerId: 'custom:test-provider',
      },
    )

    assert.ok(!('webfetch' in tools))
    assert.ok(!('web_search' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools exposes the same exact replacement tools for every provider', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const codexTools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent', providerId: 'codex' },
    )
    const compatibleTools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent', providerId: 'custom:test-provider' },
    )

    for (const toolName of [
      'replace_file_content',
    ]) {
      const codexTool = codexTools[toolName] as {
        description?: string
        inputSchema?: unknown
      }
      const compatibleTool = compatibleTools[toolName] as {
        description?: string
        inputSchema?: unknown
      }
      assert.equal(codexTool.description, compatibleTool.description)
      assert.ok(codexTool.inputSchema)
      assert.ok(compatibleTool.inputSchema)
    }

    assert.ok('web_search' in codexTools)
    assert.ok(!('webfetch' in compatibleTools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools describes grep mechanics without workflow guidance', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools({
      workspaceRootPath,
    }, {
      chatMode: 'agent',
    })

    assert.ok('grep' in tools)
    const grepTool = tools.grep as { description?: string }

    assert.match(grepTool.description ?? '', /Searches file contents/u)
    assert.doesNotMatch(grepTool.description ?? '', /use `read`|apply_patch|should|prefer/iu)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools keeps plan mode tool descriptions literal', async () => {
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

    assert.match(listTool.description ?? '', /Lists direct contents/u)
    assert.match(readTool.description ?? '', /Reads file contents/u)
    assert.match(globTool.description ?? '', /Finds file paths/u)
    assert.match(grepTool.description ?? '', /Searches file contents/u)
    for (const description of [listTool, readTool, globTool, grepTool].map((tool) => tool.description ?? '')) {
      assert.doesNotMatch(description, /use `read`|apply_patch|write|should|prefer/iu)
    }
    assert.ok(!('write' in tools))
    assert.ok(!('replace_file_content' in tools))
    assert.ok(!('apply_patch' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools keeps mutation descriptions mechanical and workflow-free', async () => {
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
    assert.ok('replace_file_content' in tools)
    assert.ok('write' in tools)

    const readTool = tools.read as { description?: string }
    const globTool = tools.glob as { description?: string }
    const grepTool = tools.grep as { description?: string }
    const replaceTool = tools.replace_file_content as { description?: string }
    const writeTool = tools.write as { description?: string }

    assert.match(readTool.description ?? '', /Reads file contents/u)
    assert.match(replaceTool.description ?? '', /Replaces a block of text/u)
    assert.match(globTool.description ?? '', /Finds file paths/u)
    assert.match(grepTool.description ?? '', /Searches file contents/u)
    assert.match(writeTool.description ?? '', /Writes content to a file/u)
    for (const description of [
      readTool,
      globTool,
      grepTool,
      replaceTool,
      writeTool,
    ]
      .map((tool) => tool.description ?? '')) {
      assert.doesNotMatch(description, /should|prefer|after reading|before editing/iu)
    }
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
