import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const RUNTIME_VIRTUAL_ID = 'virtual:harmony-scenery-schema-runtime'
const AGGREGATOR_VIRTUAL_ID = 'virtual:harmony-scenery-schema-aggregator'
const SCHEMA_SOURCE_ALIAS = '@harmony/schema-source'
const SCHEMA_CHUNK_NAME = 'pages/scenery-schema/chunks/schema'
const SCHEMA_RUNTIME_CHUNK_NAME = 'pages/scenery/common/schemaRuntimeFacade'

interface SchemaRuntimeVitePluginOptions {
  projectRoot: string
}

interface SchemaImportInfo {
  moduleNames: Set<string>
  valueModules: Map<string, string>
}

export function isScenerySchemaRuntimeVirtualId(id: string): boolean {
  return id.replaceAll('\\', '/').includes('/pages/scenery/runtime/schemaRuntimeFacade.ts')
}

export function isScenerySchemaAggregatorVirtualId(id: string): boolean {
  return id.replaceAll('\\', '/').includes('/pages/scenery-schema/chunks/schema.ts')
}

export function createScenerySchemaRuntimeVitePlugin(
  options: SchemaRuntimeVitePluginOptions,
): {
  name: string
  enforce: 'pre'
  resolveId(source: string, importer?: string): string | undefined
  load(id: string): string | undefined
  outputOptions(output: {
    manualChunks?: ((id: string, meta: unknown) => string | undefined) | Record<string, string[]>
  }): void
} {
  const sourceRoot = resolve(options.projectRoot, 'src/pages/scenery')
  const runtimeVirtualPath = resolve(
    options.projectRoot,
    'src/pages/scenery/runtime/schemaRuntimeFacade.ts',
  )
  const aggregatorVirtualPath = resolve(
    options.projectRoot,
    'src/pages/scenery-schema/chunks/schema.ts',
  )

  function collectVirtualSources(): {
    runtimeSource: string
    aggregatorSource: string
  } {
    // Re-scan whenever Vite loads a virtual module so a newly imported schema
    // symbol is available after HMR instead of requiring a dev-server restart.
    const imports = collectSchemaRuntimeImports(sourceRoot)
    const moduleNames = [...imports.moduleNames].sort()
    const valueNames = [...imports.valueModules.keys()]
      .filter((name) => name !== 'default')
      .sort()
    return {
      runtimeSource: createVirtualRuntimeSource(moduleNames, valueNames),
      aggregatorSource: createVirtualAggregatorSource(moduleNames),
    }
  }

  return {
    name: 'harmony-scenery-schema-runtime',
    enforce: 'pre',
    resolveId(source, importer) {
      const normalizedSource = normalizeVirtualId(source)
      if (normalizedSource === RUNTIME_VIRTUAL_ID) {
        return runtimeVirtualPath
      }
      if (normalizedSource === AGGREGATOR_VIRTUAL_ID) {
        return aggregatorVirtualPath
      }
      if (!isSchemaImport(source) || !isSceneryRuntimeImporter(importer, sourceRoot)) {
        return undefined
      }
      return runtimeVirtualPath
    },
    load(id) {
      // During H5 development Vite forwards virtual module requests back as
      // `/src/...` URLs instead of the absolute paths returned by resolveId.
      if (isScenerySchemaRuntimeVirtualId(id)) {
        return collectVirtualSources().runtimeSource
      }
      if (isScenerySchemaAggregatorVirtualId(id)) {
        return collectVirtualSources().aggregatorSource
      }
      return undefined
    },
    outputOptions(output) {
      const previousManualChunks = output.manualChunks
      const previousFunction = typeof previousManualChunks === 'function'
        ? previousManualChunks
        : undefined
      const previousObject = previousManualChunks && typeof previousManualChunks === 'object'
        ? previousManualChunks
        : undefined
      output.manualChunks = (id, meta) => {
        const normalizedId = id.replaceAll('\\', '/')
        if (isScenerySchemaAggregatorVirtualId(normalizedId)) {
          return SCHEMA_CHUNK_NAME
        }
        if (isScenerySchemaRuntimeVirtualId(normalizedId)) {
          return SCHEMA_RUNTIME_CHUNK_NAME
        }
        if (
          normalizedId.includes('/schema/')
          && !normalizedId.includes('/schema/dist/physicsBackendBridge.js')
          && !normalizedId.includes('/schema/dist/physicsBackendTypes.js')
          && !normalizedId.includes('/schema/dist/physicsBodySync.js')
          && !normalizedId.includes('/schema/dist/physicsBridgeVehicleInputSync.js')
          && !normalizedId.includes('/schema/dist/physicsRuntimeBridge.js')
          && !normalizedId.includes('/schema/dist/physicsEngine.js')
          && !normalizedId.includes('/schema/dist/physicsShapeResolvers.js')
        ) {
          return SCHEMA_CHUNK_NAME
        }
        if (previousFunction) {
          return previousFunction(id, meta)
        }
        if (previousObject) {
          for (const [chunkName, moduleIds] of Object.entries(previousObject)) {
            if (moduleIds.some((moduleId) => moduleId.replaceAll('\\', '/') === normalizedId)) {
              return chunkName
            }
          }
        }
        return undefined
      }
    },
  }
}

function normalizeVirtualId(id: string): string {
  return id.replaceAll('\\', '/').replace(/^\0/, '')
}

