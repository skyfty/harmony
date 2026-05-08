/// <reference lib="webworker" />

import type {
  GroundDynamicMesh,
  QuantizedTerrainDatasetRootManifest,
  QuantizedTerrainMeshData,
} from '@schema'
import {
  dequantizeTerrainHeight,
  deserializeQuantizedTerrainMesh,
  deserializeQuantizedTerrainPack,
  resolveGroundWorldBounds,
  serializeCompiledGroundCollisionTile,
  serializeCompiledGroundRenderTile,
} from '@schema'
import {
  buildCollisionTileData,
  buildRenderTileGeometry,
} from '@/utils/compiledGroundBuildShared'
import type {
  CompiledGroundBuildWorkerCollisionResult,
  CompiledGroundBuildWorkerInitRequest,
  CompiledGroundBuildWorkerRequest,
  CompiledGroundBuildWorkerRenderResult,
  CompiledGroundBuildWorkerResponse,
} from '@/utils/compiledGroundBuildWorkerProtocol'

const DB_NAME = 'harmony-editor-scenes'
const STORE_TERRAIN_DATASET_MANIFESTS = 'sceneTerrainDatasetManifests'
const STORE_TERRAIN_DATASET_REGION_PACKS = 'sceneTerrainDatasetRegionPacks'

function getWorkspaceDbName(workspaceId: string): string {
  return `${DB_NAME}::${workspaceId}`
}

function getTerrainDatasetRegionPackStorageKey(sceneId: string, regionKey: string): string {
  return `${sceneId}:${regionKey}`
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function openDatabase(workspaceId: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return null
  }
  return await new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(getWorkspaceDbName(workspaceId))
    request.onerror = () => resolve(null)
    request.onsuccess = () => resolve(request.result)
  })
}

function inferTileGridShape(tileData: QuantizedTerrainMeshData): { rows: number; columns: number } | null {
  const vertexCount = tileData.header.vertexCount
  if (!vertexCount || tileData.u.length !== vertexCount || tileData.v.length !== vertexCount || vertexCount < 4) {
    return null
  }

  const rowsFromEdges = tileData.westIndices.length - 1
  const columnsFromEdges = tileData.southIndices.length - 1
  if (rowsFromEdges >= 1 && columnsFromEdges >= 1 && (rowsFromEdges + 1) * (columnsFromEdges + 1) === vertexCount) {
    return { rows: rowsFromEdges, columns: columnsFromEdges }
  }

  let columns = -1
  for (let index = 1; index < tileData.v.length; index += 1) {
    if (tileData.v[index] !== tileData.v[0]) {
      columns = index - 1
      break
    }
  }
  if (columns < 1) {
    return null
  }

  const rows = Math.floor(vertexCount / (columns + 1)) - 1
  if (rows < 1 || (rows + 1) * (columns + 1) !== vertexCount) {
    return null
  }

  return { rows, columns }
}

function sampleQuantizedTerrainMeshHeight(tileData: QuantizedTerrainMeshData, x: number, z: number): number | null {
  const shape = inferTileGridShape(tileData)
  if (!shape) {
    return null
  }

  const { rows, columns } = shape
  const bounds = tileData.header.bounds
  const spanX = Math.max(Number.EPSILON, bounds.maxX - bounds.minX)
  const spanZ = Math.max(Number.EPSILON, bounds.maxZ - bounds.minZ)
  const ratioX = Math.min(1, Math.max(0, (x - bounds.minX) / spanX))
  const ratioZ = Math.min(1, Math.max(0, (z - bounds.minZ) / spanZ))
  const localColumn = ratioX * columns
  const localRow = ratioZ * rows
  const column0 = Math.max(0, Math.min(columns, Math.floor(localColumn)))
  const row0 = Math.max(0, Math.min(rows, Math.floor(localRow)))
  const column1 = Math.min(columns, column0 + 1)
  const row1 = Math.min(rows, row0 + 1)
  const tx = Math.min(1, Math.max(0, localColumn - column0))
  const tz = Math.min(1, Math.max(0, localRow - row0))

  const index = (row: number, column: number) => row * (columns + 1) + column
  const h00 = dequantizeTerrainHeight(tileData.height[index(row0, column0)] ?? 0, tileData.header.minHeight, tileData.header.maxHeight)
  const h10 = dequantizeTerrainHeight(tileData.height[index(row0, column1)] ?? 0, tileData.header.minHeight, tileData.header.maxHeight)
  const h01 = dequantizeTerrainHeight(tileData.height[index(row1, column0)] ?? 0, tileData.header.minHeight, tileData.header.maxHeight)
  const h11 = dequantizeTerrainHeight(tileData.height[index(row1, column1)] ?? 0, tileData.header.minHeight, tileData.header.maxHeight)
  const hx0 = h00 + (h10 - h00) * tx
  const hx1 = h01 + (h11 - h01) * tx
  return hx0 + (hx1 - hx0) * tz
}

