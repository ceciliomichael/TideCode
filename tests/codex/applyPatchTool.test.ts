import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyPatchInWorkspace, parseApplyPatch } from '../../electron/chat/shared/applyPatch'
import { createAgentTools } from '../../electron/chat/shared/tools'

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

test('applyPatchInWorkspace can re-anchor an update when the file already has a matching inserted line', async () => {
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
    const result = await applyPatchInWorkspace(
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
    )

    assert.equal(result.changes.length, 1)
    const updatedContent = await fs.readFile(targetFilePath, 'utf8')
    assert.match(updatedContent, /import \{ createHash \} from 'node:crypto';/u)
    assert.match(updatedContent, /decodeIdTokenClaims/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('applyPatchInWorkspace tolerates accidental line-wrap differences in hunk context', async () => {
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
    const result = await applyPatchInWorkspace(
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
    )

    assert.equal(result.changes.length, 1)
    const updatedContent = await fs.readFile(targetFilePath, 'utf8')
    assert.match(updatedContent, /A simple landing page structure for products that need a confident\nfirst impression\./u)
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
    assert.match(applyPatchTool.args?.description ?? '', /Every update hunk must make a real content change/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
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
    const applyPatchTool = tools.apply_patch as { description?: string }
    const writeTool = tools.write as { description?: string }

    assert.match(readTool.description ?? '', /Do not guess paths/u)
    assert.match(readTool.description ?? '', /After reading, use `apply_patch` for small edits or `write` for a full replacement/u)
    assert.match(applyPatchTool.description ?? '', /workspace-relative file paths like `src\/app\.ts`/u)
    assert.match(applyPatchTool.description ?? '', /Use `write` only when you need to replace a whole file/u)
    assert.match(applyPatchTool.description ?? '', /Do not use guessed paths/u)
    assert.match(applyPatchTool.description ?? '', /always patch against the file as it exists right now on disk/u)
    assert.match(applyPatchTool.description ?? '', /Every update hunk must make a real content change/u)
    assert.match(applyPatchTool.description ?? '', /If the target already has the desired content, do not call apply_patch/u)
    assert.match(applyPatchTool.description ?? '', /Order update hunks from top to bottom/u)
    assert.match(applyPatchTool.description ?? '', /grep results are only location hints/u)
    assert.match(writeTool.description ?? '', /For small edits to an existing file, use `apply_patch` instead/u)
    assert.match(writeTool.description ?? '', /Do not call write when the target already has identical content/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
