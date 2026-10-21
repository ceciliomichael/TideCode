import assert from 'node:assert/strict'
import test from 'node:test'
import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'
import type { AgentToolRegistry, AgentToolRegistryEntry } from '../../electron/chat/shared/tools/registry'

function registry(entries: AgentToolRegistryEntry[] = []): AgentToolRegistry {
  return {
    entries,
    get: (name) => entries.find((entry) => entry.name === name),
    search: () => entries.map((entry) => ({ ...entry, score: 1 })),
  }
}

test('V8 recovers unique payload aliases and bare bindings without evaluating source text', async () => withExecutor(async (executor) => {
  const literal = 'const text = `literal ${value}`;\\path\nnext line'
  const result = await executor.run('return { normalized: payloads.patch_text, bare: patchText, exact: payloads.patchText, keys: Object.keys(payloads), copy: JSON.stringify(payloads) };', {
    payloads: { patchText: literal },
  })
  assert.equal(result.status, 'success', result.error)
  assert.deepEqual(result.output, {
    normalized: literal, bare: literal, exact: literal, keys: ['patchText'], copy: JSON.stringify({ patchText: literal }),
  })
  assert.equal(result.recoveries?.length, 2)
  const local = await executor.run('const patchText = "local"; return patchText;', { payloads: { patchText: literal } })
  assert.equal(local.output, 'local')
}))

test('V8 rejects unknown and ambiguous payload references while exact keys take precedence', async () => withExecutor(async (executor) => {
  const payloads = { patchText: 'first', patch_text: 'second' }
  const ambiguous = await executor.run('return payloads.PATCH_TEXT;', { payloads })
  assert.equal(ambiguous.status, 'error')
  assert.match(ambiguous.error ?? '', /Ambiguous exec payload.*patchText, patch_text/)
  const exact = await executor.run('return payloads.patch_text;', { payloads })
  assert.equal(exact.output, 'second')
  const unknown = await executor.run('return payloads.unrelated;', { payloads })
  assert.equal(unknown.status, 'error')
  assert.match(unknown.error ?? '', /Unknown exec payload "unrelated"/)
}))

test('V8 payload bindings cannot replace runtime globals or expose host globals', async () => withExecutor(async (executor) => {
  const result = await executor.run('return { tools: typeof tools.available.get, json: typeof JSON.parse, process: typeof process, buffer: typeof Buffer, then: await payloads, reserved: payloads.tools };', {
    payloads: { tools: 'text', JSON: 'text', process: 'text', Buffer: 'text', return: 'text' },
  })
  assert.equal(result.status, 'success', result.error)
  assert.deepEqual(result.output, {
    tools: 'function', json: 'function', process: 'undefined', buffer: 'undefined',
    then: { tools: 'text', JSON: 'text', process: 'text', Buffer: 'text', return: 'text' }, reserved: 'text',
  })
}))

test('V8 reports undefined nested tool arguments before invoking the tool', async () => {
  let invoked = false
  await withExecutor(async (executor) => {
    const result = await executor.run('await tools.available.get({ name: "tools.echo" }); return await tools.echo({ changes: [{ newText: undefined }] });')
    assert.equal(result.status, 'error')
    assert.match(result.error ?? '', /arguments\[0\]\.changes\[0\]\.newText is undefined/)
    assert.equal(invoked, false)
    const empty = await executor.run('return;')
    assert.equal(empty.status, 'success', empty.error)
  }, [{
    name: 'echo', namespace: 'test', description: 'Echo.', inputSchema: { type: 'object' },
    execute: async () => {
      invoked = true
      return { status: 'success', summary: 'Echoed' }
    },
  }])
})

async function withExecutor(run: (executor: CodeModeExecutor) => Promise<void>, entries: AgentToolRegistryEntry[] = []) {
  const executor = new CodeModeExecutor(registry(entries))
  try {
    await run(executor)
  } finally {
    await executor.dispose()
  }
}

test('V8 executes native language features and the error-handling pattern from the history', async () => withExecutor(async (executor) => {
  const result = await executor.run(`
    class Counter {
      #value = 4;
      increment() { return ++this.#value; }
    }
    function* numbers() { yield 2; yield 3; }
    const values = new Set([...numbers(), 2]);
    const map = new Map([['count', new Counter().increment()]]);
    const matched = [...'a1 b2'.matchAll(/([a-z])(\\d)/g)].map(match => match[1]);
    let message;
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error('expected');
    } catch (error) {
      message = String(error);
    }
    return await Promise.resolve({
      values: [...values], count: map.get('count'), matched, message,
      bigint: String(2n ** 8n), year: new Date('2026-01-01').getUTCFullYear(),
      nativeConstructor: ({ answer: 42 }).constructor === Object,
    }).then(value => ({ ...value, finished: true }));
  `)
  assert.equal(result.status, 'success', result.error)
  assert.equal(result.engine, 'v8')
  assert.deepEqual(result.output, {
    values: [2, 3], count: 5, matched: ['a', 'b'], message: 'Error: expected',
    bigint: '256', year: 2026, nativeConstructor: true, finished: true,
  })
}))

