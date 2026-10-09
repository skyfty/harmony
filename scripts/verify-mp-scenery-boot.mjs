#!/usr/bin/env node
/**
 * Boot-verifies the built mp-weixin scenery runtime outside WeChat DevTools.
 *
 * The scenery runtime is evaluated as one module graph when the scenery subpackage
 * page loads. A single bad module-scope statement in that graph aborts the whole
 * graph, so `SceneryViewer` never calls `Component()` and WeChat reports the rather
 * misleading `Component is not found in path ".../SceneryViewer"`.
 *
 * Checks performed:
 *   1. packaging: the scenery runtime is self contained inside the scenery subpackage
 *      (schema chunk included) and the main package stays inside the 2 MB budget;
 *      subpackage sizes are reported against the 2 MB upload / 4 MB preview budgets;
 *   2. module graph: no synchronous `require()` crosses a subpackage boundary. WeChat
 *      only lets a subpackage require the main package, so an edge such as
 *      `pages/scenery -> pages/scenery-schema` fails at runtime with
 *      `module 'pages/scenery-schema/...' is not defined`;
 *   3. boot: the shipped app entry evaluates, then the schema chunk and
 *      `SceneryViewer` load and register themselves.
 *
 * Usage:
 *   node scripts/verify-mp-scenery-boot.mjs [appRoot] [--out <dir>]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
/**
 * `bigPackageSizeSupport` (written by the uni-app mp-weixin compiler into
 * project.config.json) raises the preview / real-device-debugging ceiling to 4 MB per
 * package. The scenery runtime carries three.js plus the schema package, so its
 * subpackage is only reported against that ceiling; the main package still has to stay
 * inside the 2 MB upload budget because it is downloaded on every launch.
 */
const MAX_PREVIEW_PACKAGE_BYTES = 4 * 1024 * 1024;
/**
 * Synchronous cross-subpackage requires that already ship and can only be reached
 * after the scenery subpackage finished loading (the physics bridge loads those
 * packages through `require.async`). Everything else fails: WeChat cannot resolve a
 * synchronous require into another subpackage.
 */
const ALLOWED_CROSS_PACKAGE_REQUIRES = new Set([
  'pages/physics-ammo -> pages/scenery',
  'pages/physics-cannon -> pages/scenery',
]);
/**
 * The canonical location is inside the scenery subpackage. The legacy path is kept as a
 * candidate so a regression reports the real problem (`pages/scenery` requiring a second
 * subpackage) instead of a bare "chunk not found".
 */
const SCHEMA_CHUNK_CANDIDATES = [
  'pages/scenery/chunks/schema.js',
  'pages/scenery-schema/chunks/schema.js',
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function info(message) {
  console.log(message);
}

function parseArgs(argv) {
  const options = { appRoot: undefined, outDir: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      options.outDir = argv[index + 1];
      index += 1;
    } else if (!options.appRoot) {
      options.appRoot = arg;
    }
  }
  return options;
}

function toPosix(value) {
  return value.split(sep).join('/');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function resolveOutputDir(appRoot, explicitOutDir) {
  if (explicitOutDir) {
    return resolve(explicitOutDir);
  }
  const candidates = [
    join(appRoot, 'dist', 'build', 'mp-weixin'),
    join(appRoot, 'dist', 'dev', 'mp-weixin'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'app.json'))) {
      return candidate;
    }
  }
  throw new Error(`no built mp-weixin output found under ${appRoot}`);
}

function resolveSchemaChunk(outDir) {
  for (const candidate of SCHEMA_CHUNK_CANDIDATES) {
    const absolutePath = join(outDir, candidate);
    if (existsSync(absolutePath)) {
      return { path: absolutePath, relativePath: toPosix(candidate) };
    }
  }
  throw new Error(
    `scenery schema chunk not found; looked for ${SCHEMA_CHUNK_CANDIDATES.join(', ')}`,
  );
}

function checkPackaging(outDir, appJson, schemaChunk) {
  const subPackageRoots = (appJson.subPackages ?? []).map((entry) => toPosix(entry.root));
  const sizes = new Map([['(main)', 0]]);
  for (const root of subPackageRoots) {
    sizes.set(root, 0);
  }

  for (const file of walkFiles(outDir)) {
    const relativePath = toPosix(relative(outDir, file));
    const size = statSync(file).size;
    const owner = subPackageRoots.find((root) => relativePath.startsWith(`${root}/`)) ?? '(main)';
    sizes.set(owner, (sizes.get(owner) ?? 0) + size);
  }

  for (const [owner, size] of [...sizes.entries()].sort((a, b) => b[1] - a[1])) {
    const label = `${owner} = ${(size / 1024 / 1024).toFixed(2)} MB`;
    if (size <= MAX_PACKAGE_BYTES) {
      info(`[ok] package size ${label}`);
      continue;
    }
    if (owner === '(main)') {
      fail(`main package over the 2 MB upload limit: ${label}`);
      continue;
    }
    info(`[warn] package size ${label} (over the 2 MB upload limit)`);
    if (size > MAX_PREVIEW_PACKAGE_BYTES) {
      info(
        `[warn] ${owner} is over the 4 MB preview / real-device ceiling `
          + '(bigPackageSizeSupport): 预览与真机调试会失败，开发者工具模拟器仍可运行',
      );
    }
  }

  const schemaOwner = subPackageRoots.find((root) =>
    schemaChunk.relativePath.startsWith(`${root}/`),
  );
  if (!schemaOwner) {
    fail(
      `scenery schema chunk lives in the main package (${schemaChunk.relativePath}); `
        + 'declare its directory as a subpackage root so the main package stays small',
    );
  } else {
    info(
      `[ok] scenery schema chunk belongs to subpackage "${schemaOwner}" `
        + `(${schemaChunk.relativePath})`,
    );
  }

  for (const root of subPackageRoots) {
    if (!existsSync(join(outDir, root))) {
      info(`[warn] declared subpackage root "${root}" has no files in this build`);
    }
  }
}

