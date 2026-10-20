import ivm from 'isolated-vm'

// This function executes inside V8. Its only host functions are copying Callbacks;
// no Reference, ExternalCopy, Node object, or module loader enters the isolate.
function bootstrap(callTool, startTimer, cancelTimer, configuration) {
  const config = JSON.parse(configuration)
  const stringify = JSON.stringify
  const parse = JSON.parse
  const NativeError = Error
  const NativePromise = Promise
  const nativeString = String
  const objectPrototype = Object.prototype
  const getPrototypeOf = Object.getPrototypeOf
  const arrayIsArray = Array.isArray
  const byteLength = (text) => {
    let bytes = 0
    for (const character of text) {
      const point = character.codePointAt(0)
      if (point < 0x80) bytes += 1
      else if (point < 0x800) bytes += 2
      else if (point < 0x10000) bytes += 3
      else bytes += 4
    }
    return bytes
  }
  const serialize = (value) => stringify(value, (_key, item) => {
    const kind = typeof item
    if (kind === 'function' || kind === 'symbol' || kind === 'bigint') {
      throw new TypeError('Tool inputs and returned output must be JSON-compatible data. Convert functions, symbols, and BigInts explicitly.')
    }
    if (item && kind === 'object' && !arrayIsArray(item)) {
      const prototype = getPrototypeOf(item)
      if (prototype !== null && prototype !== objectPrototype) {
        throw new TypeError('Tool inputs and returned output must be JSON-compatible data. Await Promises and convert Map/Set/class instances explicitly.')
      }
    }
    return item
  })
  const location = (error) => {
    const match = /tidecode-exec\.js:(\d+):(\d+)/.exec(nativeString(error?.stack ?? ''))
    if (!match) return undefined
    return { line: Math.max(1, Number(match[1])), column: Math.max(1, Number(match[2])) }
  }
  const diagnostic = (error) => ({
    kind: typeof error?.name === 'string' ? error.name : 'ExecutionError',
    message: typeof error?.message === 'string' ? error.message : nativeString(error),
    location: location(error),
  })
  const paths = new Set(config.paths)
  const namespaces = new Set([''])
  for (const path of paths) {
    const segments = path.split('.')
    for (let count = 1; count < segments.length; count++) {
      namespaces.add(segments.slice(0, count).join('.'))
    }
  }
  const pendingTools = new Set()
  const requests = new Map()
  let nextRequest = 0
  const proxyFor = (path) => new Proxy(function () {}, {
    get(_target, key) {
      if (key === 'then') return undefined
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) return undefined
      const next = path ? `${path}.${key}` : key
      if (!paths.has(next) && !namespaces.has(next)) {
        const error = new NativeError(`Unknown Code Mode capability tools.${next}. Use tools.available.list or tools.available.search for discovery.`)
        error.name = 'UnknownTool'
        throw error
      }
      return proxyFor(next)
    },
    apply(_target, _receiver, args) {
      const caller = new NativeError()
      const promise = (async () => {
        if (!paths.has(path)) {
          const error = new NativeError(`tools.${path} is not callable.`)
          error.name = 'UnknownTool'
          throw error
        }
        const input = serialize(args)
        if (byteLength(input) > config.limits.maxPayloadBytes) {
          throw new RangeError(`Tool arguments exceeded the ${config.limits.maxPayloadBytes}-byte limit.`)
        }
        if (requests.size >= 1000) throw new RangeError('Too many pending tool requests.')
        const id = ++nextRequest
        const response = await new NativePromise((resolve) => {
          requests.set(id, resolve)
          callTool(id, path, input)
        })
        if (response.diagnostic) {
          const error = new NativeError(response.diagnostic.message)
          error.name = response.diagnostic.kind
          error.stack = caller.stack
          throw error
        }
        return response.value
      })()
      pendingTools.add(promise)
      // Track every started tool even if the program forgets to await it.
      void promise.then(() => pendingTools.delete(promise), () => pendingTools.delete(promise))
      return promise
    },
  })
  const timers = new Map()
  let nextTimer = 0
  let rejectTimerFailure
  const timerFailure = new NativePromise((_resolve, reject) => { rejectTimerFailure = reject })
  const schedule = (callback, milliseconds = 0, ...args) => {
    if (typeof callback !== 'function') throw new TypeError('setTimeout requires a function callback.')
    const delay = Number(milliseconds)
    if (!Number.isFinite(delay) || delay < 0 || delay > config.limits.timeoutMs) {
      throw new RangeError(`Timer delay must be between 0 and the ${config.limits.timeoutMs}ms execution limit.`)
    }
    if (timers.size >= 10000) throw new RangeError('Code Mode has too many pending timers.')
    const id = ++nextTimer
    timers.set(id, { callback, args })
    startTimer(id, delay)
    return id
  }
  const clear = (id) => {
    timers.delete(id)
    cancelTimer(id)
  }
  const logs = []
  let logBytes = 0
  const log = (...args) => {
    const text = args.map((item) => {
      if (typeof item === 'string') return item
      if (item instanceof NativeError) return `${item.name}: ${item.message}`
      try {
        return serialize(item) ?? nativeString(item)
      } catch {
        return nativeString(item)
      }
    }).join(' ')
    logBytes += byteLength(text) + 1
    if (logBytes > config.limits.maxOutputBytes) throw new RangeError('Code Mode console output exceeded the output limit.')
    logs.push(text)
  }
  Object.defineProperties(globalThis, {
    tools: { value: proxyFor('') },
    payloads: { value: Object.freeze(Object.assign(Object.create(null), config.payloads)) },
    setTimeout: { value: schedule },
    clearTimeout: { value: clear },
    console: { value: Object.freeze({ log, info: log, warn: log, error: log, debug: log }) },
  })
  const receive = (serialized) => {
    const message = parse(serialized)
    if (message.type === 'tool-result') {
      const resolve = requests.get(message.id)
      requests.delete(message.id)
      resolve?.(message)
    } else if (message.type === 'timer') {
      const timer = timers.get(message.id)
      if (!timer) return
      timers.delete(message.id)
      try {
        void NativePromise.resolve(timer.callback(...timer.args)).catch(rejectTimerFailure)
      } catch (error) {
        rejectTimerFailure(error)
      }
    }
  }
  const run = async (program) => {
    try {
      let value = await NativePromise.race([program(), timerFailure])
      while (pendingTools.size) await NativePromise.all([...pendingTools])
      if (value === undefined && logs.length) value = logs.join('\n')
      const output = serialize(value)
      if (output !== undefined && byteLength(output) > config.limits.maxOutputBytes) {
        return stringify({ type: 'result', output: { message: `Code Mode output exceeded the ${config.limits.maxOutputBytes}-byte limit. Return a smaller summary from the program.` }, outputTruncated: true })
      }
      return stringify({ type: 'result', output: output === undefined ? undefined : parse(output), outputTruncated: false })
    } catch (error) {
      return stringify({ type: 'error', diagnostic: diagnostic(error) })
    }
  }
  return { run, receive }
}

