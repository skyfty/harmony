import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import {
  createMvpSizeProbeModule,
  SPARK_WASM_FEATURE_PROBES,
  SPARK_WASM_FOOTPRINT_FEATURES,
  SPARK_WASM_PREFLIGHT_FEATURES,
  SPARK_WASM_REQUIRED_FEATURES,
  createSparkWasmPageBootstrap,
  resolveSparkWasmProbeAssetDir,
  resolveSparkWasmProbeAssets,
  resolveSizeProbeControlFileName,
  sparkWasmExternalPlugin,
} from './sparkWasmExternalPlugin.ts'

const viteDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(viteDir, '../../..')
const sparkModulePath = path.join(
  repoRoot,
  'schema',
  'node_modules',
  '@sparkjsdev',
  'spark',
  'dist',
  'spark.module.js',
)

const SPARK_WASM_PATH = 'pages/spark/spark_rs_bg.wasm'
const IOS_RUNTIME = {
  platform: 'ios',
  system: 'iOS 15.8.4',
  model: 'iPhone 6s Plus<iPhone8,2>',
  version: '8.0.40',
  SDKVersion: '3.4.5',
}

type BootstrapOutcome = { ok: true } | { ok: false; error: Error & { code?: string; __harmonySparkWasmInitFailed?: boolean } }

type BootstrapRun = {
  outcome: Promise<BootstrapOutcome>
  logs: string[]
  instantiateCalls: string[]
  readFileSyncCalls: string[]
  fetchCalls: string[]
}

/**
 * Runs the generated bootstrap plus the same `WASM_MODULE` / `initialization`
 * wrapper the bundle uses, inside a WeChat-like VM scope.
 */
