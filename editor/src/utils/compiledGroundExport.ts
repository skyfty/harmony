import type {
  CompiledGroundCollisionTileRecord,
  CompiledGroundManifest,
  CompiledGroundRenderTileRecord,
  GroundDynamicMesh,
  SceneJsonExportDocument,
  SceneNode,
} from '@schema'
import {
  COMPILED_GROUND_MANIFEST_VERSION,
  computeCompiledGroundManifestRevision,
  formatCompiledGroundTileKey,
  resolveGroundChunkBounds,
  resolveGroundChunkOrigin,
  resolveGroundWorldBounds,
  serializeCompiledGroundCollisionTile,
  serializeCompiledGroundRenderTile,
} from '@schema'
import { isGroundDynamicMesh } from '@schema/groundHeightfield'
import {
  buildCollisionTileData,
  buildRenderTileGeometry,
} from './compiledGroundBuildShared'
import type {
  CompiledGroundBuildWorkerRequest,
  CompiledGroundBuildWorkerResponse,
  CompiledGroundBuildWorkerTilesResponse,
  CompiledGroundTileJob,
} from './compiledGroundBuildWorkerProtocol'

type CompiledGroundExportResult = {
  manifestPath: string
  renderRootPath: string
  collisionRootPath: string
  manifest: CompiledGroundManifest
  files: Record<string, Uint8Array>
}

export type CompiledGroundBuildProgress = {
  phase: 'render' | 'collision'
  completed: number
  total: number
  tileKey: string
}

type CompiledGroundBuildContext = {
  sceneId: string
  manifestPath: string
  renderRootPath: string
  collisionRootPath: string
  groundNode: SceneNode
  definition: GroundDynamicMesh
  worldBounds: ReturnType<typeof resolveGroundWorldBounds>
  coveredChunkBounds: ReturnType<typeof resolveGroundChunkBounds>
  chunkSizeMeters: number
  coverageBounds: {
    minX: number
    minZ: number
    maxX: number
    maxZ: number
  }
  renderTileSizeMeters: number
  collisionTileSizeMeters: number
  collisionSampleStepMeters: number
  renderColumns: number
  renderRows: number
  collisionColumns: number
  collisionRows: number
  files: Record<string, Uint8Array>
  renderTiles: CompiledGroundRenderTileRecord[]
  collisionTiles: CompiledGroundCollisionTileRecord[]
}

type BuildCompiledGroundAsyncOptions = {
  yieldEveryTiles?: number
  onProgress?: (progress: CompiledGroundBuildProgress) => void
  yieldControl?: () => Promise<void>
  workerCount?: number
  workerBatchSize?: number
}

const DEFAULT_RENDER_CHUNKS_PER_TILE = 4
const DEFAULT_COLLISION_CHUNKS_PER_TILE = 1
const DEFAULT_COLLISION_SAMPLE_STEP_METERS = 2
const DEFAULT_COMPILED_GROUND_WORKER_BATCH_SIZE = 1
const MAX_COMPILED_GROUND_WORKERS = 4

type CompiledGroundBuildWorkerRuntime = {
  worker: Worker
  nextRequestId: number
  pending: Map<number, {
    resolve: (response: CompiledGroundBuildWorkerResponse) => void
    reject: (error: Error) => void
  }>
}

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (isGroundDynamicMesh(node.dynamicMesh)) {
      return node
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return null
}

function createRenderTileJob(context: CompiledGroundBuildContext, row: number, column: number): CompiledGroundTileJob {
  const minX = context.coverageBounds.minX + column * context.renderTileSizeMeters
  const minZ = context.coverageBounds.minZ + row * context.renderTileSizeMeters
  return {
    key: formatCompiledGroundTileKey(row, column),
    row,
    column,
    minX,
    minZ,
    widthMeters: Math.min(context.renderTileSizeMeters, context.coverageBounds.maxX - minX),
    depthMeters: Math.min(context.renderTileSizeMeters, context.coverageBounds.maxZ - minZ),
  }
}

