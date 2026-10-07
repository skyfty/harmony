import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createSharedWorkerTemplate } from './emitMpWorkerBundlePlugin.ts'
import { createSparkWorkerSource } from './sparkWasmExternalPlugin.ts'

/**
 * Spark's decoder worker and the minisheep basis (KTX2) transcoder worker end up
 * in the same physical WeChat worker (`pages/scenery/workers/index.js`). The
 * basis module installs a global `setWASMInstantiateInputMapper(...)` mapper
 * that ignores the requested path, so every `WXWebAssembly.instantiate` call in
 * that context is handed the basis wasm. Spark then failed with
 *
 *   WebAssembly.instantiate(): Import #0 "a": module is not an object or function
 *
 * because the basis wasm imports module "a" while Spark's imports only provide
 * "./spark_rs_bg.js".
 */

const SPARK_WASM_PATH = 'pages/spark/spark_rs_bg.wasm'
const BASIS_WASM_PATH = 'pages/scenery/wasms/basis_transcoder.wasm.br'
const SPARK_IMPORT_NAMESPACE = './spark_rs_bg.js'
const BASIS_IMPORT_NAMESPACE = 'a'

const viteDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(viteDir, '../../..')
const minisheepWorkerAdapterPath = path.join(
  repoRoot,
  'scenery',
  'node_modules',
  '@minisheep',
  'three-platform-adapter',
  'dist',
  'three-override',
  'local',
  'worker',
  'worker-adapter.js',
)
const sparkModulePath = path.join(
  repoRoot,
  'schema',
  'node_modules',
  '@sparkjsdev',
  'spark',
  'dist',
  'spark.module.js',
)

type InstantiateCall = {
  path: unknown
  importNamespaces: string[]
}

type WorkerSandbox = {
  context: vm.Context
  scope: Record<string, unknown>
  calls: InstantiateCall[]
  warnings: string[]
  requiredIds: string[]
  usedRealAdapter: boolean
}

type InstantiateLike = (path: unknown, imports: unknown) => unknown

/**
 * Minimal stand-in for the WeChat worker global: a `worker` transport, a
 * recording `WXWebAssembly`, and a `require` that loads the real minisheep
 * worker adapter (the module that patches `WXWebAssembly.instantiate`).
 */
function createWorkerSandbox(): WorkerSandbox {
  const calls: InstantiateCall[] = []
  const warnings: string[] = []
  const requiredIds: string[] = []

  const hostWasm = {
    instantiate(path: unknown, imports: unknown): unknown {
      calls.push({
        path,
        importNamespaces: imports && typeof imports === 'object' ? Object.keys(imports) : [],
      })
      return Promise.resolve({
        instance: { exports: { __wbindgen_start() {} } },
        module: {},
      })
    },
  }

  const scope: Record<string, unknown> = {
    console: {
      log: () => undefined,
      info: () => undefined,
      error: (...args: unknown[]) => {
        warnings.push(args.map((value) => String(value)).join(' '))
      },
      warn: (...args: unknown[]) => {
        warnings.push(args.map((value) => String(value)).join(' '))
      },
    },
    worker: {
      onMessage: () => undefined,
      postMessage: () => undefined,
    },
    WXWebAssembly: hostWasm,
  }
  const context = vm.createContext(scope)

  const runCommonJsModule = (source: string, filename: string): Record<string, unknown> => {
    const factory = vm.runInContext(
      `(function (exports, module, require) {\n${source}\n})`,
      context,
      { filename },
    ) as (
      exports: Record<string, unknown>,
      module: { exports: Record<string, unknown> },
      require: (id: string) => unknown,
    ) => void
    const moduleObject = { exports: {} as Record<string, unknown> }
    factory(moduleObject.exports, moduleObject, () => {
      throw new Error('sandbox module must not require anything')
    })
    return moduleObject.exports
  }

  // Mirrors `@minisheep/three-platform-adapter`'s worker adapter: it owns the
  // path mapper and rewrites the input of every `WXWebAssembly.instantiate`.
  const installAdapterPatch = (): void => {
    let currentMapper: ((input: unknown) => unknown) | null = null
    const wasm = hostWasm as { instantiate: InstantiateLike }
    const native = wasm.instantiate
    wasm.instantiate = (input, imports) => native(currentMapper ? currentMapper(input) : input, imports)
    scope.setWASMInstantiateInputMapper = (mapper: unknown) => {
      if (typeof mapper === 'function') {
        currentMapper = mapper as (input: unknown) => unknown
      }
    }
  }

  const usedRealAdapter = fs.existsSync(minisheepWorkerAdapterPath)
  scope.require = (id: string): unknown => {
    requiredIds.push(id)
    if (id === './worker-adapter.js') {
      if (usedRealAdapter) {
        return runCommonJsModule(fs.readFileSync(minisheepWorkerAdapterPath, 'utf8'), minisheepWorkerAdapterPath)
      }
      installAdapterPatch()
      return {
        proxySelf: {
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => true,
          postMessage: () => undefined,
        },
      }
    }
    return {}
  }

  return { context, scope, calls, warnings, requiredIds, usedRealAdapter }
}