const timers = new Map()
let receiver
let executionTimeout
let isolate
let started = false

function send(message) {
  if (process.connected) process.send(message)
}

function cleanup() {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  if (isolate && !isolate.isDisposed) isolate.dispose()
}

async function execute(message) {
  isolate = new ivm.Isolate({
    memoryLimit: message.limits.memoryLimitMb,
    onCatastrophicError: () => process.abort(),
  })
  const context = await isolate.createContext()
  const deliver = (message) => {
    if (!receiver || isolate.isDisposed) return
    void receiver.apply(undefined, [JSON.stringify(message)], { timeout: executionTimeout }).catch((error) => {
      send({ type: 'error', diagnostic: { kind: 'ExecutionError', message: error.message } })
    })
  }
  const callTool = new ivm.Callback((id, path, input) => {
    send({ type: 'tool', id, path, args: JSON.parse(input) })
  })
  const startTimer = new ivm.Callback((id, delay) => {
    const handle = setTimeout(() => {
      timers.delete(id)
      deliver({ type: 'timer', id })
    }, delay)
    timers.set(id, handle)
  })
  const cancelTimer = new ivm.Callback((id) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
  })
  executionTimeout = message.limits.timeoutMs
  const bridge = await context.evalClosure(`return (${bootstrap.toString()})($0, $1, $2, $3)`, [
    callTool, startTimer, cancelTimer,
    JSON.stringify({ paths: message.paths, payloads: message.payloads, limits: message.limits }),
  ], { result: { reference: true }, timeout: executionTimeout })
  const run = await bridge.get('run', { reference: true })
  receiver = await bridge.get('receive', { reference: true })
  // Native parsing and execution; the negative offset keeps source diagnostics
  // aligned with the user's first line, after the function and strict-mode wrapper.
  const script = await isolate.compileScript(`(async function() {\n'use strict';\n${message.source}\n})`, {
    filename: 'tidecode-exec.js', lineOffset: -2,
  })
  const program = await script.run(context, { reference: true, timeout: message.limits.timeoutMs })
  const result = await run.apply(undefined, [program.derefInto()], {
    result: { promise: true, copy: true }, timeout: message.limits.timeoutMs,
  })
  // Guest code can alter its own built-ins/prototypes. Bound and validate its
  // returned envelope outside the isolate before forwarding anything to the host.
  if (Buffer.byteLength(result, 'utf8') > message.limits.maxOutputBytes + 16384) {
    send({ type: 'result', outputTruncated: true, output: { message: 'Code Mode output exceeded the output limit. Return a smaller summary.' } })
    return
  }
  const response = JSON.parse(result)
  if (!response || (response.type !== 'result' && response.type !== 'error')) {
    throw new Error('The isolated program returned an invalid execution result.')
  }
  send(response)
}

process.on('message', (message) => {
  if (message.type === 'tool-result') {
    if (receiver && isolate && !isolate.isDisposed) {
      void receiver.apply(undefined, [JSON.stringify(message)], { timeout: executionTimeout }).catch((error) => {
        send({ type: 'error', diagnostic: { kind: 'ExecutionError', message: error.message } })
      })
    }
  } else if (message.type === 'execute' && !started) {
    started = true
    void execute(message).catch((error) => {
      const match = /tidecode-exec\.js:(\d+)(?::(\d+))?/.exec(String(error.stack ?? ''))
      let kind = error.name === 'SyntaxError' ? 'ParseError' : (error.name ?? 'ExecutionError')
      if (/memory limit|disposed|allocation failed/i.test(error.message)) kind = 'MemoryLimitExceeded'
      if (/timed out/i.test(error.message)) kind = 'TimeoutExceeded'
      send({ type: 'error', diagnostic: {
        kind, message: error.message,
        ...(match ? { location: { line: Math.max(1, Number(match[1])), column: Number(match[2] ?? 1) } } : {}),
      } })
    }).finally(cleanup)
  }
})
process.on('disconnect', () => {
  cleanup()
  process.exit(0)
})