function runBootstrap(options: {
  /** `WXWebAssembly.instantiate(path, imports)`. Omit to emulate a platform without it. */
  instantiate?: (wasmPath: string) => Promise<unknown> | unknown
  readFileSync?: (filePath: string) => unknown
  /** `fetch(url)` used by the legacy non-WeChat fallback. */
  fetch?: (url: string) => Promise<unknown> | unknown
  /** A byte-capable `WebAssembly.instantiate(bytes, imports)`. */
  instantiateBytes?: (bytes: Uint8Array) => Promise<unknown> | unknown
  /** Mirrors `@minisheep/three-platform-adapter` aliasing WebAssembly to WXWebAssembly. */
  aliasWebAssemblyToWx?: boolean
  /** Overrides the asset name the bundle publishes as `sparkWasmPath`. */
  wasmAssetFileName?: string
  /** Emit-side flag mirrored from `sparkWasmExternalPlugin`. */
  wasmBrotli?: boolean
  /** Extra probes appended to the feature probe run. */
  extraProbes?: ReadonlyArray<{ feature: string; path: string; timeoutMs?: number; note?: string }>
  /** Gate features checked before compiling; defaults to the shipped (empty) list. */
  preflightFeatures?: readonly string[]
}): BootstrapRun {
  const logs: string[] = []
  const instantiateCalls: string[] = []
  const readFileSyncCalls: string[] = []
  const fetchCalls: string[] = []
  const wasmAssetFileName = options.wasmAssetFileName ?? SPARK_WASM_PATH
  const bootstrap = createSparkWasmPageBootstrap({
    wasmAssetFileName,
    probeAssetDir: resolveSparkWasmProbeAssetDir(wasmAssetFileName),
    wasmBrotli: options.wasmBrotli,
    extraProbes: options.extraProbes,
    preflightFeatures: options.preflightFeatures,
  })

  const scope: Record<string, unknown> = {
    console: {
      log: (...args: unknown[]) => {
        logs.push(args.map((value) => String(value)).join(' '))
      },
      warn: () => undefined,
      error: () => undefined,
    },
    wx: {
      getSystemInfoSync: () => ({ ...IOS_RUNTIME }),
      getDeviceInfo: () => ({ platform: 'ios', model: IOS_RUNTIME.model }),
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
      getFileSystemManager: () => ({
        statSync: () => ({ size: 1673327 }),
        readFileSync: (filePath: string) => {
          readFileSyncCalls.push(filePath)
          if (!options.readFileSync) {
            throw new Error('readFileSync:fail permission denied, cannot access file path')
          }
          return options.readFileSync(filePath)
        },
      }),
    },
    WebAssembly: undefined,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    String,
    ArrayBuffer,
    Uint8Array,
    Error,
  }
  if (options.instantiate) {
    const instantiate = options.instantiate
    scope.WXWebAssembly = {
      instantiate: (wasmPath: string) => {
        instantiateCalls.push(wasmPath)
        return instantiate(wasmPath)
      },
    }
  } else {
    delete scope.WXWebAssembly
  }
  if (options.instantiateBytes) {
    const instantiateBytes = options.instantiateBytes
    scope.WebAssembly = {
      instantiate: (bytes: Uint8Array) => instantiateBytes(bytes),
    }
  }
  if (options.fetch) {
    const fetchImpl = options.fetch
    scope.fetch = (url: string) => {
      fetchCalls.push(url)
      return fetchImpl(url)
    }
  }
  const context = vm.createContext(scope)
  scope.globalThis = context
  if (options.aliasWebAssemblyToWx) {
    scope.WebAssembly = scope.WXWebAssembly
  }

  // The bundle supplies these three module-scope bindings before the bootstrap
  // code runs; mirror that here.
  vm.runInContext(
    `var sparkWasmPath = ${JSON.stringify(wasmAssetFileName)};
     var __wbg_get_imports = function () { return { "./spark_rs_bg.js": {} }; };
     var __wbg_finalize_init = function () { return null; };`,
    context,
    { filename: 'spark-wasm-module-preamble.js' },
  )

  const factory = vm.runInContext(
    `(function () {
      return function () {
        var WASM_MODULE = Promise.resolve(sparkWasmPath);
        var initialized = false;
        var initialization = __harmonySparkWasmInit().then((result) => {
          __wbg_finalize_init(result.instance, result.module);
          initialized = true;
        });
        return initialization.then(function () {
          return { ok: true, initialized: initialized };
        }, function (error) {
          return { ok: false, error: error };
        });
      };
    })()`,
    context,
    { filename: 'spark-wasm-bootstrap-factory.js' },
  ) as () => Promise<BootstrapOutcome>
  vm.runInContext(bootstrap, context, { filename: 'spark-wasm-bootstrap.js' })

  return { outcome: factory(), logs, instantiateCalls, readFileSyncCalls, fetchCalls }
}

test('every feature probe is a structurally valid wasm module', () => {
  for (const probe of SPARK_WASM_FEATURE_PROBES) {
    const bytes = Buffer.from(probe.base64, 'base64')
    assert.ok(bytes.length >= 8, `${probe.feature} probe is too short`)
    assert.equal(bytes.subarray(0, 4).toString('hex'), '0061736d', `${probe.feature} probe magic`)
    assert.equal(
      WebAssembly.validate(new Uint8Array(bytes)),
      true,
      `${probe.feature} probe must be a valid wasm module`,
    )
  }
  assert.ok(
    SPARK_WASM_FEATURE_PROBES.some((probe) => probe.feature === 'mvp'),
    'the mvp probe distinguishes "file missing" from "feature missing"',
  )
  for (const feature of SPARK_WASM_REQUIRED_FEATURES) {
    assert.ok(
      SPARK_WASM_FEATURE_PROBES.some((probe) => probe.feature === feature),
      `missing probe for required feature ${feature}`,
    )
  }
})

test('probe assets land next to the emitted spark wasm', () => {
  const dir = resolveSparkWasmProbeAssetDir('pages/spark/spark_rs_bg.wasm')
  assert.equal(dir, 'pages/spark/wasm-probes')
  const assets = resolveSparkWasmProbeAssets(dir)
  assert.equal(assets.length, SPARK_WASM_FEATURE_PROBES.length)
  for (const asset of assets) {
    assert.ok(asset.fileName.startsWith('pages/spark/wasm-probes/'), asset.fileName)
    assert.ok(asset.bytes.byteLength > 0, asset.fileName)
  }
  assert.equal(
    resolveSparkWasmProbeAssetDir('pages/spark/spark_rs_bg.wasm', 'pages/spark/probes/'),
    'pages/spark/probes',
  )
})