async function buildTerrainDatasetHeightSampler(
  sceneId: string,
  workspaceId: string,
): Promise<{ sampleHeightAtWorld: (x: number, z: number) => number | null } | null> {
  const db = await openDatabase(workspaceId)
  if (!db) {
    return null
  }

  const manifestTx = db.transaction(STORE_TERRAIN_DATASET_MANIFESTS, 'readonly')
  const manifestStore = manifestTx.objectStore(STORE_TERRAIN_DATASET_MANIFESTS)
  const manifestEntry = await requestToPromise<{ id: string; manifest: QuantizedTerrainDatasetRootManifest } | undefined>(manifestStore.get(sceneId))
  if (!manifestEntry?.manifest) {
    return null
  }

  const manifest = manifestEntry.manifest
  const tileCache = new Map<string, QuantizedTerrainMeshData | null>()
  for (const region of manifest.regions) {
    const storageKey = getTerrainDatasetRegionPackStorageKey(sceneId, region.regionKey)
    const regionTx = db.transaction(STORE_TERRAIN_DATASET_REGION_PACKS, 'readonly')
    const regionStore = regionTx.objectStore(STORE_TERRAIN_DATASET_REGION_PACKS)
    const entry = await requestToPromise<{ id: string; buffer: ArrayBuffer } | undefined>(regionStore.get(storageKey))
    if (!entry?.buffer) {
      continue
    }
    const pack = deserializeQuantizedTerrainPack(entry.buffer)
    if (!pack) {
      continue
    }
    for (const [tileKey, buffer] of Object.entries(pack.entries)) {
      if (!tileCache.has(tileKey)) {
        tileCache.set(tileKey, deserializeQuantizedTerrainMesh(buffer))
      }
    }
  }

  const bounds = manifest.bounds
  const spanX = Math.max(Number.EPSILON, bounds.maxX - bounds.minX)
  const spanZ = Math.max(Number.EPSILON, bounds.maxZ - bounds.minZ)
  const levelScale = 2 ** Math.max(0, Math.trunc(manifest.maxLevel))

  return {
    sampleHeightAtWorld: (x: number, z: number): number | null => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        return null
      }
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
        return null
      }

      const tileX = Math.min(levelScale - 1, Math.max(0, Math.floor(((x - bounds.minX) / spanX) * levelScale)))
      const tileY = Math.min(levelScale - 1, Math.max(0, Math.floor(((z - bounds.minZ) / spanZ) * levelScale)))

      for (let level = manifest.maxLevel; level >= manifest.rootLevel; level -= 1) {
        const shift = Math.max(0, manifest.maxLevel - level)
        const parentX = Math.floor(tileX / (2 ** shift))
        const parentY = Math.floor(tileY / (2 ** shift))
        const tileKey = `${level}:${parentX}:${parentY}`
        const tileData = tileCache.get(tileKey) ?? null
        if (!tileData) {
          continue
        }
        const sampled = sampleQuantizedTerrainMeshHeight(tileData, x, z)
        if (Number.isFinite(sampled)) {
          return sampled as number
        }
      }

      return null
    },
  }
}

function cloneWorkerDefinition(definition: GroundDynamicMesh): GroundDynamicMesh {
  return structuredClone(definition) as GroundDynamicMesh
}

async function initializeCompiledGroundWorkerDefinition(message: CompiledGroundBuildWorkerInitRequest): Promise<GroundDynamicMesh> {
  const definition = cloneWorkerDefinition(message.definition)
  if (!message.terrainDatasetEnabled) {
    return definition
  }
  if (!message.workspaceId) {
    throw new Error('compiled ground worker requires workspaceId for terrain dataset sampling')
  }
  const sampler = await buildTerrainDatasetHeightSampler(message.sceneId, message.workspaceId)
  if (!sampler) {
    throw new Error('compiled ground worker failed to load terrain dataset sampler')
  }
  return {
    ...definition,
    runtimeTerrainHeightSampler: sampler,
  }
}