function createCollisionTileJob(context: CompiledGroundBuildContext, row: number, column: number): CompiledGroundTileJob {
  const minX = context.coverageBounds.minX + column * context.collisionTileSizeMeters
  const minZ = context.coverageBounds.minZ + row * context.collisionTileSizeMeters
  return {
    key: formatCompiledGroundTileKey(row, column),
    row,
    column,
    minX,
    minZ,
    widthMeters: Math.min(context.collisionTileSizeMeters, context.coverageBounds.maxX - minX),
    depthMeters: Math.min(context.collisionTileSizeMeters, context.coverageBounds.maxZ - minZ),
  }
}

function resolveCompiledGroundWorkerCount(explicitCount?: number): number {
  if (typeof Worker === 'undefined') {
    return 0
  }
  if (Number.isFinite(explicitCount) && (explicitCount ?? 0) > 0) {
    return Math.max(1, Math.min(MAX_COMPILED_GROUND_WORKERS, Math.trunc(explicitCount as number)))
  }
  const hardwareConcurrency = typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
    ? Math.trunc(navigator.hardwareConcurrency)
    : 0
  if (hardwareConcurrency <= 2) {
    return 1
  }
  return Math.max(2, Math.min(MAX_COMPILED_GROUND_WORKERS, hardwareConcurrency - 1))
}

function createCompiledGroundBuildWorkerRuntime(): CompiledGroundBuildWorkerRuntime | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  try {
    const worker = new Worker(new URL('@/workers/compiledGroundBuild.worker.ts', import.meta.url), {
      type: 'module',
    })
    const pending = new Map<number, {
      resolve: (response: CompiledGroundBuildWorkerResponse) => void
      reject: (error: Error) => void
    }>()
    const runtime: CompiledGroundBuildWorkerRuntime = {
      worker,
      nextRequestId: 1,
      pending,
    }
    worker.onmessage = (event: MessageEvent<CompiledGroundBuildWorkerResponse>) => {
      const message = event.data
      if (!message || typeof message.requestId !== 'number') {
        return
      }
      const callback = pending.get(message.requestId)
      if (!callback) {
        return
      }
      pending.delete(message.requestId)
      callback.resolve(message)
    }
    worker.onerror = (event) => {
      const error = new Error(`compiled ground worker failed: ${event.message || 'unknown error'}`)
      const callbacks = Array.from(pending.values())
      pending.clear()
      for (const callback of callbacks) {
        callback.reject(error)
      }
    }
    return runtime
  } catch (_error) {
    return null
  }
}

function closeCompiledGroundBuildWorkerRuntime(runtime: CompiledGroundBuildWorkerRuntime): void {
  const callbacks = Array.from(runtime.pending.values())
  runtime.pending.clear()
  runtime.worker.terminate()
  for (const callback of callbacks) {
    callback.reject(new Error('compiled ground worker terminated'))
  }
}

function requestCompiledGroundWorker(
  runtime: CompiledGroundBuildWorkerRuntime,
  message: Omit<CompiledGroundBuildWorkerRequest, 'requestId'>,
): Promise<CompiledGroundBuildWorkerResponse> {
  return new Promise((resolve, reject) => {
    const requestId = runtime.nextRequestId
    runtime.nextRequestId += 1
    runtime.pending.set(requestId, { resolve, reject })
    runtime.worker.postMessage({
      ...message,
      requestId,
    } satisfies CompiledGroundBuildWorkerRequest)
  })
}