test('a runtime that only rejects the spark wasm still passes every probe', async () => {
  const run = runBootstrap({
    instantiate: (wasmPath) => (wasmPath.endsWith('spark_rs_bg.wasm')
      ? Promise.reject(new Error('CompileError: invalid wasm file'))
      : Promise.resolve({ instance: { exports: {} }, module: {} })),
  })

  const outcome = await run.outcome

  assert.equal(outcome.ok, false)
  if (outcome.ok) {
    return
  }
  assert.equal(outcome.error.name, 'SparkWasmInitError')
  assert.equal(outcome.error.code, 'SPARK_WASM_INIT_FAILED')
  assert.equal(outcome.error.__harmonySparkWasmInitFailed, true)

  const joined = run.logs.join('\n')
  assert.match(joined, /^\[SparkWasm\]\[bootstrap\] /m, 'logs must be string-formatted [SparkWasm] lines')
  assert.match(joined, /"stage":"start"/)
  assert.match(joined, /"stage":"read-package-bytes"/)
  assert.match(joined, /"stage":"failed"/)
  assert.match(joined, /"mvp":"ok in \d+ms"/)
  assert.match(joined, /"simd128":"ok in \d+ms"/)
  assert.match(joined, /"iOS 15\.8\.4"/, 'the runtime info must be part of the log')
  for (const feature of SPARK_WASM_REQUIRED_FEATURES) {
    assert.ok(joined.includes(`"${feature}"`), `the diagnostics must mention ${feature}`)
  }
  // The capability gate runs its mvp control first (the shipped gate list is empty
  // because the patched wasm no longer needs reference-types), then the package path
  // is attempted both with and without a leading slash.
  assert.equal(run.instantiateCalls[0], 'pages/spark/wasm-probes/mvp.wasm')
  assert.match(joined, /"stage":"preflight","ok":true/)
  assert.deepEqual(
    run.instantiateCalls.filter((call) => call.includes('spark_rs_bg')),
    [SPARK_WASM_PATH, `/${SPARK_WASM_PATH}`],
  )
  for (const line of run.logs) {
    assert.ok(line.startsWith('[SparkWasm]['), `unexpected log line: ${line}`)
  }
})

test('the byte fallback wins when the runtime compiles bytes but not package paths', async () => {
  const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  const run = runBootstrap({
    // The gate probes compile; only the real wasm path fails, so the chain (and the
    // byte fallback behind it) still runs.
    instantiate: (wasmPath) => (wasmPath.includes('spark_rs_bg')
      ? Promise.reject(new Error('CompileError: invalid wasm file'))
      : Promise.resolve({ instance: { exports: {} }, module: {} })),
    readFileSync: () => wasmBytes,
    aliasWebAssemblyToWx: true,
  })

  // WeChat aliases `WebAssembly` to the path-only `WXWebAssembly`, so the byte
  // strategy cannot help; the log must say exactly that instead of failing
  // silently.
  const outcome = await run.outcome
  assert.equal(outcome.ok, false)
  const joined = run.logs.join('\n')
  assert.match(
    joined,
    /"message":"global WebAssembly is WeChat's path-only WXWebAssembly; byte instantiation is unsupported"/,
  )
  assert.deepEqual(run.readFileSyncCalls, [SPARK_WASM_PATH])
})

