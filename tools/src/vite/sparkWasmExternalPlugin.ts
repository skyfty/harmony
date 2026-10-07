import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

export type SparkWasmExternalPluginOptions = {
  /**
   * Absolute path to `@sparkjsdev/spark/dist/spark.module.js`.
   * The plugin extracts the embedded base64 WASM from this file at build time.
   */
  sparkModulePath: string;
  /**
   * Output asset path relative to the mini-program build output.
   */
  wasmAssetFileName?: string;
  /**
   * Worker asset emitted into the mini-program workers directory. WeChat's
   * `wx.createWorker` can only load a real worker file, so Spark's inline
   * worker source is extracted and emitted here.
   */
  workerAssetFileName?: string;
};

const VIRTUAL_ID = 'virtual:spark-wasm-loader';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const DEFAULT_WASM_ASSET_FILE_NAME = 'pages/spark/spark_rs_bg.wasm';
const DEFAULT_WORKER_ASSET_FILE_NAME = 'pages/scenery/workers/spark.worker.js';

const SPARK_WORKER_PREAMBLE = `/* harmony:spark-worker */
var __harmonySparkWorkerAdapter = null;
try {
  __harmonySparkWorkerAdapter = require('./worker-adapter.js');
} catch (error) {
  console.warn('[spark-worker] worker adapter unavailable', error);
}
if (__harmonySparkWorkerAdapter && __harmonySparkWorkerAdapter.proxySelf) {
  try { globalThis.self = __harmonySparkWorkerAdapter.proxySelf; } catch (error) {}
}
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = { now: function () { return Date.now(); } };
}
var __HarmonyTextDecoder = globalThis.TextDecoder;
if (__HarmonyTextDecoder && __HarmonyTextDecoder.prototype && typeof __HarmonyTextDecoder.prototype.decode === 'function') {
  var __harmonyOriginalTextDecoderDecode = __HarmonyTextDecoder.prototype.decode;
  __HarmonyTextDecoder.prototype.decode = function (input, options) {
    return __harmonyOriginalTextDecoderDecode.call(
      this,
      input === undefined || input === null ? new Uint8Array(0) : input,
      options,
    );
  };
}
`;

function extractJsStringLiteral(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`[spark-wasm-external] String marker not found: ${marker}`);
  }

  const quoteStart = markerIndex + marker.length - 1;
  let index = quoteStart + 1;
  let escaped = false;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      break;
    }
  }
  if (index >= source.length) {
    throw new Error(`[spark-wasm-external] Unterminated string literal for marker: ${marker}`);
  }

  const literal = source.slice(quoteStart, index + 1);
  return JSON.parse(literal.replace(/\t/g, '\\t')) as string;
}

function buildSparkWorkerSource(source: string): string {
  let workerSource = extractJsStringLiteral(source, 'var jsContent = "');

  const initNeedle = 'await __wbg_init({ module_or_path: await waitForModule });';
  if (!workerSource.includes(initNeedle)) {
    throw new Error('[spark-wasm-external] Spark worker wasm init not found');
  }
  workerSource = workerSource.replace(
    initNeedle,
    `const __sparkWasmPath = await waitForModule;
		if (typeof WXWebAssembly !== "undefined") {
			const __sparkWasmResult = await WXWebAssembly.instantiate(__sparkWasmPath, __wbg_get_imports());
			__wbg_finalize_init(__sparkWasmResult.instance, __sparkWasmResult.module);
		} else {
			await __wbg_init({ module_or_path: __sparkWasmPath });
		}`,
  );

  const fileBytesNeedle = `\t\tif (fileBytes) {
\t\t\treadStream = new ReadableStream({ start(controller) {
\t\t\t\tcontroller.enqueue(fileBytes);
\t\t\t\tcontroller.close();
\t\t\t} });
\t\t\tstreamLength = fileBytes.length;
\t\t} else if (url) {`;
  if (!workerSource.includes(fileBytesNeedle)) {
    throw new Error('[spark-wasm-external] Spark worker fileBytes decode branch not found');
  }
  workerSource = workerSource.replace(
    fileBytesNeedle,
    `\t\tif (fileBytes) {
\t\t\tdecoder.push(fileBytes);
\t\t\tsendStatus({ loaded: fileBytes.length, total: fileBytes.length });
\t\t\treturn decoder.finish();
\t\t} else if (url) {`,
  );

  return `${SPARK_WORKER_PREAMBLE}\n${workerSource}`;
}