/**
 * WeChat lets a subpackage require main-package files, but not the other way round,
 * and not files owned by a sibling subpackage. The scenery runtime is one connected
 * module graph, so any synchronous edge between two subpackages breaks the page at
 * runtime with `module '...' is not defined`.
 */
function checkCrossPackageRequires(outDir, appJson) {
  const subPackageRoots = (appJson.subPackages ?? []).map((entry) => toPosix(entry.root));
  const ownerOf = (relativePath) =>
    subPackageRoots.find((root) => relativePath.startsWith(`${root}/`)) ?? '(main)';

  const edges = new Map();
  for (const file of walkFiles(outDir)) {
    if (!file.endsWith('.js')) {
      continue;
    }
    const relativePath = toPosix(relative(outDir, file));
    const owner = ownerOf(relativePath);
    for (const match of readFileSync(file, 'utf8').matchAll(/require\("(\.[^"]+)"\)/g)) {
      const target = toPosix(join(dirname(relativePath), match[1]));
      const targetOwner = ownerOf(target);
      if (targetOwner === owner) {
        continue;
      }
      const key = `${owner} -> ${targetOwner}`;
      if (!edges.has(key)) {
        edges.set(key, new Set());
      }
      edges.get(key).add(`${relativePath} requires ${match[1]}`);
    }
  }

  for (const [edge, samples] of edges) {
    const [from, to] = edge.split(' -> ');
    const detail = [...samples].slice(0, 2).join('; ');
    if (from !== '(main)' && to === '(main)') {
      // Supported by WeChat: a (non independent) subpackage may require the main
      // package, which is always downloaded first.
      continue;
    }
    if (ALLOWED_CROSS_PACKAGE_REQUIRES.has(edge)) {
      info(
        `[ok] known cross-subpackage require ${edge} (reached only after the scenery `
          + `package is loaded, through require.async): ${detail}`,
      );
      continue;
    }
    fail(
      `synchronous require crosses a subpackage boundary (${edge}); WeChat throws `
        + `"module ... is not defined" at runtime: ${detail}`,
    );
  }
}

/**
 * `stubThreeGlobals` emulates the app entry when it is not loaded: the schema chunk
 * references the bare `THREEGlobals` global that `app.js` normally installs.
 */