test('a runtime missing simd128 is named by the feature probe', async () => {
  const run = runBootstrap({
    instantiate: (wasmPath) => {
      if (wasmPath.endsWith('spark_rs_bg.wasm') || wasmPath.endsWith('simd128.wasm')) {
        return Promise.reject(new Error('CompileError: invalid wasm file'))
      }
      return Promise.resolve({ instance: { exports: {} }, module: {} })
    },
  })

  const outcome = await run.outcome
  assert.equal(outcome.ok, false)

  const joined = run.logs.join('\n')
  const failedLog = run.logs.find((line) => line.includes('"stage":"failed"'))
  assert.ok(failedLog, 'the failure must be logged')
  const payload = JSON.parse(failedLog!.slice(failedLog!.indexOf('{')))
  assert.equal(payload.featureProbe.simd128.startsWith('error:'), true)
  assert.equal(payload.featureProbe.mvp.startsWith('ok in'), true)
  assert.match(joined, /"reference-types":"ok in \d+ms"/)
  assert.equal(payload.wasmPath, SPARK_WASM_PATH)
  assert.deepEqual(payload.requiredFeatures, [...SPARK_WASM_REQUIRED_FEATURES])
  assert.ok(
    run.instantiateCalls.includes('pages/spark/wasm-probes/simd128.wasm'),
    'the simd128 probe must be instantiated',
  )
})

test('platforms without WXWebAssembly keep the legacy fetch fallback', async () => {
  const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  const run = runBootstrap({
    // No WXWebAssembly at all: Douyin/QQ/Baidu mini programs look like this.
    fetch: () => Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(wasmBytes.buffer),
    }),
    instantiateBytes: () => Promise.resolve({ instance: { exports: {} }, module: {} }),
  })

  const outcome = await run.outcome
  assert.equal(outcome.ok, true, 'the fetch strategy must recover on non-WeChat platforms')
  assert.deepEqual(run.fetchCalls, [`/${SPARK_WASM_PATH}`])
  assert.deepEqual(run.instantiateCalls, [], 'no WXWebAssembly call is possible without WXWebAssembly')
  assert.match(
    run.logs.join('\n'),
    /"strategy":"fetch-webassembly-instantiate-bytes","url":"\/pages\/spark\/spark_rs_bg\.wasm","ok":true/,
  )
})

test('plugin transform replaces the unguarded wasm init with the bootstrap', () => {
  const plugin = sparkWasmExternalPlugin({ sparkModulePath })
  const transform = plugin.transform
  assert.ok(transform, 'plugin must expose a transform hook')
  const hook = typeof transform === 'function' ? transform : transform!.handler
  const code = fs.readFileSync(sparkModulePath, 'utf8')
  const output = (hook as (this: unknown, code: string, id: string) => unknown).call(
    {},
    code,
    '/repo/node_modules/@sparkjsdev/spark/dist/spark.module.js',
  )
  assert.ok(typeof output === 'string', 'spark module must be transformed')
  assert.match(output as string, /harmony:spark-wasm-bootstrap/)
  assert.match(output as string, /var initialization = __harmonySparkWasmInit\(\)/)
  assert.doesNotMatch(output as string, /WXWebAssembly\.instantiate\(sparkWasmPath, __wbg_get_imports\(\)\)/)
})

test('the footprint probes cover what the spark wasm actually uses', () => {
  for (const feature of SPARK_WASM_FOOTPRINT_FEATURES) {
    const probe = SPARK_WASM_FEATURE_PROBES.find((candidate) => candidate.feature === feature)
    assert.ok(probe, `missing probe for footprint feature ${feature}`)
    assert.equal(
      WebAssembly.validate(new Uint8Array(Buffer.from(probe!.base64, 'base64'))),
      true,
      `${feature} probe must be a valid wasm module`,
    )
  }
  // 探针集合 = 声明过的特性 + mvp + 按产物足迹补齐的那组，三者缺一不可。
  assert.deepEqual(
    [...SPARK_WASM_FEATURE_PROBES.map((probe) => probe.feature)].sort(),
    [...SPARK_WASM_REQUIRED_FEATURES, 'mvp', ...SPARK_WASM_FOOTPRINT_FEATURES].sort(),
  )
})