let workerDefinition: GroundDynamicMesh | null = null
let workerWorldBounds: ReturnType<typeof resolveGroundWorldBounds> | null = null

self.onmessage = async (event: MessageEvent<CompiledGroundBuildWorkerRequest>) => {
  const message = event.data
  if (!message) {
    return
  }

  try {
    if (message.kind === 'compiled-ground-init') {
      workerDefinition = await initializeCompiledGroundWorkerDefinition(message)
      workerWorldBounds = message.worldBounds
      const response: CompiledGroundBuildWorkerResponse = {
        kind: 'compiled-ground-init-result',
        requestId: message.requestId,
        ok: true,
      }
      self.postMessage(response)
      return
    }

    if (message.kind !== 'compiled-ground-build-tiles') {
      return
    }

    if (!workerDefinition || !workerWorldBounds) {
      const response: CompiledGroundBuildWorkerResponse = {
        kind: 'compiled-ground-build-tiles-result',
        requestId: message.requestId,
        phase: message.phase,
        error: 'compiled ground worker not initialized',
      }
      self.postMessage(response)
      return
    }

    if (message.phase === 'render') {
      const renderResults: CompiledGroundBuildWorkerRenderResult[] = []
      const transfers: Transferable[] = []
      for (const job of message.jobs) {
        const built = buildRenderTileGeometry(
          workerDefinition,
          workerWorldBounds,
          job.minX,
          job.minZ,
          job.widthMeters,
          job.depthMeters,
          Math.max(1e-6, message.renderSampleStepMeters ?? 1),
        )
        if (!built) {
          continue
        }
        built.header.key = job.key
        built.header.row = job.row
        built.header.column = job.column
        const encodedTile = serializeCompiledGroundRenderTile(built)
        renderResults.push({
          key: job.key,
          row: job.row,
          column: job.column,
          widthMeters: job.widthMeters,
          depthMeters: job.depthMeters,
          bounds: built.header.bounds,
          vertexCount: built.header.vertexCount,
          triangleCount: built.header.triangleCount,
          encodedTile,
        })
        transfers.push(encodedTile)
      }
      const response: CompiledGroundBuildWorkerResponse = {
        kind: 'compiled-ground-build-tiles-result',
        requestId: message.requestId,
        phase: 'render',
        renderResults,
      }
      self.postMessage(response, transfers)
      return
    }

    const collisionResults: CompiledGroundBuildWorkerCollisionResult[] = []
    const transfers: Transferable[] = []
    for (const job of message.jobs) {
      const built = buildCollisionTileData(
        workerDefinition,
        workerWorldBounds,
        job.minX,
        job.minZ,
        job.widthMeters,
        job.depthMeters,
        Math.max(1e-6, message.collisionSampleStepMeters ?? 1),
      )
      built.header.key = job.key
      built.header.row = job.row
      built.header.column = job.column
      const encodedTile = serializeCompiledGroundCollisionTile(built)
      const builtWidthMeters = built.header.bounds.maxX - built.header.bounds.minX
      const builtDepthMeters = built.header.bounds.maxZ - built.header.bounds.minZ
      collisionResults.push({
        key: job.key,
        row: job.row,
        column: job.column,
        widthMeters: builtWidthMeters,
        depthMeters: builtDepthMeters,
        bounds: built.header.bounds,
        rows: built.header.rows,
        columns: built.header.columns,
        elementSize: built.header.elementSize,
        encodedTile,
      })
      transfers.push(encodedTile)
    }
    const response: CompiledGroundBuildWorkerResponse = {
      kind: 'compiled-ground-build-tiles-result',
      requestId: message.requestId,
      phase: message.phase,
      collisionResults,
    }
    self.postMessage(response, transfers)
  } catch (error) {
    const response: CompiledGroundBuildWorkerResponse = message.kind === 'compiled-ground-init'
      ? {
        kind: 'compiled-ground-init-result',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
      : {
        kind: 'compiled-ground-build-tiles-result',
        requestId: message.requestId,
        phase: message.phase,
        error: error instanceof Error ? error.message : String(error),
      }
    self.postMessage(response)
  }
}