function createMiniRuntime(outDir, { stubThreeGlobals = true } = {}) {
  const cache = new Map();

  const createCanvas = () => ({
    width: 1,
    height: 1,
    getContext: () => ({
      canvas: { width: 1, height: 1 },
      getParameter: () => 4096,
      getExtension: () => null,
      getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
      getContextAttributes: () => ({}),
      createTexture: () => ({}),
      bindTexture() {},
      texParameteri() {},
      texImage2D() {},
    }),
  });

  const wxBase = {
    canIUse: () => false,
    getSystemInfoSync: () => ({
      platform: 'devtools',
      pixelRatio: 2,
      windowWidth: 375,
      windowHeight: 667,
    }),
    getDeviceInfo: () => ({ platform: 'devtools', memorySize: 2048, benchmarkLevel: 50 }),
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }),
    onMemoryWarning() {},
    offMemoryWarning() {},
    onWindowResize() {},
    offWindowResize() {},
    getRealtimeLogManager: () => ({ warn() {}, info() {} }),
    createOffscreenCanvas: createCanvas,
    createImage: () => ({}),
    getFileSystemManager: () => ({
      access() {},
      mkdir() {},
      readFile() {},
      writeFile() {},
      unlink() {},
      stat() {},
      readdir() {},
      getFileInfo() {},
      saveFile() {},
    }),
    env: { USER_DATA_PATH: '/tmp' },
  };

  const registeredComponents = [];
  const runtime = {
    registeredComponents,
    cache,
    load(relativePath) {
      const absolutePath = resolve(outDir, relativePath);
      if (cache.has(absolutePath)) {
        return cache.get(absolutePath).exports;
      }
      const module = { exports: {} };
      cache.set(absolutePath, module);
      const sourceUrl = toPosix(relative(outDir, absolutePath));
      const source = `${readFileSync(absolutePath, 'utf8')}\n//# sourceURL=harmony-mp:///${sourceUrl}`;
      const factory = new Function(
        'exports',
        'require',
        'module',
        '__filename',
        '__dirname',
        source,
      );
      const requireFn = (request) => {
        if (!request.startsWith('.')) {
          throw new Error(`unexpected bare require "${request}" from ${relativePath}`);
        }
        let target = resolve(absolutePath, '..', request);
        if (!existsSync(target) && existsSync(`${target}.js`)) {
          target = `${target}.js`;
        }
        if (!existsSync(target)) {
          throw new Error(`missing module "${request}" required from ${relativePath}`);
        }
        return runtime.load(relative(outDir, target));
      };
      requireFn.async = (request) =>
        Promise.resolve(runtime.load(relative(outDir, resolve(absolutePath, '..', request))));
      factory(module.exports, requireFn, module, absolutePath, resolve(absolutePath, '..'));
      return module.exports;
    },
  };

  if (stubThreeGlobals) {
    globalThis.THREEGlobals = globalThis;
  }
  globalThis.wx = new Proxy(wxBase, {
    get: (target, property) => {
      if (property in target) {
        return target[property];
      }
      if (property === 'createComponent') {
        return (component) => {
          registeredComponents.push(component);
          return component;
        };
      }
      return () => undefined;
    },
    has: () => true,
  });
  globalThis.Component = (definition) => registeredComponents.push(definition);
  globalThis.Page = () => {};
  globalThis.App = () => {};
  globalThis.Behavior = () => {};
  globalThis.getApp = () => ({});

  return runtime;
}

/**
 * Runs in its own process and boots the shipped app entry, so the module graph is
 * evaluated exactly the way WeChat evaluates it: the app-entry polyfills (including
 * the shipped `TextDecoder`) are installed before the scenery subpackage runs.
 */
function runBootPhase(outDir, schemaChunk) {
  const runtime = createMiniRuntime(outDir, { stubThreeGlobals: false });
  try {
    runtime.load('app.js');
  } catch (error) {
    throw new Error(`app entry failed to evaluate: ${error?.message}`);
  }
  info('[ok] app entry evaluates with the shipped polyfills');

  try {
    runtime.load(schemaChunk.relativePath);
  } catch (error) {
    throw new Error(`scenery schema chunk still fails to load: ${error?.message}`);
  }
  info(`[ok] scenery schema chunk loads (${schemaChunk.relativePath})`);

  try {
    runtime.load('pages/scenery/uni_modules/scenery/components/SceneryViewer.js');
  } catch (error) {
    throw new Error(`SceneryViewer module graph still fails to load: ${error?.message}`);
  }
  if (runtime.registeredComponents.length === 0) {
    throw new Error('SceneryViewer loaded but never registered a component');
  }
  info('[ok] SceneryViewer module graph loads and registers the component');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const appRoot = resolve(options.appRoot ?? process.cwd());
  const outDir = resolveOutputDir(appRoot, options.outDir);
  info(`[info] verifying ${outDir}`);

  const appJson = readJson(join(outDir, 'app.json'));
  const schemaChunk = resolveSchemaChunk(outDir);

  // The boot phase mutates shared globals (the polyfill patches globalThis on import,
  // the three adapter latches its own global patches), so it runs in its own process.
  const phases = [
    ['boot', 'app boot / component registration'],
  ];
  for (const [phase, label] of phases) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), appRoot, '--out', outDir, '--phase', phase],
      { encoding: 'utf8' },
    );
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.status !== 0) {
      const detail = (result.stderr || '').trim().split('\n').filter(Boolean).pop();
      fail(`phase "${phase}" (${label}) failed: ${detail ?? `exit code ${result.status}`}`);
    }
  }

  checkPackaging(outDir, appJson, schemaChunk);
  checkCrossPackageRequires(outDir, appJson);

  if (failures.length > 0) {
    console.error('\n[verify-mp-scenery-boot] FAILED');
    for (const message of failures) {
      console.error(` - ${message}`);
    }
    process.exit(1);
  }
  console.log('\n[verify-mp-scenery-boot] passed');
}

const phaseArgIndex = process.argv.indexOf('--phase');
if (phaseArgIndex !== -1) {
  const phase = process.argv[phaseArgIndex + 1];
  const options = parseArgs(process.argv.slice(2));
  const appRoot = resolve(options.appRoot ?? process.cwd());
  const outDir = resolveOutputDir(appRoot, options.outDir);
  const schemaChunk = resolveSchemaChunk(outDir);
  try {
    if (phase === 'boot') {
      runBootPhase(outDir, schemaChunk);
    } else {
      throw new Error(`unknown phase "${phase}"`);
    }
  } catch (error) {
    console.error(error?.message ?? String(error));
    process.exit(1);
  }
  process.exit(0);
}

main();