test('no probe can ever fail at link time: every probe is import-free', () => {
  for (const probe of SPARK_WASM_FEATURE_PROBES) {
    const module = new WebAssembly.Module(new Uint8Array(Buffer.from(probe.base64, 'base64')))
    assert.deepEqual(
      WebAssembly.Module.imports(module),
      [],
      `${probe.feature} 探针不能带 import：否则真机上会以链接期错误出现，掩盖真正的编译期结论`,
    )
  }
})

test('the synthetic size probe is a valid MVP module near the requested size', () => {
  const bytes = createMvpSizeProbeModule(1600000)
  assert.ok(
    bytes.byteLength > 1500000 && bytes.byteLength < 1700000,
    `the probe must be close to the spark wasm size, got ${bytes.byteLength}`,
  )
  const module = new WebAssembly.Module(bytes)
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  assert.ok(WebAssembly.Module.exports(module).length > 0, 'exports keep the functions alive')
  assert.equal(
    resolveSizeProbeControlFileName('pages/physics-cannon/probes/large-mvp.wasm'),
    'pages/physics-cannon/probes/control-mvp.wasm',
  )
  assert.equal(resolveSizeProbeControlFileName('large-mvp.wasm'), 'control-mvp.wasm')
})

test('the failure diagnostics separate synchronous compile time from the async wait', async () => {
  const run = runBootstrap({
    instantiate: (wasmPath) => (wasmPath.endsWith('spark_rs_bg.wasm')
      ? Promise.reject(new Error('CompileError: invalid wasm file'))
      : Promise.resolve({ instance: { exports: {} }, module: {} })),
  })

  const outcome = await run.outcome
  assert.equal(outcome.ok, false)

  const attemptLog = run.logs.find((line) => line.includes('"path-candidate-0"'))
  assert.ok(attemptLog, 'the first path candidate must be logged')
  const attempt = JSON.parse(attemptLog!.slice(attemptLog!.indexOf('{')))
  assert.equal(typeof attempt.at, 'string', 'every log line carries a wall-clock timestamp')
  assert.equal(typeof attempt.tMs, 'number', 'every log line carries a monotonic timestamp')
  assert.equal(typeof attempt.callMs, 'number', 'callMs separates the synchronous call from the wait')
  assert.equal(typeof attempt.settleMs, 'number')
  assert.equal(typeof attempt.ms, 'number')

  const failedLog = run.logs.find((line) => line.includes('"stage":"failed"'))
  const payload = JSON.parse(failedLog!.slice(failedLog!.indexOf('{')))
  assert.equal(typeof payload.failures[0].error.timing.callMs, 'number', 'failures must carry the timings')
  assert.equal(typeof payload.featureProbeTiming.mvp.totalMs, 'number')
  assert.equal(typeof payload.featureProbeTiming.mvp.callMs, 'number')
  assert.equal(payload.wasmPath, SPARK_WASM_PATH)
})