function prepareCompiledGroundBuildContext(document: SceneJsonExportDocument): CompiledGroundBuildContext | null {
  const groundNode = findGroundNode(document.nodes)
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return null
  }
  const definition = groundNode.dynamicMesh as GroundDynamicMesh
  const sceneRoot = `scenes/${encodeURIComponent(document.id)}/compiled-ground`
  const manifestPath = `${sceneRoot}/manifest.json`
  const renderRootPath = `${sceneRoot}/render`
  const collisionRootPath = `${sceneRoot}/collision`
  const worldBounds = resolveGroundWorldBounds(definition)
  const coveredChunkBounds = resolveGroundChunkBounds(definition)
  const chunkSizeMeters = Number.isFinite(definition.chunkSizeMeters) && definition.chunkSizeMeters! > 0
    ? Number(definition.chunkSizeMeters)
    : 100
  const coveredChunkOrigin = resolveGroundChunkOrigin({
    chunkX: coveredChunkBounds.minChunkX,
    chunkZ: coveredChunkBounds.minChunkZ,
  }, chunkSizeMeters)
  const coveredChunkMaxOrigin = resolveGroundChunkOrigin({
    chunkX: coveredChunkBounds.maxChunkX,
    chunkZ: coveredChunkBounds.maxChunkZ,
  }, chunkSizeMeters)
  const coverageBounds = {
    minX: coveredChunkOrigin.x,
    minZ: coveredChunkOrigin.z,
    maxX: coveredChunkMaxOrigin.x + chunkSizeMeters,
    maxZ: coveredChunkMaxOrigin.z + chunkSizeMeters,
  }
  const renderTileSizeMeters = chunkSizeMeters * DEFAULT_RENDER_CHUNKS_PER_TILE
  const collisionTileSizeMeters = chunkSizeMeters * DEFAULT_COLLISION_CHUNKS_PER_TILE
  const collisionSampleStepMeters = Math.max(
    Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1,
    DEFAULT_COLLISION_SAMPLE_STEP_METERS,
  )
  const renderColumns = Math.max(1, Math.ceil((coverageBounds.maxX - coverageBounds.minX) / renderTileSizeMeters))
  const renderRows = Math.max(1, Math.ceil((coverageBounds.maxZ - coverageBounds.minZ) / renderTileSizeMeters))
  const collisionColumns = Math.max(1, Math.ceil((coverageBounds.maxX - coverageBounds.minX) / collisionTileSizeMeters))
  const collisionRows = Math.max(1, Math.ceil((coverageBounds.maxZ - coverageBounds.minZ) / collisionTileSizeMeters))
  return {
    sceneId: document.id,
    manifestPath,
    renderRootPath,
    collisionRootPath,
    groundNode,
    definition,
    worldBounds,
    coveredChunkBounds,
    chunkSizeMeters,
    coverageBounds,
    renderTileSizeMeters,
    collisionTileSizeMeters,
    collisionSampleStepMeters,
    renderColumns,
    renderRows,
    collisionColumns,
    collisionRows,
    files: {},
    renderTiles: [],
    collisionTiles: [],
  }
}

function appendRenderTile(context: CompiledGroundBuildContext, row: number, column: number): string {
  const key = formatCompiledGroundTileKey(row, column)
  const minX = context.coverageBounds.minX + column * context.renderTileSizeMeters
  const minZ = context.coverageBounds.minZ + row * context.renderTileSizeMeters
  const widthMeters = Math.min(context.renderTileSizeMeters, context.coverageBounds.maxX - minX)
  const depthMeters = Math.min(context.renderTileSizeMeters, context.coverageBounds.maxZ - minZ)
  const built = buildRenderTileGeometry(context.definition, context.worldBounds, minX, minZ, widthMeters, depthMeters)
  if (!built) {
    return key
  }
  built.header.key = key
  built.header.row = row
  built.header.column = column
  const path = `${context.renderRootPath}/tile_r${row}_c${column}.gmesh`
  const encoded = serializeCompiledGroundRenderTile(built)
  context.files[path] = new Uint8Array(encoded)
  context.renderTiles.push({
    key,
    row,
    column,
    centerX: minX + widthMeters * 0.5,
    centerZ: minZ + depthMeters * 0.5,
    sizeMeters: context.renderTileSizeMeters,
    widthMeters,
    depthMeters,
    path,
    bounds: built.header.bounds,
    vertexCount: built.header.vertexCount,
    triangleCount: built.header.triangleCount,
  })
  return key
}

