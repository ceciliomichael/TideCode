import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyPatchInWorkspace } from '../../electron/chat/shared/applyPatch'

test('applyPatchInWorkspace rejects stale update hunks instead of re-anchoring them', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-reanchor-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-wrap-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-indent-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-noop-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-eol-noop-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-crlf-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-offset-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-ambiguous-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-diagnostic-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-mixed-eol-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-tabs-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-atomic-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-'))
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-capture-'))
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
