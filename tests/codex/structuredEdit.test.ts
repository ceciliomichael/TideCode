import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyStructuredEdits } from '../../electron/chat/shared/structuredEditWorkspace'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'

test('structured edits validate all matches before writing, and support replace_all', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-structured-edit-'))
  const one = path.join(dir, 'one.txt')
  const two = path.join(dir, 'two.txt')
  const resolve = (name: string) => ({ absolutePath: path.join(dir, name), relativePath: name })
  const apply = (changes: Parameters<typeof applyStructuredEdits>[0]) =>
    applyStructuredEdits(changes, resolve, async () => {})
  try {
    await fs.writeFile(one, 'a a\nb')
    await fs.writeFile(two, 'before')
    await assert.rejects(apply([
      { path: 'one.txt', oldText: 'a', newText: 'x' },
      { path: 'two.txt', oldText: 'before', newText: 'after' },
    ]), /2 matches/)
    assert.equal(await fs.readFile(one, 'utf8'), 'a a\nb')
    await assert.rejects(apply([
      { path: 'one.txt', oldText: 'a', newText: 'x', replace_all: true },
      { path: 'two.txt', oldText: 'missing', newText: 'after' },
    ]), /not found/)
    assert.equal(await fs.readFile(one, 'utf8'), 'a a\nb')
    const result = await apply([
      { path: 'one.txt', oldText: 'a', newText: 'x', replace_all: true },
      { path: 'one.txt', oldText: 'x x', newText: 'y' },
      { path: 'two.txt', oldText: 'before', newText: 'after' },
    ])
    assert.deepEqual(result.map((entry) => entry.matches), [3, 1])
    assert.equal(await fs.readFile(one, 'utf8'), 'y\nb')
    assert.equal(await fs.readFile(two, 'utf8'), 'after')
  } finally {
    await fs.rm(dir, { force: true, recursive: true })
  }
})

test('edit API is available in Agent Mode and Plan Mode but Plan Mode cannot edit source', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-edit-modes-'))
  try {
    const file = path.join(dir, 'code.ts')
    await fs.writeFile(file, 'const x = 1\n')
    const agent = await createAgentToolBundle({ workspaceRootPath: dir }, { chatMode: 'agent' })
    const plan = await createAgentToolBundle({ workspaceRootPath: dir }, { chatMode: 'plan' })
    assert.ok(agent.registry.get('edit'))
    assert.ok(plan.registry.get('edit'))
    const edit = plan.nativeTools.edit as { execute: (args: unknown, options: unknown) => Promise<{ status: string; body: string }> }
    const result = await edit.execute({ changes: [{ path: 'code.ts', oldText: '1', newText: '2' }] }, {})
    assert.match(result.body, /active plan/i)
    assert.equal(await fs.readFile(file, 'utf8'), 'const x = 1\n')
    await agent.codeModeExecutor.dispose()
    await plan.codeModeExecutor.dispose()
  } finally {
    await fs.rm(dir, { force: true, recursive: true })
  }
})