function appendCollisionTile(context: CompiledGroundBuildContext, row: number, column: number): string {
  const key = formatCompiledGroundTileKey(row, column)
  const minX = context.coverageBounds.minX + column * context.collisionTileSizeMeters
  const minZ = context.coverageBounds.minZ + row * context.collisionTileSizeMeters
  const widthMeters = Math.min(context.collisionTileSizeMeters, context.coverageBounds.maxX - minX)
  const depthMeters = Math.min(context.collisionTileSizeMeters, context.coverageBounds.maxZ - minZ)
  const built = buildCollisionTileData(
    context.definition,
    context.worldBounds,
    minX,
    minZ,
    widthMeters,
    depthMeters,
    context.collisionSampleStepMeters,
  )
  built.header.key = key
  built.header.row = row
  built.header.column = column
  const path = `${context.collisionRootPath}/tile_r${row}_c${column}.hfield`
  const encoded = serializeCompiledGroundCollisionTile(built)
  context.files[path] = new Uint8Array(encoded)
  context.collisionTiles.push({
    key,
    row,
    column,
    centerX: minX + widthMeters * 0.5,
    centerZ: minZ + depthMeters * 0.5,
    sizeMeters: context.collisionTileSizeMeters,
    widthMeters,
    depthMeters,
    path,
    bounds: built.header.bounds,
    rows: built.header.rows,
    columns: built.header.columns,
    elementSize: built.header.elementSize,
  })
  return key
}

async function initializeCompiledGroundWorkers(
  context: CompiledGroundBuildContext,
  count: number,
): Promise<CompiledGroundBuildWorkerRuntime[] | null> {
  const workers: CompiledGroundBuildWorkerRuntime[] = []
  try {
    for (let index = 0; index < count; index += 1) {
      const runtime = createCompiledGroundBuildWorkerRuntime()
      if (!runtime) {
        throw new Error('worker unavailable')
      }
      workers.push(runtime)
    }
    await Promise.all(workers.map(async (runtime) => {
      const response = await requestCompiledGroundWorker(runtime, {
        kind: 'compiled-ground-init',
        definition: context.definition,
        worldBounds: context.worldBounds,
      })
      if (response.kind !== 'compiled-ground-init-result' || !response.ok) {
        throw new Error(response.error || 'compiled ground worker init failed')
      }
    }))
    return workers
  } catch (_error) {
    for (const worker of workers) {
      closeCompiledGroundBuildWorkerRuntime(worker)
    }
    return null
  }
}