test('extra probes (size probe plus its same-directory control) run after a failure', async () => {
  const controlPath = 'pages/physics-cannon/probes/control-mvp.wasm'
  const sizeProbePath = 'pages/physics-cannon/probes/large-mvp.wasm'
  const run = runBootstrap({
    instantiate: (wasmPath) => (wasmPath.endsWith('spark_rs_bg.wasm')
      ? Promise.reject(new Error('CompileError: invalid wasm file'))
      : Promise.resolve({ instance: { exports: {} }, module: {} })),
    extraProbes: [
      { feature: 'size-mvp-control', path: controlPath, note: 'control' },
      { feature: 'size-mvp', path: sizeProbePath, timeoutMs: 120000, note: 'synthetic MVP-only module, 1600000 bytes' },
    ],
  })

  const outcome = await run.outcome
  assert.equal(outcome.ok, false)

  const failedLog = run.logs.find((line) => line.includes('"stage":"failed"'))
  const payload = JSON.parse(failedLog!.slice(failedLog!.indexOf('{')))
  assert.equal(payload.featureProbe['size-mvp-control'].startsWith('ok in'), true)
  assert.equal(payload.featureProbe['size-mvp'].startsWith('ok in'), true)
  assert.equal(payload.extraProbes['size-mvp'], 'synthetic MVP-only module, 1600000 bytes')
  assert.ok(run.instantiateCalls.includes(controlPath), 'the control probe must be instantiated')
  assert.ok(run.instantiateCalls.includes(sizeProbePath), 'the size probe must be instantiated')
  assert.match(run.logs.join('\n'), /"extraProbes":\{"size-mvp-control":/)
})

test('brotli mode loads the .br asset and never byte-instantiates it', async () => {
  const brotliPath = `${SPARK_WASM_PATH}.br`
  const run = runBootstrap({
    wasmAssetFileName: brotliPath,
    wasmBrotli: true,
    instantiate: (wasmPath) => (wasmPath.includes('spark_rs_bg')
      ? Promise.reject(new Error('CompileError: invalid wasm file'))
      : Promise.resolve({ instance: { exports: {} }, module: {} })),
  })

  const outcome = await run.outcome
  assert.equal(outcome.ok, false)

  const joined = run.logs.join('\n')
  assert.match(joined, /"brotli":true/, 'the diagnostics must say the asset is brotli')
  assert.match(joined, /"stage":"byte-fallback-skipped"/)
  assert.deepEqual(
    run.instantiateCalls.filter((call) => call.includes('spark_rs_bg')),
    [brotliPath, `/${brotliPath}`],
  )
  assert.deepEqual(run.fetchCalls, [], 'a brotli asset cannot be fetched as wasm bytes')
  assert.deepEqual(run.readFileSyncCalls, [], 'a brotli asset cannot be read as wasm bytes')
})

test('the capability gate fails fast instead of compiling the 1.6MB wasm', async () => {
  const unsupportedFeatures = ['multi-table', 'externref-signature']
  const run = runBootstrap({
    // The shipped gate list is empty (the patched wasm needs none of these), so this
    // test drives the mechanism with the list that was live before the rebuild.
    preflightFeatures: unsupportedFeatures,
    instantiate: (wasmPath) => {
      const feature = wasmPath.split('/').pop()!.replace('.wasm', '')
      if (wasmPath.includes('spark_rs_bg') || unsupportedFeatures.includes(feature)) {
        return Promise.reject(new Error('CompileError: invalid wasm file'))
      }
      return Promise.resolve({ instance: { exports: {} }, module: {} })
    },
  })

  const outcome = await run.outcome
  assert.equal(outcome.ok, false)
  if (outcome.ok) {
    return
  }
  assert.equal(outcome.error.code, 'SPARK_WASM_UNSUPPORTED_FEATURE')
  assert.equal(outcome.error.__harmonySparkWasmInitFailed, true, 'the existing wasm-failed detection must keep working')
  assert.match(outcome.error.message, /multi-table/)

  // 关键：完全没有碰那 1.6MB 模块，也没有走字节/fetch 后路。
  assert.deepEqual(run.instantiateCalls.filter((call) => call.includes('spark_rs_bg')), [])
  assert.deepEqual(run.readFileSyncCalls, [])
  assert.deepEqual(run.fetchCalls, [])

  const joined = run.logs.join('\n')
  assert.match(joined, /"stage":"preflight","ok":false/)
  assert.match(joined, /"unsupportedFeatures":\["multi-table","externref-signature"\]/)

  const unsupportedLog = run.logs.find((line) => line.includes('"stage":"unsupported"'))
  assert.ok(unsupportedLog, 'the full probe report must still be produced')
  const payload = JSON.parse(unsupportedLog!.slice(unsupportedLog!.indexOf('{')))
  assert.deepEqual(payload.unsupportedFeatures, unsupportedFeatures)
  assert.equal(payload.featureProbe['multi-table'].startsWith('error:'), true)
  assert.equal(payload.featureProbe.mvp.startsWith('ok in'), true)
  assert.equal(typeof payload.preflightTiming.mvp.totalMs, 'number')
})

test('the gate stays inert when its own control probe cannot compile', async () => {
  const run = runBootstrap({
    preflightFeatures: ['multi-table', 'externref-signature'],
    instantiate: (wasmPath) => {
      const feature = wasmPath.split('/').pop()!.replace('.wasm', '')
      if (feature === 'mvp' || wasmPath.includes('spark_rs_bg')) {
        return Promise.reject(new Error('CompileError: invalid wasm file'))
      }
      return Promise.resolve({ instance: { exports: {} }, module: {} })
    },
  })

  const outcome = await run.outcome
  assert.equal(outcome.ok, false)
  if (!outcome.ok) {
    // 门禁自身不可信时不能拿它判死：仍然走原来的失败路径。
    assert.equal(outcome.error.code, 'SPARK_WASM_INIT_FAILED')
  }
  assert.ok(
    run.instantiateCalls.some((call) => call.includes('spark_rs_bg')),
    'the real path attempt must still happen when the gate cannot judge',
  )
  assert.match(
    run.logs.join('\n'),
    /"stage":"preflight-skipped","reason":"the mvp control probe did not compile/,
  )
})

type WasmFootprint = {
  externrefValueSlots: number
  tableCount: number
  passiveDataSegmentCount: number
  targetFeatures: string[]
}

function readLeb(bytes: Uint8Array, start: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let index = start
  for (;;) {
    const byte = bytes[index++]
    value |= (byte & 0x7f) << shift
    shift += 7
    if ((byte & 0x80) === 0) {
      break
    }
  }
  return { value: value >>> 0, next: index }
}

/** Skips one constant/global.get initializer expression (terminated by `end`). */
function skipInitializerExpression(bytes: Uint8Array, start: number): number {
  let index = start
  for (;;) {
    const opcode = bytes[index++]
    if (opcode === 0x0b) return index
    if (opcode === 0x41 || opcode === 0x42 || opcode === 0x23 || opcode === 0xd2) { index = readLeb(bytes, index).next; continue }
    if (opcode === 0x43) { index += 4; continue }
    if (opcode === 0x44) { index += 8; continue }
    if (opcode === 0xfd) { index = readLeb(bytes, index).next + 16; continue }
    if (opcode === 0xd0) { index += 1; continue }
    if (opcode === 0x00 || opcode === 0xd1) continue
    throw new Error(`unexpected initializer opcode 0x${opcode.toString(16)}`)
  }
}

/** Parses the parts of the footprint that decide whether a runtime can compile it. */
function describeWasmFootprint(bytes: Uint8Array): WasmFootprint {
  const footprint: WasmFootprint = {
    externrefValueSlots: 0,
    tableCount: 0,
    passiveDataSegmentCount: 0,
    targetFeatures: [],
  }
  let index = 8
  while (index < bytes.length) {
    const sectionId = bytes[index++]
    const size = readLeb(bytes, index)
    index = size.next
    const sectionEnd = index + size.value
    if (sectionId === 1) {
      const typeCount = readLeb(bytes, index).value
      let cursor = readLeb(bytes, index).next
      for (let i = 0; i < typeCount; i += 1) {
        cursor += 1 // form byte
        const paramCount = readLeb(bytes, cursor)
        cursor = paramCount.next
        for (let p = 0; p < paramCount.value; p += 1) {
          if (bytes[cursor] === 0x6f) footprint.externrefValueSlots += 1
          cursor += 1
        }
        const resultCount = readLeb(bytes, cursor)
        cursor = resultCount.next
        if (resultCount.value !== 0x40) {
          for (let r = 0; r < resultCount.value; r += 1) {
            if (bytes[cursor] === 0x6f) footprint.externrefValueSlots += 1
            cursor += 1
          }
        }
      }
    } else if (sectionId === 4) {
      footprint.tableCount = readLeb(bytes, index).value
    } else if (sectionId === 11) {
      const segmentCount = readLeb(bytes, index)
      let cursor = segmentCount.next
      for (let i = 0; i < segmentCount.value; i += 1) {
        const flag = readLeb(bytes, cursor)
        cursor = flag.next
        if (flag.value === 1) {
          footprint.passiveDataSegmentCount += 1
        } else if (flag.value === 2) {
          cursor = readLeb(bytes, cursor).next
          cursor = skipInitializerExpression(bytes, cursor)
        } else if (flag.value === 0) {
          cursor = skipInitializerExpression(bytes, cursor)
        } else {
          throw new Error(`unexpected data segment flag ${flag.value}`)
        }
        const byteLength = readLeb(bytes, cursor)
        cursor = byteLength.next + byteLength.value
      }
    } else if (sectionId === 0) {
      const nameLength = readLeb(bytes, index)
      const name = Buffer.from(bytes.subarray(nameLength.next, nameLength.next + nameLength.value)).toString('utf8')
      if (name === 'target_features') {
        let cursor = nameLength.next + nameLength.value
        const featureCount = readLeb(bytes, cursor)
        cursor = featureCount.next
        for (let i = 0; i < featureCount.value; i += 1) {
          const sign = String.fromCharCode(bytes[cursor++])
          const featureLength = readLeb(bytes, cursor)
          cursor = featureLength.next
          const feature = Buffer.from(bytes.subarray(cursor, cursor + featureLength.value)).toString('utf8')
          cursor += featureLength.value
          footprint.targetFeatures.push(`${sign}${feature}`)
        }
      }
    }
    index = sectionEnd
  }
  return footprint
}

function extractShippedSparkWasm(): Uint8Array {
  const source = fs.readFileSync(sparkModulePath, 'utf8')
  const declaration = source.indexOf('var spark_rs_bg_default')
  assert.ok(declaration >= 0, 'the shipped spark bundle must embed the wasm')
  const base64Start = source.indexOf('("AGFzb', declaration)
  assert.ok(base64Start >= 0, 'the embedded wasm must be a base64 "AGFzb" literal')
  const base64End = source.indexOf('")', base64Start + 2)
  assert.ok(base64End > base64Start, 'the embedded wasm literal must terminate')
  return new Uint8Array(Buffer.from(source.slice(base64Start + 2, base64End), 'base64'))
}

test('the shipped spark wasm no longer needs the constructs that iOS WeChat cannot compile', () => {
  const wasm = extractShippedSparkWasm()
  assert.equal(WebAssembly.validate(wasm), true, 'the shipped wasm must be valid')
  const footprint = describeWasmFootprint(wasm)

  // 2026-10-08 真机实测微信 iOS（8.0.78 / iOS 15.8.4）编不了：两张表、externref 作为值、
  // 被动 data 段 + memory.init。官方产物带着前两项，自建构建（-reference-types）已经去掉。
  assert.equal(footprint.externrefValueSlots, 0, 'externref 值槽会让 iOS 微信编译失败')
  assert.equal(footprint.tableCount, 1, '多张表会让 iOS 微信编译失败')
  assert.equal(
    footprint.targetFeatures.includes('+reference-types'),
    false,
    'target_features 里残留 +reference-types 会让 wasm-bindgen 重新启用 externref',
  )
  assert.ok(footprint.targetFeatures.includes('+simd128'), 'SIMD 仍需保留（真机探针证明支持）')

  // 门禁列表只能是“产物真实用到”的构造，否则会把本来能跑的运行时误杀。
  const requiredByShippedWasm: Record<string, boolean> = {
    'multi-table': footprint.tableCount > 1,
    'externref-signature': footprint.externrefValueSlots > 0,
    'memory-init': footprint.passiveDataSegmentCount > 0,
  }
  for (const feature of SPARK_WASM_PREFLIGHT_FEATURES) {
    assert.equal(
      requiredByShippedWasm[feature],
      true,
      `门禁里的 ${feature} 必须是发货产物真实用到的构造`,
    )
  }
  assert.deepEqual(SPARK_WASM_PREFLIGHT_FEATURES, [], '自建构建后门禁应为空（保留为触发式陷阱）')
  assert.ok(SPARK_WASM_FOOTPRINT_FEATURES.includes('memory-init'), '足迹探针保留 memory-init 作为诊断')
})