test('structured edits match LF reads against CRLF files while preserving CRLF and BOM', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-structured-line-endings-'))
  const filename = path.join(dir, 'source.ts')
  const resolve = (name: string) => ({ absolutePath: path.join(dir, name), relativePath: name })
  try {
    await fs.writeFile(filename, '\uFEFFfirst\r\nsecond\r\nthird\r\n')
    await applyStructuredEdits([
      { path: 'source.ts', oldText: 'first\nsecond', newText: 'FIRST\nSECOND' },
      { path: 'source.ts', oldText: 'SECOND\r\nthird', newText: 'SECOND\nTHIRD' },
    ], resolve, async () => {})
    assert.equal(await fs.readFile(filename, 'utf8'), '\uFEFFFIRST\r\nSECOND\r\nTHIRD\r\n')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('structured edits reject overlapping replacements without modifying files', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-structured-overlap-'))
  const filename = path.join(dir, 'source.ts')
  const resolve = (name: string) => ({ absolutePath: path.join(dir, name), relativePath: name })
  try {
    await fs.writeFile(filename, 'alpha\r\nbeta\r\n')
    await assert.rejects(applyStructuredEdits([
      { path: 'source.ts', oldText: 'alpha\nbeta', newText: 'updated' },
      { path: 'source.ts', oldText: 'beta', newText: 'other' },
    ], resolve, async () => {}), /removed or modified by an earlier change/)
    assert.equal(await fs.readFile(filename, 'utf8'), 'alpha\r\nbeta\r\n')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('structured edits select duplicate text using validated line and context hints', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-edit-context-'))
  const target = path.join(dir, 'source.ts')
  const resolve = (name: string) => ({ absolutePath: path.join(dir, name), relativePath: name })
  try {
    await fs.writeFile(target, 'first\nvalue\nsecond\nvalue\n')
    await applyStructuredEdits([
      { path: 'source.ts', oldText: 'value', newText: 'updated', line: 4, before: 'second\n' },
    ], resolve, async () => {})
    assert.equal(await fs.readFile(target, 'utf8'), 'first\nvalue\nsecond\nupdated\n')
    await assert.rejects(applyStructuredEdits([
      { path: 'source.ts', oldText: 'value', newText: 'wrong', line: 4 },
    ], resolve, async () => {}), /no match satisfies starting line 4/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('structured edits distinguish excluded candidates from text removed by earlier changes', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-edit-diagnostics-'))
  const target = path.join(dir, 'source.ts')
  const resolve = (name: string) => ({ absolutePath: path.join(dir, name), relativePath: name })
  const original = 'header\nfirst\nvalue\nsecond\nvalue\n'
  try {
    await fs.writeFile(target, original)
    const constraints = [
      { line: 2 },
      { before: 'missing\n' },
      { after: '\nmissing' },
    ]
    for (const constraint of constraints) {
      await assert.rejects(applyStructuredEdits([
        { path: 'source.ts', oldText: 'header', newText: 'new\nheader' },
        { path: 'source.ts', oldText: 'value', newText: 'updated', ...constraint },
      ], resolve, async () => {}), (error: Error) => {
        assert.match(error.message, /oldText exists, but no match satisfies/)
        assert.match(error.message, /No files were changed/)
        assert.match(error.message, /Candidate at line 4:\n3 \| first\n4 \| value\n5 \| second/)
        assert.match(error.message, /Candidate at line 6/)
        assert.doesNotMatch(error.message, /removed or modified/)
        return true
      })
      assert.equal(await fs.readFile(target, 'utf8'), original)
    }
    await assert.rejects(applyStructuredEdits([
      { path: 'source.ts', oldText: 'header', newText: 'new header' },
      { path: 'source.ts', oldText: 'absent', newText: 'updated' },
    ], resolve, async () => {}), /oldText not found\. No files were changed/)
    assert.equal(await fs.readFile(target, 'utf8'), original)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ambiguous edit diagnostics provide bounded candidate context without writing', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-edit-candidates-'))
  const target = path.join(dir, 'source.ts')
  const resolve = (name: string) => ({ absolutePath: path.join(dir, name), relativePath: name })
  const original = Array.from({ length: 12 }, (_, index) => `section ${index} ${'x'.repeat(400)}\nvalue\n`).join('')
  try {
    await fs.writeFile(target, original)
    await assert.rejects(applyStructuredEdits([
      { path: 'source.ts', oldText: 'value', newText: 'updated' },
    ], resolve, async () => {}), (error: Error) => {
      assert.match(error.message, /12 matches/)
      assert.match(error.message, /No files were changed/)
      assert.equal(error.message.match(/Candidate at line /gu)?.length, 3)
      assert.match(error.message, /9 more candidates omitted/)
      assert.match(error.message, /1 \| section 0/)
      assert.doesNotMatch(error.message, /x{161}/u)
      assert.ok(error.message.length < 2000)
      return true
    })
    assert.equal(await fs.readFile(target, 'utf8'), original)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('structured edits recover unique indentation differences but reject ambiguous candidates', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-edit-indent-'))
  const target = path.join(dir, 'source.ts')
  const resolve = (name: string) => ({ absolutePath: path.join(dir, name), relativePath: name })
  try {
    await fs.writeFile(target, '    if (ready) {\n        return true\n    }\n')
    await applyStructuredEdits([
      { path: 'source.ts', oldText: 'if (ready) {\n  return true\n}', newText: 'if (ready) {\n  return false\n}' },
    ], resolve, async () => {})
    assert.equal(await fs.readFile(target, 'utf8'), '    if (ready) {\n        return false\n    }\n')
    await fs.writeFile(target, '    return true\n\treturn true\n')
    await assert.rejects(applyStructuredEdits([
      { path: 'source.ts', oldText: 'return true', newText: 'return false' },
    ], resolve, async () => {}), /2 matches/)
    assert.equal(await fs.readFile(target, 'utf8'), '    return true\n\treturn true\n')
    await fs.writeFile(target, 'const value = left  +  right\n')
    await assert.rejects(applyStructuredEdits([
      { path: 'source.ts', oldText: 'const value = left + right', newText: 'const value = changed' },
    ], resolve, async () => {}), /not found/)
    assert.equal(await fs.readFile(target, 'utf8'), 'const value = left  +  right\n')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