async function buildCompiledGroundPhaseWithWorkers(
  context: CompiledGroundBuildContext,
  phase: 'render' | 'collision',
  options: BuildCompiledGroundAsyncOptions,
  workers: CompiledGroundBuildWorkerRuntime[],
): Promise<void> {
  const total = phase === 'render'
    ? context.renderRows * context.renderColumns
    : context.collisionRows * context.collisionColumns
  if (total <= 0) {
    return
  }

  const jobs: CompiledGroundTileJob[] = []
  if (phase === 'render') {
    for (let row = 0; row < context.renderRows; row += 1) {
      for (let column = 0; column < context.renderColumns; column += 1) {
        jobs.push(createRenderTileJob(context, row, column))
      }
    }
  } else {
    for (let row = 0; row < context.collisionRows; row += 1) {
      for (let column = 0; column < context.collisionColumns; column += 1) {
        jobs.push(createCollisionTileJob(context, row, column))
      }
    }
  }

  const batchSize = Math.max(1, Math.trunc(options.workerBatchSize ?? DEFAULT_COMPILED_GROUND_WORKER_BATCH_SIZE))
  const yieldEveryTiles = Math.max(1, Math.trunc(options.yieldEveryTiles ?? 4))
  const yieldControl = options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  let nextJobIndex = 0
  let completed = 0
  let completedSinceYield = 0

  const runWorker = async (runtime: CompiledGroundBuildWorkerRuntime): Promise<void> => {
    while (nextJobIndex < jobs.length) {
      const batchStart = nextJobIndex
      nextJobIndex += batchSize
      const batchJobs = jobs.slice(batchStart, Math.min(jobs.length, batchStart + batchSize))
      if (!batchJobs.length) {
        return
      }
      const response = await requestCompiledGroundWorker(runtime, phase === 'render'
        ? {
          kind: 'compiled-ground-build-tiles',
          phase,
          jobs: batchJobs,
        }
        : {
          kind: 'compiled-ground-build-tiles',
          phase,
          jobs: batchJobs,
          collisionSampleStepMeters: context.collisionSampleStepMeters,
        })
      if (response.kind !== 'compiled-ground-build-tiles-result') {
        throw new Error('unexpected compiled ground worker response')
      }
      const tileResponse = response as CompiledGroundBuildWorkerTilesResponse
      if (tileResponse.error) {
        throw new Error(tileResponse.error)
      }
      if (phase === 'render') {
        for (const result of tileResponse.renderResults ?? []) {
          const path = `${context.renderRootPath}/tile_r${result.row}_c${result.column}.gmesh`
          const minX = context.coverageBounds.minX + result.column * context.renderTileSizeMeters
          const minZ = context.coverageBounds.minZ + result.row * context.renderTileSizeMeters
          context.files[path] = new Uint8Array(result.encodedTile)
          context.renderTiles.push({
            key: result.key,
            row: result.row,
            column: result.column,
            centerX: minX + result.widthMeters * 0.5,
            centerZ: minZ + result.depthMeters * 0.5,
            sizeMeters: context.renderTileSizeMeters,
            widthMeters: result.widthMeters,
            depthMeters: result.depthMeters,
            path,
            bounds: result.bounds,
            vertexCount: result.vertexCount,
            triangleCount: result.triangleCount,
          })
          completed += 1
          completedSinceYield += 1
          options.onProgress?.({
            phase,
            completed,
            total,
            tileKey: result.key,
          })
        }
      } else {
        for (const result of tileResponse.collisionResults ?? []) {
          const path = `${context.collisionRootPath}/tile_r${result.row}_c${result.column}.hfield`
          const minX = context.coverageBounds.minX + result.column * context.collisionTileSizeMeters
          const minZ = context.coverageBounds.minZ + result.row * context.collisionTileSizeMeters
          context.files[path] = new Uint8Array(result.encodedTile)
          context.collisionTiles.push({
            key: result.key,
            row: result.row,
            column: result.column,
            centerX: minX + result.widthMeters * 0.5,
            centerZ: minZ + result.depthMeters * 0.5,
            sizeMeters: context.collisionTileSizeMeters,
            widthMeters: result.widthMeters,
            depthMeters: result.depthMeters,
            path,
            bounds: result.bounds,
            rows: result.rows,
            columns: result.columns,
            elementSize: result.elementSize,
          })
          completed += 1
          completedSinceYield += 1
          options.onProgress?.({
            phase,
            completed,
            total,
            tileKey: result.key,
          })
        }
      }
      if (completedSinceYield >= yieldEveryTiles) {
        completedSinceYield = 0
        await yieldControl()
      }
    }
  }

  await Promise.all(workers.map((runtime) => runWorker(runtime)))
}

async function buildCompiledGroundPackageFilesWithWorkersAsync(
  document: SceneJsonExportDocument,
  options: BuildCompiledGroundAsyncOptions = {},
): Promise<CompiledGroundExportResult | null> {
  const context = prepareCompiledGroundBuildContext(document)
  if (!context) {
    return null
  }

  const workerCount = resolveCompiledGroundWorkerCount(options.workerCount)
  if (workerCount <= 1) {
    return null
  }
  const workers = await initializeCompiledGroundWorkers(context, workerCount)
  if (!workers?.length) {
    return null
  }

  try {
    await buildCompiledGroundPhaseWithWorkers(context, 'render', options, workers)
    await buildCompiledGroundPhaseWithWorkers(context, 'collision', options, workers)
  } finally {
    for (const worker of workers) {
      closeCompiledGroundBuildWorkerRuntime(worker)
    }
  }

  return finalizeCompiledGroundBuild(context)
}

