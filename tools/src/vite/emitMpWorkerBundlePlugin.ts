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

const SHARED_WORKER_TEMPLATE = `'use strict';

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
  require('./basis/basis_transcoder.js');
} catch (error) {
  console.error('[harmony-shared-worker] basis transcoder init failed', error);
}
`

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
          default?: {
            build?: (config: Record<string, unknown>) => Promise<unknown>
          }
        }
        const viteBuild = viteModule.build ?? viteModule.default?.build
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
            minify: false,
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
        fs.writeFileSync(path.join(workersDir, 'index.js'), SHARED_WORKER_TEMPLATE, 'utf8')
        patchWechatWorkerAdapter(workersDir)
        console.info(`[harmony-worker] emitted ${options.outputFileName} and pages/scenery/workers/index.js`)
      } catch (error) {
        console.error('[harmony-worker] failed to build WeChat shared worker', error)
        throw error
      }
    },
  }
}
