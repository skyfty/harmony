import fs from 'node:fs'
import path from 'node:path'

type VitePluginLike = {
  name: string
  apply?: 'build' | 'serve'
  outputOptions?: (options: Record<string, unknown>) => Record<string, unknown>
  writeBundle?: () => Promise<void> | void
}

export type MpWorkerBundleAlias = {
  find: string | RegExp
  replacement: string
}

export type EmitMpWorkerBundlePluginOptions = {
  enabled?: boolean
  entryPath: string
  outputFileName: string
  aliases?: MpWorkerBundleAlias[]
}

/**
 * WeChat mini programs keep a single `worker.onMessage` listener, so every
 * logical worker (physics / instanced LOD / asset download / Spark / basis
 * transcoder) is require()d into one physical worker file. That shared context
 * is also shared by the minisheep worker adapter, which replaces
 * `WXWebAssembly.instantiate` with a wrapper that rewrites the requested path
 * through whatever `setWASMInstantiateInputMapper(...)` mapper was installed
 * last.
 *
 * The basis transcoder worker installs a mapper that ignores its input and
 * always returns its own wasm, which is correct for that worker but wrong for
 * every other wasm consumer in the same physical worker (Spark's splat
 * decoder). Capture the pristine instantiate before the adapter patches it and
 * publish it as `globalThis.__harmonyRawWasmInstantiate` so those consumers can
 * opt out of the mapper.
 */
export function createSharedWorkerTemplate(): string {
  return `'use strict';

var __harmonyRawWasmInstantiate = typeof globalThis !== 'undefined'
  && typeof globalThis.__harmonyRawWasmInstantiate === 'function'
  ? globalThis.__harmonyRawWasmInstantiate
  : null;
if (!__harmonyRawWasmInstantiate) {
  try {
    if (
      typeof WXWebAssembly !== 'undefined'
      && WXWebAssembly
      && typeof WXWebAssembly.instantiate === 'function'
    ) {
      var __harmonyWasmHost = WXWebAssembly;
      var __harmonyWasmInstantiate = __harmonyWasmHost.instantiate;
      __harmonyRawWasmInstantiate = function (path, imports) {
        return __harmonyWasmInstantiate.call(__harmonyWasmHost, path, imports);
      };
      if (typeof globalThis !== 'undefined') {
        globalThis.__harmonyRawWasmInstantiate = __harmonyRawWasmInstantiate;
      }
    }
  } catch (error) {
    console.warn('[harmony-shared-worker] failed to capture raw WXWebAssembly.instantiate', error);
  }
}

var worker = typeof worker !== 'undefined' ? worker : (typeof globalThis !== 'undefined' ? globalThis.worker : undefined);
if (!worker || typeof worker.onMessage !== 'function' || typeof worker.postMessage !== 'function') {
  throw new Error('[harmony-shared-worker] worker API is not available');
}

// WeChat Worker only keeps ONE worker.onMessage listener: every later call
// replaces the previous one, and the property itself cannot be reassigned or
// redefined (assigning/defining it throws "Cannot redefine property:
// onMessage"). All logical workers in this file (physics / basis / meshopt /
// instanced LOD culling) therefore have to share a single dispatcher.
//
// The minisheep worker-adapter registers worker.onMessage exactly once at
// module load and then exposes a DOM-like EventTarget through proxySelf
// (addEventListener/postMessage). Load it FIRST so that every later
// require('../worker-adapter.js') from basis/draco reuses the cached module
// instead of registering a second listener, then let physics register its
// message handler through the same EventTarget.
var sharedSelf = null;
try {
  var sharedWorkerAdapter = require('./worker-adapter.js');
  if (sharedWorkerAdapter && sharedWorkerAdapter.proxySelf) {
    sharedSelf = sharedWorkerAdapter.proxySelf;
    globalThis.__harmonyWorkerSelf = sharedSelf;
    if (globalThis.self !== sharedSelf) {
      try {
        Object.defineProperty(globalThis, 'self', {
          value: sharedSelf,
          configurable: true,
          enumerable: false,
          writable: true,
        });
      } catch (defineError) {
        try {
          globalThis.self = sharedSelf;
        } catch (assignError) {
          console.warn(
            '[harmony-shared-worker] failed to expose proxy self globally; sub-workers bind it locally',
            defineError,
            assignError,
          );
        }
      }
    }
  } else {
    console.warn('[harmony-shared-worker] worker adapter loaded without proxySelf');
  }
} catch (error) {
  console.warn('[harmony-shared-worker] worker adapter unavailable; physics will register its own listener', error);
}

try {
  require('./physics-cannon.worker.js');
} catch (error) {
  console.error('[harmony-shared-worker] physics worker init failed', error);
}

try {
  require('./instancedLodCulling.worker.js');
} catch (error) {
  console.warn('[harmony-shared-worker] instanced LOD culling worker init failed', error);
}

try {
  require('./assetDownload.worker.js');
} catch (error) {
  console.warn('[harmony-shared-worker] asset download worker init failed', error);
}

try {
  require('./spark.worker.js');
} catch (error) {
  console.error('[harmony-shared-worker] spark worker init failed', error);
}

try {
  require('./basis/basis_transcoder.js');
} catch (error) {
  console.error('[harmony-shared-worker] basis transcoder init failed', error);
}
`
}