function runSharedWorkerTemplate(sandbox: WorkerSandbox): void {
  vm.runInContext(createSharedWorkerTemplate(), sandbox.context, { filename: 'index.js' })
}

test('shared worker keeps a raw WXWebAssembly.instantiate that the basis mapper cannot hijack', async (t) => {
  const sandbox = createWorkerSandbox()
  t.diagnostic(
    sandbox.usedRealAdapter
      ? 'using the installed @minisheep/three-platform-adapter worker-adapter.js'
      : 'worker-adapter.js not installed; using an equivalent in-test patch',
  )
  runSharedWorkerTemplate(sandbox)

  assert.ok(
    typeof sandbox.scope.__harmonyRawWasmInstantiate === 'function',
    'the shared worker bootstrap must publish the pristine instantiate',
  )
  assert.ok(
    sandbox.requiredIds.includes('./worker-adapter.js'),
    'the shared worker bootstrap must still load the minisheep worker adapter',
  )

  // The basis transcoder worker installs its mapper once the adapter exists.
  const setMapper = sandbox.scope.setWASMInstantiateInputMapper
  assert.equal(typeof setMapper, 'function')
  ;(setMapper as (mapper: () => string) => void)(() => BASIS_WASM_PATH)

  const sparkImports: Record<string, unknown> = { [SPARK_IMPORT_NAMESPACE]: {} }
  const rawInstantiate = sandbox.scope.__harmonyRawWasmInstantiate as InstantiateLike
  await rawInstantiate(SPARK_WASM_PATH, sparkImports)
  assert.deepEqual(sandbox.calls.at(-1), {
    path: SPARK_WASM_PATH,
    importNamespaces: [SPARK_IMPORT_NAMESPACE],
  })

  const patchedWasm = sandbox.scope.WXWebAssembly as { instantiate: InstantiateLike }
  await patchedWasm.instantiate('basis_transcoder.wasm', { [BASIS_IMPORT_NAMESPACE]: {} })
  assert.deepEqual(sandbox.calls.at(-1), {
    path: BASIS_WASM_PATH,
    importNamespaces: [BASIS_IMPORT_NAMESPACE],
  })

  // Reproduces the reported failure for every caller that does not opt out.
  await patchedWasm.instantiate(SPARK_WASM_PATH, sparkImports)
  assert.deepEqual(sandbox.calls.at(-1), {
    path: BASIS_WASM_PATH,
    importNamespaces: [SPARK_IMPORT_NAMESPACE],
  })
})

test('shared worker captures the raw instantiate before the minisheep adapter patches it', () => {
  const template = createSharedWorkerTemplate()
  const captureAt = template.indexOf('globalThis.__harmonyRawWasmInstantiate = __harmonyRawWasmInstantiate;')
  const adapterAt = template.indexOf("require('./worker-adapter.js')")
  assert.ok(captureAt >= 0, 'template must capture the pristine instantiate')
  assert.ok(adapterAt >= 0, 'template must load the minisheep worker adapter')
  assert.ok(captureAt < adapterAt, 'the capture must run before the adapter rewrites instantiate')
})

test('generated Spark worker prefers the raw instantiate and keeps its fallbacks', () => {
  const workerSource = createSparkWorkerSource(fs.readFileSync(sparkModulePath, 'utf8'))

  const rawAt = workerSource.indexOf('globalThis.__harmonyRawWasmInstantiate')
  const adapterAt = workerSource.indexOf('WXWebAssembly.instantiate(__sparkWasmPath')
  const glueAt = workerSource.indexOf('__wbg_init({ module_or_path: __sparkWasmPath })')

  assert.ok(rawAt >= 0, 'Spark worker must look up the raw instantiate')
  assert.ok(adapterAt >= 0, 'Spark worker must keep the adapter-patched fallback')
  assert.ok(glueAt >= 0, 'Spark worker must keep the wasm-bindgen fallback')
  assert.ok(rawAt < adapterAt, 'the raw instantiate must be tried before the patched one')
  assert.ok(adapterAt < glueAt, 'the patched call must be tried before the wasm-bindgen glue')
  assert.ok(
    workerSource.includes('await __sparkRawInstantiate(__sparkWasmPath, __sparkWasmImports)'),
    'Spark worker must instantiate with the raw call and a single imports object',
  )
})