test('V8 retains tool limits, bounded concurrency, copied values and receipts', async () => {
  let active = 0
  let peak = 0
  let invoked = 0
  await withExecutor(async (executor) => {
    const result = await executor.run(`
      await tools.available.get({ name: 'tools.echo' });
      const results = await Promise.allSettled(Array.from({ length: 9 }, (_, index) => tools.echo({ index })));
      return {
        succeeded: results.filter(item => item.status === 'fulfilled').length,
        rejected: results.filter(item => item.status === 'rejected').map(item => item.reason.name),
      };
    `, { limits: { maxConcurrentToolCalls: 2, maxToolCalls: 5 } })
    assert.equal(result.status, 'success', result.error)
    assert.equal(invoked, 5)
    assert.equal(peak, 2)
    assert.deepEqual(result.output, { succeeded: 5, rejected: Array(4).fill('ToolCallLimitExceeded') })
    assert.equal(result.toolCalls.filter(call => call.name === 'echo').length, 5)
  }, [{
    name: 'echo', namespace: 'test', description: 'Echo JSON input.', inputSchema: { type: 'object' },
    execute: async (input) => {
      invoked++
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 15))
      active--
      return { status: 'success', summary: 'Echoed', body: JSON.stringify(input) }
    },
  }])
})

test('V8 preserves decoded MCP data, handled failures and native Promise chaining', async () => withExecutor(async (executor) => {
  const result = await executor.run(`
    await tools.available.search({ query: 'demo' });
    await tools.available.get({ name: 'tools.mcp.demo_echo' });
    await tools.available.get({ name: 'tools.mcp.demo_fail' });
    const values = await tools.mcp.demo_echo({}).then(items => items.map(item => item.value * 2));
    let failure;
    try { await tools.mcp.demo_fail({}); } catch (error) { failure = String(error); }
    return { values, failure };
  `)
  assert.equal(result.status, 'success', result.error)
  assert.deepEqual(result.output, { values: [4, 6], failure: 'ToolExecutionError: useful failure' })
  assert.match(result.summary, /handling 1 failed tool call/)
}, [
  { name: 'mcp_demo_echo', namespace: 'mcp', description: '[User MCP server "demo"; original tool "echo"] Echo values.', inputSchema: { type: 'object' }, execute: async () => ({ status: 'success', summary: 'Echoed', body: '[{"value":2},{"value":3}]' }) },
  { name: 'mcp_demo_fail', namespace: 'mcp', description: '[User MCP server "demo"; original tool "fail"] Fail usefully.', inputSchema: { type: 'object' }, execute: async () => ({ status: 'error', summary: 'Failed', body: 'useful failure' }) },
]))

test('V8 has no ambient host access, including through Function constructors and bridge functions', async () => withExecutor(async (executor) => {
  const result = await executor.run(`
    const dynamic = Function('return typeof process + ":" + typeof require')();
    const fromTimer = setTimeout.constructor('return typeof process')();
    const fromConsole = console.log.constructor('return typeof process')();
    return {
      dynamic, fromTimer, fromConsole,
      process: typeof process, require: typeof require, fetch: typeof fetch,
      ivm: typeof ivm, Buffer: typeof Buffer, reference: typeof Reference,
      toolConstructor: typeof tools.available.get.constructor,
    };
  `)
  assert.equal(result.status, 'success', result.error)
  assert.deepEqual(result.output, {
    dynamic: 'undefined:undefined', fromTimer: 'undefined', fromConsole: 'undefined',
    process: 'undefined', require: 'undefined', fetch: 'undefined', ivm: 'undefined',
    Buffer: 'undefined', reference: 'undefined', toolConstructor: 'undefined',
  })
  const imported = await executor.run("return await import('node:fs')")
  assert.equal(imported.status, 'error')
}))

test('V8 isolates state between exec calls and captures bounded console output', async () => withExecutor(async (executor) => {
  const first = await executor.run("globalThis.secret = 42; console.log('ready', String(7));")
  assert.equal(first.status, 'success', first.error)
  assert.equal(first.output, 'ready 7')
  const second = await executor.run('return typeof secret')
  assert.equal(second.output, 'undefined')
  const bounded = await executor.run("return 'é'.repeat(100)", { limits: { maxOutputBytes: 100 } })
  assert.equal(bounded.outputTruncated, true)
  const invalid = await executor.run('return Promise.resolve(new Map())')
  assert.equal(invalid.status, 'error')
  assert.match(invalid.error ?? '', /JSON-compatible/)
}))