function collectSchemaRuntimeImports(sourceRoot: string): SchemaImportInfo {
  const moduleNames = new Set<string>()
  const valueModules = new Map<string, string>()

  for (const file of walkSourceFiles(sourceRoot)) {
    const source = readRuntimeSource(file)
    for (const match of source.matchAll(
      /(?:^|\n)\s*import\s+(?!\()((?:type\s+)?(?:(?!\bimport\b)[\s\S])*?)\s+from\s+['"]@harmony\/schema(?:\/([^'"]+))?['"]/g,
    )) {
      const clause = match[1]?.trim() ?? ''
      if (!clause || clause.startsWith('type ')) {
        continue
      }
      const modulePath = match[2] ?? 'index'
      moduleNames.add(modulePath)
      for (const importedName of parseRuntimeImportNames(clause, file)) {
        const existingModule = valueModules.get(importedName)
        if (existingModule && existingModule !== modulePath) {
          throw new Error(
            `[harmony-scenery-schema-runtime] import "${importedName}" is provided by both `
              + `"${existingModule}" and "${modulePath}"`,
          )
        }
        valueModules.set(importedName, modulePath)
      }
    }
  }

  if (moduleNames.size === 0 || valueModules.size === 0) {
    throw new Error(`[harmony-scenery-schema-runtime] no schema imports found under ${sourceRoot}`)
  }

  return { moduleNames, valueModules }
}

function walkSourceFiles(directory: string, visitedDirectories = new Set<string>()): string[] {
  const canonicalDirectory = resolve(realpathSync(directory))
  if (visitedDirectories.has(canonicalDirectory)) {
    return []
  }
  visitedDirectories.add(canonicalDirectory)

  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'workers' || entry.name === 'node_modules' || entry.name === 'dist') {
      continue
    }
    const absolutePath = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      // H5 development links the shared scenery package into `uni_modules`.
      // Its runtime lives behind that junction, so scan it while still ignoring
      // unrelated mirror links such as schema, physics and three.
      if (basename(directory) !== 'uni_modules' || !statSync(absolutePath).isDirectory()) {
        continue
      }
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      files.push(...walkSourceFiles(absolutePath, visitedDirectories))
    } else if (entry.isFile() && /\.(?:ts|vue)$/.test(entry.name)) {
      files.push(absolutePath)
    }
  }
  return files
}

function readRuntimeSource(file: string): string {
  const source = readFileSync(file, 'utf8')
  if (!file.endsWith('.vue')) {
    return source
  }
  return source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
}

function parseRuntimeImportNames(clause: string, file: string): string[] {
  if (clause.startsWith('*')) {
    throw new Error(
      `[harmony-scenery-schema-runtime] namespace schema imports are not supported in ${file}`,
    )
  }

  const names: string[] = []
  const namedMatch = clause.match(/\{([\s\S]*)\}/)
  if (namedMatch) {
    for (const rawSpecifier of namedMatch[1].split(',')) {
      const specifier = rawSpecifier.trim()
      if (!specifier || specifier.startsWith('type ')) {
        continue
      }
      const importedName = specifier.split(/\s+as\s+/)[0]?.trim()
      if (importedName) {
        names.push(importedName)
      }
    }
  }

  const defaultName = clause.match(/^([A-Za-z_$][\w$]*)/)?.[1]
  if (defaultName) {
    names.push('default')
  }
  return names
}

function createVirtualRuntimeSource(moduleNames: string[], valueNames: string[]): string {
  const valueDeclarations = valueNames.map((name) => `export let ${name};`).join('\n')
  const valueAssignments = valueNames
    .map((name) => `${name} = next[${JSON.stringify(name)}];`)
    .join('\n')

  return `
let schemaRuntime = null;
let schemaLoadPromise = null;
let ResourceCacheImplementation = null;
${valueDeclarations}

async function loadSchemaRuntime() {
  const aggregator = await import(${JSON.stringify(AGGREGATOR_VIRTUAL_ID)});
  const next = aggregator.runtime;
  if (!next || typeof next !== 'object') {
    throw new Error('Schema runtime aggregator did not expose a runtime object');
  }
  ResourceCacheImplementation = next.default ?? null;
${valueAssignments}
  schemaRuntime = next;
}

export function isSchemaRuntimeReady() {
  return schemaRuntime !== null;
}

export async function ensureSchemaRuntime() {
  if (schemaRuntime) {
    return;
  }
  if (!schemaLoadPromise) {
    schemaLoadPromise = loadSchemaRuntime().catch((error) => {
      schemaLoadPromise = null;
      throw error;
    });
  }
  await schemaLoadPromise;
}

export default function ResourceCache(...args) {
  if (!ResourceCacheImplementation) {
    throw new Error('Schema runtime is not loaded');
  }
  return Reflect.construct(ResourceCacheImplementation, args);
}
`
}

function createVirtualAggregatorSource(moduleNames: string[]): string {
  const imports = moduleNames
    .map((moduleName, index) => `
import * as schemaModule${index} from ${JSON.stringify(resolveSchemaSourceSpecifier(moduleName))};`)
    .join('')
  const moduleValues = moduleNames.map((_, index) => `schemaModule${index}`).join(', ')
  return `${imports}

export const runtime = Object.assign(Object.create(null), ${moduleValues});
`
}

function resolveSchemaSourceSpecifier(moduleName: string): string {
  return `${SCHEMA_SOURCE_ALIAS}/${moduleName}`
}

function isSchemaImport(source: string): boolean {
  return source === '@harmony/schema' || source.startsWith('@harmony/schema/')
}

function isSceneryRuntimeImporter(importer: string | undefined, sourceRoot: string): boolean {
  if (!importer) {
    return false
  }
  const normalizedImporter = importer.replaceAll('\\', '/')
  const normalizedSourceRoot = sourceRoot.replaceAll('\\', '/')
  if (!normalizedImporter.startsWith(`${normalizedSourceRoot}/`)) {
    return false
  }
  return !normalizedImporter.startsWith(`${normalizedSourceRoot}/schema/`)
    && !normalizedImporter.includes('/uni_modules/scenery/workers/')
}