test('Spark worker decode branch still consumes fileBytes without a ReadableStream', () => {
  const workerSource = createSparkWorkerSource(fs.readFileSync(sparkModulePath, 'utf8'))
  assert.ok(workerSource.includes('decoder.push(fileBytes);'))
  assert.ok(workerSource.includes('return decoder.finish();'))
})

/**
 * One physical WeChat worker hosts every logical worker, and the minisheep
 * dispatcher hands every message to every listener. Spark's RPC handler used to
 * answer those foreign envelopes with `Unknown worker RPC: undefined`, which
 * flooded the console (and the RPC channel) once physics/instanced-LOD started
 * posting.
 */
test('Spark worker ignores other logical workers messages but still answers its own RPCs', async () => {
  const posts: Array<Record<string, unknown>> = []
  let workerListener: ((event: unknown) => void) | null = null
  const scope: Record<string, unknown> = {
    console: {
      log: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    worker: {
      onMessage(callback: (event: unknown) => void) {
        workerListener = callback
      },
      postMessage(message: unknown) {
        posts.push(message as Record<string, unknown>)
      },
    },
    WXWebAssembly: {
      instantiate() {
        return Promise.resolve({
          instance: { exports: { __wbindgen_start() {} } },
          module: {},
        })
      },
    },
    // The generated worker body budgets on the usual timer/JSON globals the
    // WeChat worker runtime provides.
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    Date,
    Math,
    JSON,
    Promise,
  }
  const context = vm.createContext(scope)
  const moduleCache = new Map<string, Record<string, unknown>>()
  const runCommonJsModule = (source: string, filename: string): Record<string, unknown> => {
    const factory = vm.runInContext(
      `(function (exports, module, require) {\n${source}\n})`,
      context,
      { filename },
    ) as (exports: Record<string, unknown>, module: { exports: Record<string, unknown> }, require: (id: string) => unknown) => void
    const moduleObject = { exports: {} as Record<string, unknown> }
    factory(moduleObject.exports, moduleObject, requireStub)
    return moduleObject.exports
  }
  function requireStub(id: string): Record<string, unknown> {
    const cached = moduleCache.get(id)
    if (cached) {
      return cached
    }
    const loaded = id === './worker-adapter.js' && fs.existsSync(minisheepWorkerAdapterPath)
      ? runCommonJsModule(fs.readFileSync(minisheepWorkerAdapterPath, 'utf8'), minisheepWorkerAdapterPath)
      : {}
    moduleCache.set(id, loaded)
    return loaded
  }
  scope.require = requireStub

  // Load the real adapter (it owns the shared message dispatcher), then the
  // generated Spark worker on top of it.
  requireStub('./worker-adapter.js')
  const workerSource = createSparkWorkerSource(fs.readFileSync(sparkModulePath, 'utf8'))
  const factory = vm.runInContext(
    `(function (exports, module, require) {\n${workerSource}\n})`,
    context,
    { filename: 'spark.worker.js' },
  ) as (exports: Record<string, unknown>, module: { exports: Record<string, unknown> }, require: (id: string) => unknown) => void
  factory({}, { exports: {} }, requireStub)

  const dispatch = (payload: unknown): void => {
    assert.ok(workerListener, 'the adapter must have registered the worker listener')
    // WeChat hands the raw payload to `worker.onMessage`; the adapter forwards it
    // verbatim as `event.data`.
    ;(workerListener as (event: unknown) => void)(payload)
  }
  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  dispatch({ name: 'init-wasm', module: 'pages/spark/spark_rs_bg.wasm' })
  await flush()

  posts.length = 0
  dispatch({ __scope: 'physics', clientId: 1, message: { id: 1, type: 'init', payload: {} } })
  dispatch({ kind: 'revision', revision: 4, candidates: [] })
  await flush()
  assert.deepEqual(posts.map((post) => post.id), [], 'foreign envelopes must not be answered')

  dispatch({ id: 'harmony-raw:3:1', name: 'newLodTree', args: { capacity: 16 } })
  await flush()
  assert.deepEqual(
    posts.map((post) => post.id),
    ['harmony-raw:3:1'],
    'Spark RPCs must still be answered (result or error) with their routed id',
  )
})
