import assert from 'node:assert/strict'
import test from 'node:test'
import { parseApplyPatch } from '../../electron/chat/shared/applyPatchParser'

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