function extractEmbeddedWasm(source: string): Uint8Array {
  const markerStart = source.indexOf('var spark_rs_bg_default');
  if (markerStart < 0) {
    throw new Error('[spark-wasm-external] Spark wasm declaration not found');
  }

  const base64StartMarker = '("AGFzb';
  const base64Start = source.indexOf(base64StartMarker, markerStart);
  if (base64Start < 0) {
    throw new Error('[spark-wasm-external] Spark base64 wasm not found');
  }

  const base64ContentStart = base64Start + 2;
  const base64End = source.indexOf('")', base64ContentStart);
  if (base64End < 0) {
    throw new Error('[spark-wasm-external] Spark base64 wasm terminator not found');
  }

  const base64 = source.slice(base64ContentStart, base64End);
  return Buffer.from(base64, 'base64');
}

export function sparkWasmExternalPlugin(options: SparkWasmExternalPluginOptions): Plugin {
  const wasmAssetFileName = options.wasmAssetFileName ?? DEFAULT_WASM_ASSET_FILE_NAME;
  const workerAssetFileName = options.workerAssetFileName ?? DEFAULT_WORKER_ASSET_FILE_NAME;
  const source = readFileSync(options.sparkModulePath, 'utf8');
  const wasmBytes = extractEmbeddedWasm(source);
  const workerSource = buildSparkWorkerSource(source);

  return {
    name: 'harmony:spark-wasm-external',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
      return undefined;
    },
    load(this: { emitFile(asset: { type: 'asset'; fileName: string; source: Uint8Array }): string }, id: string) {
      if (id !== RESOLVED_VIRTUAL_ID) {
        return undefined;
      }

      this.emitFile({
        type: 'asset',
        fileName: wasmAssetFileName,
        source: wasmBytes,
      });

      // The asset is emitted here so Rollup keeps the virtual module in the
      // graph. WeChat's `WXWebAssembly.instantiate` expects a package path with
      // no leading slash; other mini-program platforms fall back to fetch and
      // the standard `WebAssembly.instantiate`.
      return `export const sparkWasmPath = ${JSON.stringify(wasmAssetFileName)};`;
    },
    generateBundle(this: { emitFile(asset: { type: 'asset'; fileName: string; source: string }): string }) {
      this.emitFile({
        type: 'asset',
        fileName: workerAssetFileName,
        source: workerSource,
      });
    },
    transform(code: string, id: string) {
      const normalizedId = id.replaceAll('\\', '/');
      if (
        !normalizedId.includes('@sparkjsdev/spark/dist/spark.module.js')
        || code.includes('virtual:spark-wasm-loader')
      ) {
        return undefined;
      }

      const declarationStart = code.indexOf('var spark_rs_bg_default');
      if (declarationStart < 0) {
        return undefined;
      }

      const declarationEndMarker = ').buffer;';
      const declarationEnd = code.indexOf(declarationEndMarker, declarationStart);
      if (declarationEnd < 0) {
        return undefined;
      }

      const transformed = `${code.slice(0, declarationStart)}var spark_rs_bg_default = null;${code.slice(declarationEnd + declarationEndMarker.length)}`;

      // Match the declaration without assuming the global prefix. Other
      // plugins may have already rewritten `WebAssembly` to
      // `THREEGlobals.WebAssembly` before this transform runs.
      const initStart = transformed.indexOf('var WASM_MODULE = ');
      if (initStart < 0) {
        throw new Error('[spark-wasm-external] Spark wasm init declaration not found');
      }

      const initEndMarker = 'initialized = true;';
      const initEnd = transformed.indexOf(initEndMarker, initStart);
      if (initEnd < 0) {
        throw new Error('[spark-wasm-external] Spark wasm init completion not found');
      }

      // WeChat's `WXWebAssembly` has no `compile`, so the only supported
      // startup path there is `instantiate(path, imports)`.
      const initReplacement = `var WASM_MODULE = Promise.resolve(sparkWasmPath);
var initialized = false;
var sparkWasmInstantiation = typeof WXWebAssembly !== "undefined"
  ? WXWebAssembly.instantiate(sparkWasmPath, __wbg_get_imports())
  : fetch("/" + sparkWasmPath)
      .then((response) => response.arrayBuffer())
      .then((bytes) => globalThis.WebAssembly.instantiate(bytes, __wbg_get_imports()));
var initialization = sparkWasmInstantiation.then((result) => {
  __wbg_finalize_init(result.instance, result.module);
  initialized = true;`;
      const transformedInit = `${transformed.slice(0, initStart)}${initReplacement}${transformed.slice(initEnd + initEndMarker.length)}`;

      return `import { sparkWasmPath } from "virtual:spark-wasm-loader";\n${transformedInit}`;
    },
  };
}