// The minisheep worker-adapter decoder does not guard against null:
// `typeof null === 'object'`, so deep-decoding a message that contains a null
// value throws "Cannot read properties of null (reading 'constructor')".
// Physics commands/responses legitimately carry null (e.g. payload: null), so
// make the emitted adapter null-safe before it is used inside the shared
// worker.
function patchWechatWorkerAdapter(workersDir: string): void {
  const adapterPath = path.join(workersDir, 'worker-adapter.js')
  if (!fs.existsSync(adapterPath)) {
    return
  }
  let code = fs.readFileSync(adapterPath, 'utf8')
  const needle = 'function e(t){switch(typeof t){case"object":if("Object"===t.constructor.name)'
  const replacement = 'function e(t){if(null===t)return t;switch(typeof t){case"object":if("Object"===t.constructor.name)'
  if (!code.includes('function e(t){if(null===t)return t;') && code.includes(needle)) {
    code = code.split(needle).join(replacement)
    fs.writeFileSync(adapterPath, code, 'utf8')
    console.info('[harmony-worker] patched worker-adapter.js decode for null safety')
  }
}

export function emitMpWorkerBundlePlugin(options: EmitMpWorkerBundlePluginOptions): VitePluginLike {
  const isMp = process.env.UNI_PLATFORM?.startsWith('mp-') ?? false
  const enabled = options.enabled !== false && isMp
  let outputDir = ''

  return {
    name: 'harmony:emit-mp-worker-bundle',
    apply: 'build',
    outputOptions(outputOptions: Record<string, unknown>) {
      outputDir = typeof outputOptions.dir === 'string' ? outputOptions.dir : ''
      return outputOptions
    },
    async writeBundle() {
      if (!enabled || !outputDir) {
        return
      }

      const workersDir = path.resolve(outputDir, 'pages/scenery/workers')
      fs.mkdirSync(workersDir, { recursive: true })

      try {
        const viteModule = await import('vite') as unknown as {
          build?: (config: Record<string, unknown>) => Promise<unknown>
          transformWithEsbuild?: (
            code: string,
            filename: string,
            options?: { target?: string; loader?: string },
          ) => Promise<{ code: string }>
          default?: {
            build?: (config: Record<string, unknown>) => Promise<unknown>
            transformWithEsbuild?: (
              code: string,
              filename: string,
              options?: { target?: string; loader?: string },
            ) => Promise<{ code: string }>
          }
        }
        const viteBuild = viteModule.build ?? viteModule.default?.build
        const transformWithEsbuild = viteModule.transformWithEsbuild
          ?? viteModule.default?.transformWithEsbuild
        if (!viteBuild) {
          throw new Error('vite build API is not available')
        }
        await viteBuild({
          configFile: false,
          logLevel: 'error',
          resolve: {
            alias: options.aliases ?? [],
          },
          esbuild: {
            target: 'es2018',
          },
          build: {
            outDir: workersDir,
            emptyOutDir: false,
            target: 'es2018',
            minify: true,
            sourcemap: false,
            lib: {
              entry: options.entryPath,
              formats: ['cjs'],
              fileName: () => options.outputFileName,
            },
            rollupOptions: {
              output: {
                exports: 'named',
                inlineDynamicImports: true,
              },
            },
          },
        })
        fs.writeFileSync(path.join(workersDir, 'index.js'), createSharedWorkerTemplate(), 'utf8')
        patchWechatWorkerAdapter(workersDir)
        const sparkWorkerPath = path.join(workersDir, 'spark.worker.js')
        if (transformWithEsbuild && fs.existsSync(sparkWorkerPath)) {
          const sparkWorkerSource = fs.readFileSync(sparkWorkerPath, 'utf8')
          const transformed = await transformWithEsbuild(sparkWorkerSource, sparkWorkerPath, {
            target: 'es2018',
            loader: 'js',
          })
          fs.writeFileSync(sparkWorkerPath, transformed.code, 'utf8')
        }
        console.info(`[harmony-worker] emitted ${options.outputFileName} and pages/scenery/workers/index.js`)
      } catch (error) {
        console.error('[harmony-worker] failed to build WeChat shared worker', error)
        throw error
      }
    },
  }
}