function finalizeCompiledGroundBuild(context: CompiledGroundBuildContext): CompiledGroundExportResult {
  context.renderTiles.sort((a, b) => (a.row - b.row) || (a.column - b.column))
  context.collisionTiles.sort((a, b) => (a.row - b.row) || (a.column - b.column))
  const minHeight = context.renderTiles.length > 0
    ? Math.min(...context.renderTiles.map((tile) => tile.bounds.minY))
    : (Number.isFinite(context.definition.baseHeight) ? Number(context.definition.baseHeight) : 0)
  const maxHeight = context.renderTiles.length > 0
    ? Math.max(...context.renderTiles.map((tile) => tile.bounds.maxY))
    : (Number.isFinite(context.definition.baseHeight) ? Number(context.definition.baseHeight) : 0)
  const manifestWithoutRevision: Omit<CompiledGroundManifest, 'revision'> = {
    version: COMPILED_GROUND_MANIFEST_VERSION,
    sceneId: context.sceneId,
    groundNodeId: context.groundNode.id,
    chunkSizeMeters: context.chunkSizeMeters,
    baseHeight: Number.isFinite(context.definition.baseHeight) ? Number(context.definition.baseHeight) : 0,
    renderTileSizeMeters: context.renderTileSizeMeters,
    collisionTileSizeMeters: context.collisionTileSizeMeters,
    coveredChunkBounds: context.coveredChunkBounds,
    bounds: {
      minX: context.coverageBounds.minX,
      minY: minHeight,
      minZ: context.coverageBounds.minZ,
      maxX: context.coverageBounds.maxX,
      maxY: maxHeight,
      maxZ: context.coverageBounds.maxZ,
    },
    renderTiles: context.renderTiles,
    collisionTiles: context.collisionTiles,
  }
  return {
    manifestPath: context.manifestPath,
    renderRootPath: context.renderRootPath,
    collisionRootPath: context.collisionRootPath,
    manifest: {
      ...manifestWithoutRevision,
      revision: computeCompiledGroundManifestRevision(manifestWithoutRevision),
    },
    files: context.files,
  }
}

export function buildCompiledGroundPackageFiles(document: SceneJsonExportDocument): CompiledGroundExportResult | null {
  const context = prepareCompiledGroundBuildContext(document)
  if (!context) {
    return null
  }
  for (let row = 0; row < context.renderRows; row += 1) {
    for (let column = 0; column < context.renderColumns; column += 1) {
      appendRenderTile(context, row, column)
    }
  }
  for (let row = 0; row < context.collisionRows; row += 1) {
    for (let column = 0; column < context.collisionColumns; column += 1) {
      appendCollisionTile(context, row, column)
    }
  }
  return finalizeCompiledGroundBuild(context)
}

export async function buildCompiledGroundPackageFilesAsync(
  document: SceneJsonExportDocument,
  options: BuildCompiledGroundAsyncOptions = {},
): Promise<CompiledGroundExportResult | null> {
  try {
    const workerBuilt = await buildCompiledGroundPackageFilesWithWorkersAsync(document, options)
    if (workerBuilt) {
      return workerBuilt
    }
  } catch (error) {
    console.warn('[CompiledGround] Worker build failed; falling back to main thread', error)
  }

  const context = prepareCompiledGroundBuildContext(document)
  if (!context) {
    return null
  }
  const yieldEveryTiles = Math.max(1, Math.trunc(options.yieldEveryTiles ?? 4))
  const yieldControl = options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const renderTotal = context.renderRows * context.renderColumns
  const collisionTotal = context.collisionRows * context.collisionColumns
  let completedSinceYield = 0
  let renderCompleted = 0
  let collisionCompleted = 0

  for (let row = 0; row < context.renderRows; row += 1) {
    for (let column = 0; column < context.renderColumns; column += 1) {
      const tileKey = appendRenderTile(context, row, column)
      renderCompleted += 1
      completedSinceYield += 1
      options.onProgress?.({
        phase: 'render',
        completed: renderCompleted,
        total: renderTotal,
        tileKey,
      })
      if (completedSinceYield >= yieldEveryTiles) {
        completedSinceYield = 0
        await yieldControl()
      }
    }
  }

  for (let row = 0; row < context.collisionRows; row += 1) {
    for (let column = 0; column < context.collisionColumns; column += 1) {
      const tileKey = appendCollisionTile(context, row, column)
      collisionCompleted += 1
      completedSinceYield += 1
      options.onProgress?.({
        phase: 'collision',
        completed: collisionCompleted,
        total: collisionTotal,
        tileKey,
      })
      if (completedSinceYield >= yieldEveryTiles) {
        completedSinceYield = 0
        await yieldControl()
      }
    }
  }

  return finalizeCompiledGroundBuild(context)
}