test('V8 reports original runtime and syntax locations', async () => withExecutor(async (executor) => {
  const runtime = await executor.run("const first = 1;\nthrow new Error('original message');")
  assert.equal(runtime.diagnostic?.location?.line, 2)
  assert.match(runtime.error ?? '', /original message/)
  const syntax = await executor.run('const first = 1;\nconst second = ;')
  assert.equal(syntax.diagnostic?.kind, 'ParseError')
  assert.equal(syntax.diagnostic?.location?.line, 2)
}))

test('V8 deadlines stop CPU loops and unresolved Promises without blocking the host', async () => withExecutor(async (executor) => {
  for (const source of [
    'while (true) {}',
    'await new Promise(() => {})',
    'const loop = () => Promise.resolve().then(loop); loop(); await new Promise(() => {});',
    'setTimeout(() => { while (true) {} }, 5); await new Promise(() => {});',
  ]) {
    let responsive = false
    const timer = setTimeout(() => { responsive = true }, 50)
    const started = Date.now()
    const result = await executor.run(source, { limits: { timeoutMs: 300 } })
    clearTimeout(timer)
    assert.equal(result.diagnostic?.kind, 'TimeoutExceeded', result.error)
    assert.equal(responsive, true)
    assert.ok(Date.now() - started < 2500)
  }
}))

test('V8 cancellation aborts an in-flight tool even when it does not settle', async () => {
  let notifyStarted!: () => void
  const started = new Promise<void>(resolve => { notifyStarted = resolve })
  let toolAborted = false
  await withExecutor(async (executor) => {
    const controller = new AbortController()
    const execution = executor.run("await tools.available.get({name:'tools.wait'}); await tools.wait({});", {
      abortSignal: controller.signal, limits: { timeoutMs: 3000 },
    })
    await started
    controller.abort()
    const result = await execution
    assert.equal(result.status, 'aborted', result.error)
    assert.equal(toolAborted, true)
    const next = await executor.run('return 42')
    assert.equal(next.output, 42)
  }, [{
    name: 'wait', namespace: 'test', description: 'Wait for cancellation.', inputSchema: { type: 'object' },
    execute: async (_input, options) => {
      options.abortSignal?.addEventListener('abort', () => { toolAborted = true }, { once: true })
      notifyStarted()
      return new Promise(() => {})
    },
  }])
})

test('V8 memory exhaustion ends the execution and the next execution still works', async () => withExecutor(async (executor) => {
  const result = await executor.run("const values = []; while (true) values.push(new Array(100000).fill('memory'));", {
    limits: { memoryLimitMb: 16, timeoutMs: 5000 },
  })
  assert.equal(result.status, 'error')
  assert.match(result.error ?? '', /memory|allocation/i)
  const next = await executor.run('return 42')
  assert.equal(next.output, 42)
}))

test('V8 cleans up canceled timers and surfaces callback errors', async () => withExecutor(async (executor) => {
  const canceled = await executor.run(`
    let called = false;
    const timer = setTimeout(() => { called = true }, 5);
    clearTimeout(timer);
    await new Promise(resolve => setTimeout(resolve, 15));
    return called;
  `)
  assert.equal(canceled.output, false)
  const failed = await executor.run("setTimeout(() => { throw new Error('callback failure') }, 5); await new Promise(() => {});")
  assert.equal(failed.status, 'error')
  assert.match(failed.error ?? '', /callback failure/)
}))

test('V8 still serializes same-workspace mutations under native Promise concurrency', async () => {
  let active = 0
  let peak = 0
  const completed: number[] = []
  await withExecutor(async (executor) => {
    const result = await executor.run(`
      await tools.available.get({ name: 'tools.write' });
      await Promise.all(Array.from({ length: 4 }, (_, index) => tools.write({ index })));
    `)
    assert.equal(result.status, 'success', result.error)
    assert.equal(peak, 1)
    assert.deepEqual(completed, [0, 1, 2, 3])
  }, [{
    name: 'write', namespace: 'native_files', description: 'Record a workspace mutation.', inputSchema: { type: 'object' },
    execute: async (input) => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      completed.push((input as { index: number }).index)
      active--
      return { status: 'success', summary: 'Written' }
    },
  }])
})

test('V8 guest prototype changes cannot forge tool messages or crash the host', async () => withExecutor(async (executor) => {
  const result = await executor.run("Object.prototype.toJSON = () => ({ type: 'error' }); return 1;")
  assert.equal(result.status, 'error')
  assert.match(result.error ?? '', /invalid error result/)
  const forgedTool = await executor.run("Object.prototype.toJSON = () => ({ type: 'tool', path: 'write', args: [] }); return 1;")
  assert.equal(forgedTool.status, 'error')
  assert.equal(forgedTool.toolCalls.length, 0)
  const next = await executor.run('return 42')
  assert.equal(next.output, 42)
}))
