import * as THREE from 'three'

import {
  GROUND_TERRAIN_CHUNK_SIZE_METERS,
  RIGIDBODY_COMPONENT_TYPE,
  clampRigidbodyComponentProps,
  deserializeGroundChunkData,
  parseGroundChunkKey,
  resolveGroundChunkCoordFromWorldPosition,
  resolveGroundChunkOrigin,
  type GroundChunkManifestRecord,
  type GroundRuntimeDynamicMesh,
  type RigidbodyComponentProps,
  type RigidbodyPhysicsShape,
  type SceneNode,
  type SceneNodeComponentState,
} from './index'
import {
  prepareGroundHeightSamplingContext,
  sampleGroundHeight,
  sampleGroundHeightWithContext,
  type GroundHeightSamplingContext,
} from './groundMesh'
import type {
  PhysicsBodyBindingEntry as RigidbodyInstance,
  PhysicsBodyLike,
  PhysicsOrientationAdjustment,
} from './physicsBodySync'
import {
  type PhysicsWorldLike,
  addPhysicsBodyToWorld,
  removePhysicsBodyBindingBodies,
} from './physicsRuntimeBridge'

type HeightfieldShapeDefinition = Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>

type InfiniteGroundChunkColliderSource = 'manifest' | 'runtime-detailed' | 'base-flat'

const GROUND_COLLISION_RADIUS_METERS = 150
const FLAT_HEIGHT_EPSILON = 1e-4
const FLAT_COLLIDER_THICKNESS_METERS = 4

export type InfiniteGroundChunkColliderRuntimeDeps = {
  getPhysicsWorld: () => PhysicsWorldLike | null
  ensurePhysicsWorld: () => PhysicsWorldLike
  createBody: (
    node: SceneNode,
    component: SceneNodeComponentState<RigidbodyComponentProps>,
    shapeDefinition: RigidbodyPhysicsShape | null,
    object: THREE.Object3D,
  ) => { body: PhysicsBodyLike; orientationAdjustment: PhysicsOrientationAdjustment | null } | null
  loggerTag?: string
}

export type InfiniteGroundChunkColliderSyncParams = {
  enabled: boolean
  groundObject: THREE.Object3D
  groundDefinition: GroundRuntimeDynamicMesh
  camera: THREE.Camera | null | undefined
  sourceId: string
  manifestRevision?: number
  manifestRecords?: Record<string, GroundChunkManifestRecord>
  loadChunkData?: (record: GroundChunkManifestRecord) => Promise<ArrayBuffer | null>
  excludedChunkKeys?: Iterable<string> | null
}

export type InfiniteGroundChunkColliderRuntime = {
  clear: () => void
  sync: (params: InfiniteGroundChunkColliderSyncParams) => void
  getActiveChunkKeys: () => string[]
  getDebugEntries: () => InfiniteGroundChunkColliderDebugEntry[]
}

export type InfiniteGroundChunkColliderDebugEntry = {
  runtimeKey: string
  nodeId: string
  source: InfiniteGroundChunkColliderSource
  instance: RigidbodyInstance
  shapes: HeightfieldShapeDefinition[]
}

export type InfiniteGroundChunkCollisionRuntimeState = {
  enabled: boolean
  sourceId: string
  signature: string
  activeChunkKeys: string[]
}

type PendingEntry = {
  signature: string
  promise: Promise<void>
}

type ChunkWindow = {
  activeChunkKeys: string[]
  retainedChunkKeys: string[]
}

type CachedHeightfieldShapeEntry = {
  signature: string
  shape: HeightfieldShapeDefinition
}

type CachedRigidbodyShapeEntry = {
  signature: string
  shape: RigidbodyPhysicsShape
}

const infiniteGroundCameraLocalHelper = new THREE.Vector3()

function uniqueSortedKeys(keys: Iterable<string> | null | undefined): string[] {
  return Array.from(new Set(Array.from(keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))).sort()
}

function resolveChunkSizeMeters(definition: Pick<GroundRuntimeDynamicMesh, 'chunkSizeMeters'>): number {
  const chunkSizeMeters = Number(definition.chunkSizeMeters)
  return Number.isFinite(chunkSizeMeters) && chunkSizeMeters > 1e-6
    ? chunkSizeMeters
    : GROUND_TERRAIN_CHUNK_SIZE_METERS
}

function resolveCellSizeMeters(definition: Pick<GroundRuntimeDynamicMesh, 'cellSize'>, chunkSizeMeters: number): number {
  const cellSize = Number(definition.cellSize)
  return Number.isFinite(cellSize) && cellSize > 1e-6
    ? cellSize
    : Math.max(1, chunkSizeMeters)
}

function resolveGroundDefinitionSignature(
  definition: Pick<
    GroundRuntimeDynamicMesh,
    | 'chunkSizeMeters'
    | 'cellSize'
    | 'baseHeight'
    | 'chunkManifestRevision'
    | 'surfaceRevision'
    | 'runtimeManualHeightOverrideCount'
    | 'runtimePlanningHeightOverrideCount'
    | 'runtimeHydratedHeightState'
  >,
): string {
  return [
    Number(definition.chunkSizeMeters) || 0,
    Number(definition.cellSize) || 0,
    Number(definition.baseHeight) || 0,
    Math.max(0, Math.trunc(Number(definition.chunkManifestRevision) || 0)),
    Math.max(0, Math.trunc(Number(definition.surfaceRevision) || 0)),
    Math.max(0, Math.trunc(Number(definition.runtimeManualHeightOverrideCount) || 0)),
    Math.max(0, Math.trunc(Number(definition.runtimePlanningHeightOverrideCount) || 0)),
    definition.runtimeHydratedHeightState === 'dirty' ? 'dirty' : 'pristine',
  ].join('|')
}

function stripRuntimeKeyPrefix(runtimeKey: string): string {
  const separatorIndex = runtimeKey.indexOf(':')
  return separatorIndex >= 0 ? runtimeKey.slice(separatorIndex + 1) : runtimeKey
}

function resolveManifestRuntimeKey(chunkKey: string): string {
  return `manifest:${chunkKey}`
}

function resolveRuntimeDetailedRuntimeKey(chunkKey: string): string {
  return `runtime-detailed:${chunkKey}`
}

function resolveBaseFlatRuntimeKey(chunkKey: string): string {
  return `base-flat:${chunkKey}`
}

function resolveChunkWindow(
  groundObject: THREE.Object3D,
  camera: THREE.Camera,
  chunkSizeMeters: number,
): ChunkWindow {
  groundObject.updateWorldMatrix(true, false)
  camera.updateWorldMatrix(true, false)
  camera.getWorldPosition(infiniteGroundCameraLocalHelper)
  groundObject.worldToLocal(infiniteGroundCameraLocalHelper)

  const centerCoord = resolveGroundChunkCoordFromWorldPosition(
    infiniteGroundCameraLocalHelper.x,
    infiniteGroundCameraLocalHelper.z,
    chunkSizeMeters,
  )
  const activeRadiusChunks = Math.max(1, Math.ceil(GROUND_COLLISION_RADIUS_METERS / chunkSizeMeters))
  const retainRadiusChunks = activeRadiusChunks + 1
  const activeChunkKeys: string[] = []
  const retainedChunkKeys: string[] = []

  for (let chunkZ = centerCoord.chunkZ - retainRadiusChunks; chunkZ <= centerCoord.chunkZ + retainRadiusChunks; chunkZ += 1) {
    for (let chunkX = centerCoord.chunkX - retainRadiusChunks; chunkX <= centerCoord.chunkX + retainRadiusChunks; chunkX += 1) {
      const chunkKey = `${chunkX}:${chunkZ}`
      retainedChunkKeys.push(chunkKey)
      if (
        chunkX >= centerCoord.chunkX - activeRadiusChunks
        && chunkX <= centerCoord.chunkX + activeRadiusChunks
        && chunkZ >= centerCoord.chunkZ - activeRadiusChunks
        && chunkZ <= centerCoord.chunkZ + activeRadiusChunks
      ) {
        activeChunkKeys.push(chunkKey)
      }
    }
  }

  return {
    activeChunkKeys: uniqueSortedKeys(activeChunkKeys),
    retainedChunkKeys: uniqueSortedKeys(retainedChunkKeys),
  }
}

function createStaticCollisionNode(nodeId: string): {
  node: SceneNode
  component: SceneNodeComponentState<RigidbodyComponentProps>
} {
  const component: SceneNodeComponentState<RigidbodyComponentProps> = {
    id: `${nodeId}:rigidbody`,
    type: RIGIDBODY_COMPONENT_TYPE,
    enabled: true,
    props: clampRigidbodyComponentProps({
      bodyType: 'STATIC',
      mass: 0,
      targetNodeId: nodeId,
    }),
  }
  return {
    node: {
      id: nodeId,
      name: nodeId,
      nodeType: 'object',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      components: {
        [RIGIDBODY_COMPONENT_TYPE]: component,
      },
    } as unknown as SceneNode,
    component,
  }
}

function convertRowMajorHeightsToMatrix(
  heights: Float32Array,
  rows: number,
  columns: number,
): number[][] {
  const pointsPerRow = columns + 1
  const matrix: number[][] = []
  for (let column = 0; column <= columns; column += 1) {
    const values: number[] = []
    for (let row = rows; row >= 0; row -= 1) {
      values.push(heights[row * pointsPerRow + column] ?? 0)
    }
    matrix.push(values)
  }
  return matrix
}

function buildManifestHeightfieldShape(record: GroundChunkManifestRecord, chunkData: {
  resolution: number
  cellSize: number
  heights: Float32Array
}): HeightfieldShapeDefinition | null {
  const rows = Math.max(1, Math.trunc(chunkData.resolution))
  const columns = rows
  const elementSize = Number(chunkData.cellSize)
  if (!Number.isFinite(elementSize) || elementSize <= 1e-6) {
    return null
  }
  return {
    kind: 'heightfield',
    matrix: convertRowMajorHeightsToMatrix(chunkData.heights, rows, columns),
    elementSize,
    width: columns * elementSize,
    depth: rows * elementSize,
    offset: [record.originX, record.originZ, 0],
    applyScale: false,
  }
}

function buildRuntimeDetailedShape(
  definition: GroundRuntimeDynamicMesh,
  context: GroundHeightSamplingContext,
  chunkKey: string,
  chunkSizeMeters: number,
): { shape: HeightfieldShapeDefinition; isFlat: boolean } | null {
  const coord = parseGroundChunkKey(chunkKey)
  if (!coord) {
    return null
  }
  const origin = resolveGroundChunkOrigin(coord, chunkSizeMeters)
  const preferredCellSize = resolveCellSizeMeters(definition, chunkSizeMeters)
  const resolution = Math.max(1, Math.round(chunkSizeMeters / preferredCellSize))
  const elementSize = chunkSizeMeters / resolution
  const matrix: number[][] = []
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY

  for (let column = 0; column <= resolution; column += 1) {
    const columnValues: number[] = []
    for (let row = resolution; row >= 0; row -= 1) {
      const x = origin.x + column * elementSize
      const z = origin.z + row * elementSize
      const height = sampleGroundHeightWithContext(definition, context, x, z)
      const safeHeight = Number.isFinite(height) ? height : 0
      columnValues.push(safeHeight)
      minHeight = Math.min(minHeight, safeHeight)
      maxHeight = Math.max(maxHeight, safeHeight)
    }
    matrix.push(columnValues)
  }

  return {
    shape: {
      kind: 'heightfield',
      matrix,
      elementSize,
      width: resolution * elementSize,
      depth: resolution * elementSize,
      offset: [origin.x, origin.z, 0],
      applyScale: false,
    },
    isFlat: Number.isFinite(minHeight) && Number.isFinite(maxHeight) && Math.abs(maxHeight - minHeight) <= FLAT_HEIGHT_EPSILON,
  }
}

function buildFlatChunkShape(
  definition: GroundRuntimeDynamicMesh,
  chunkKey: string,
  chunkSizeMeters: number,
  manifestRecord?: GroundChunkManifestRecord | null,
): RigidbodyPhysicsShape | null {
  const coord = parseGroundChunkKey(chunkKey)
  if (!coord) {
    return null
  }
  const origin = resolveGroundChunkOrigin(coord, chunkSizeMeters)
  const heightCandidates = [
    Number(manifestRecord?.heightMin),
    Number(manifestRecord?.heightMax),
    Number(definition.baseHeight),
    sampleGroundHeight(definition, origin.x + chunkSizeMeters * 0.5, origin.z + chunkSizeMeters * 0.5),
  ].filter((value) => Number.isFinite(value))
  const topHeight = heightCandidates.length > 0 ? Number(heightCandidates[0]) : 0
  const halfThickness = FLAT_COLLIDER_THICKNESS_METERS * 0.5
  return {
    kind: 'box',
    halfExtents: [chunkSizeMeters * 0.5, halfThickness, chunkSizeMeters * 0.5],
    offset: [
      origin.x + chunkSizeMeters * 0.5,
      topHeight - halfThickness,
      origin.z + chunkSizeMeters * 0.5,
    ],
    applyScale: false,
  }
}

export function collectInfiniteGroundChunkCollisionKeys(
  definition: Pick<GroundRuntimeDynamicMesh, 'terrainMode' | 'runtimeLoadedTileKeys'> | null | undefined,
): string[] {
  if (!definition || definition.terrainMode !== 'infinite') {
    return []
  }
  return uniqueSortedKeys(definition.runtimeLoadedTileKeys)
}

export function resolveInfiniteGroundChunkCollisionRuntimeState(params: {
  enabled: boolean
  definition: Pick<GroundRuntimeDynamicMesh, 'terrainMode' | 'runtimeLoadedTileKeys'>
  sourceId: string
}): InfiniteGroundChunkCollisionRuntimeState {
  const activeChunkKeys = params.enabled
    ? collectInfiniteGroundChunkCollisionKeys(params.definition)
    : []
  return {
    enabled: params.enabled,
    sourceId: params.sourceId,
    signature: [
      params.enabled ? 1 : 0,
      params.sourceId.trim(),
      activeChunkKeys.join(','),
    ].join('|'),
    activeChunkKeys,
  }
}

export function createInfiniteGroundChunkColliderRuntime(
  deps: InfiniteGroundChunkColliderRuntimeDeps,
): InfiniteGroundChunkColliderRuntime {
  const instances = new Map<string, RigidbodyInstance>()
  const debugShapes = new Map<string, HeightfieldShapeDefinition[]>()
  const manifestShapeCache = new Map<string, CachedHeightfieldShapeEntry>()
  const baseFlatShapeCache = new Map<string, CachedRigidbodyShapeEntry>()
  const residentChunkKeys = new Set<string>()
  const pendingLoads = new Map<string, PendingEntry>()
  let generation = 0
  let currentSourceId = ''
  let currentManifestRevision = -1
  let currentDefinitionSignature = ''

  function removeRuntimeKey(runtimeKey: string): void {
    const instance = instances.get(runtimeKey)
    if (instance) {
      removePhysicsBodyBindingBodies(deps.getPhysicsWorld(), instance)
      instances.delete(runtimeKey)
    }
    debugShapes.delete(runtimeKey)
  }

  function clear(): void {
    generation += 1
    residentChunkKeys.clear()
    pendingLoads.clear()
    manifestShapeCache.clear()
    baseFlatShapeCache.clear()
    Array.from(instances.keys()).forEach(removeRuntimeKey)
    currentSourceId = ''
    currentManifestRevision = -1
    currentDefinitionSignature = ''
  }

  function attachShape(
    params: InfiniteGroundChunkColliderSyncParams,
    runtimeKey: string,
    chunkKey: string,
    source: InfiniteGroundChunkColliderSource,
    shape: RigidbodyPhysicsShape | null,
  ): void {
    if (!shape) {
      return
    }
    const { node, component } = createStaticCollisionNode(`ground-collision:${params.sourceId}:${runtimeKey}`)
    const bodyResult = deps.createBody(node, component, shape, params.groundObject)
    if (!bodyResult?.body) {
      if (shape.kind === 'heightfield') {
        debugShapes.set(runtimeKey, [shape])
      }
      return
    }
    const world = deps.ensurePhysicsWorld()
    addPhysicsBodyToWorld(world, bodyResult.body)
    ;(bodyResult.body as PhysicsBodyLike & { name?: string }).name = `infinite-ground:${params.sourceId}:${runtimeKey}`
    instances.set(runtimeKey, {
      nodeId: node.id,
      body: bodyResult.body,
      bodies: [bodyResult.body],
      object: params.groundObject,
      orientationAdjustment: bodyResult.orientationAdjustment,
      syncObjectFromBody: false,
      signature: `${source}:${chunkKey}`,
    })
    if (shape.kind === 'heightfield') {
      debugShapes.set(runtimeKey, [shape])
    }
  }

  function sync(params: InfiniteGroundChunkColliderSyncParams): void {
    if (!params.enabled || !params.camera) {
      clear()
      return
    }
    if (currentSourceId !== params.sourceId || currentManifestRevision !== (params.manifestRevision ?? 0)) {
      clear()
      currentSourceId = params.sourceId
      currentManifestRevision = params.manifestRevision ?? 0
    }
    const definitionSignature = resolveGroundDefinitionSignature(params.groundDefinition)
    if (currentDefinitionSignature !== definitionSignature) {
      clear()
      currentSourceId = params.sourceId
      currentManifestRevision = params.manifestRevision ?? 0
      currentDefinitionSignature = definitionSignature
    }

    const chunkSizeMeters = resolveChunkSizeMeters(params.groundDefinition)
    const heightSamplingContext = prepareGroundHeightSamplingContext(params.groundDefinition)
    const { activeChunkKeys, retainedChunkKeys } = resolveChunkWindow(
      params.groundObject,
      params.camera,
      chunkSizeMeters,
    )
    const excludedChunkKeys = new Set(uniqueSortedKeys(params.excludedChunkKeys))
    const retainedSet = new Set(retainedChunkKeys.filter((chunkKey) => !excludedChunkKeys.has(chunkKey)))
    residentChunkKeys.clear()
    retainedSet.forEach((chunkKey) => residentChunkKeys.add(chunkKey))

    Array.from(instances.keys()).forEach((runtimeKey) => {
      if (!retainedSet.has(stripRuntimeKeyPrefix(runtimeKey))) {
        removeRuntimeKey(runtimeKey)
      }
    })
    Array.from(pendingLoads.keys()).forEach((runtimeKey) => {
      if (!retainedSet.has(stripRuntimeKeyPrefix(runtimeKey))) {
        pendingLoads.delete(runtimeKey)
      }
    })

    for (const chunkKey of activeChunkKeys) {
      if (excludedChunkKeys.has(chunkKey)) {
        continue
      }

      const manifestRecord = params.manifestRecords?.[chunkKey] ?? null
      const manifestLooksFlat = manifestRecord
        ? Math.abs((Number(manifestRecord.heightMax) || 0) - (Number(manifestRecord.heightMin) || 0)) <= FLAT_HEIGHT_EPSILON
        : false
      const manifestRuntimeKey = resolveManifestRuntimeKey(chunkKey)
      const runtimeDetailedRuntimeKey = resolveRuntimeDetailedRuntimeKey(chunkKey)
      const baseFlatRuntimeKey = resolveBaseFlatRuntimeKey(chunkKey)

      if (manifestRecord && !manifestLooksFlat && typeof params.loadChunkData === 'function') {
        removeRuntimeKey(runtimeDetailedRuntimeKey)
        removeRuntimeKey(baseFlatRuntimeKey)
        if (!instances.has(manifestRuntimeKey) && !pendingLoads.has(manifestRuntimeKey)) {
          const pendingSignature = `${params.sourceId}|${params.manifestRevision ?? 0}|${manifestRuntimeKey}|${manifestRecord.revision}`
          const pendingGeneration = generation
          const promise = params.loadChunkData(manifestRecord)
            .then((buffer) => {
              const pending = pendingLoads.get(manifestRuntimeKey)
              if (!pending || pending.signature !== pendingSignature) {
                return
              }
              if (pendingGeneration !== generation || !retainedSet.has(chunkKey)) {
                return
              }
              const parsed = deserializeGroundChunkData(buffer)
              if (!parsed) {
                return
              }
              const resolution = Math.max(1, Math.trunc(Number(parsed.header.resolution) || 0))
              const cellSize = Number(parsed.header.cellSize)
              const expectedLength = (resolution + 1) * (resolution + 1)
              if (!Number.isFinite(cellSize) || cellSize <= 1e-6 || parsed.heights.length !== expectedLength) {
                return
              }
              const shapeSignature = [
                params.sourceId.trim(),
                Math.max(0, Math.trunc(Number(params.manifestRevision) || 0)),
                manifestRuntimeKey,
                Math.max(0, Math.trunc(Number(manifestRecord.revision) || 0)),
                resolution,
                cellSize,
                parsed.heights.length,
              ].join('|')
              const cachedShape = manifestShapeCache.get(manifestRuntimeKey)
              const shape = cachedShape?.signature === shapeSignature
                ? cachedShape.shape
                : buildManifestHeightfieldShape(manifestRecord, {
                    resolution,
                    cellSize,
                    heights: parsed.heights instanceof Float32Array ? parsed.heights : new Float32Array(parsed.heights),
                  })
              if (!shape) {
                return
              }
              manifestShapeCache.set(manifestRuntimeKey, {
                signature: shapeSignature,
                shape,
              })
              attachShape(params, manifestRuntimeKey, chunkKey, 'manifest', shape)
            })
            .catch(() => {
              // Ignore transient chunk load failures; the next sync can retry or fall back.
            })
            .finally(() => {
              const currentPending = pendingLoads.get(manifestRuntimeKey)
              if (currentPending?.signature === pendingSignature) {
                pendingLoads.delete(manifestRuntimeKey)
              }
            })
          pendingLoads.set(manifestRuntimeKey, {
            signature: pendingSignature,
            promise,
          })
        }
        continue
      }

      removeRuntimeKey(manifestRuntimeKey)

      if (instances.has(runtimeDetailedRuntimeKey)) {
        removeRuntimeKey(baseFlatRuntimeKey)
        continue
      }
      if (instances.has(baseFlatRuntimeKey)) {
        continue
      }

      const runtimeDetailed = buildRuntimeDetailedShape(
        params.groundDefinition,
        heightSamplingContext.context,
        chunkKey,
        chunkSizeMeters,
      )
      if (runtimeDetailed && !runtimeDetailed.isFlat) {
        removeRuntimeKey(baseFlatRuntimeKey)
        attachShape(params, runtimeDetailedRuntimeKey, chunkKey, 'runtime-detailed', runtimeDetailed.shape)
        continue
      }

      const baseFlatShapeSignature = [
        params.sourceId.trim(),
        Math.max(0, Math.trunc(Number(params.manifestRevision) || 0)),
        currentDefinitionSignature,
        baseFlatRuntimeKey,
        manifestRecord ? Math.max(0, Math.trunc(Number(manifestRecord.revision) || 0)) : -1,
        manifestRecord ? Number(manifestRecord.heightMin) || 0 : 0,
        manifestRecord ? Number(manifestRecord.heightMax) || 0 : 0,
      ].join('|')
      const cachedBaseFlatShape = baseFlatShapeCache.get(baseFlatRuntimeKey)
      const baseFlatShape = cachedBaseFlatShape?.signature === baseFlatShapeSignature
        ? cachedBaseFlatShape.shape
        : buildFlatChunkShape(
            params.groundDefinition,
            chunkKey,
            chunkSizeMeters,
            manifestRecord,
          )
      if (!baseFlatShape) {
        continue
      }
      baseFlatShapeCache.set(baseFlatRuntimeKey, {
        signature: baseFlatShapeSignature,
        shape: baseFlatShape,
      })
      attachShape(params, baseFlatRuntimeKey, chunkKey, 'base-flat', baseFlatShape)
    }
  }

  return {
    clear,
    sync,
    getActiveChunkKeys: () => uniqueSortedKeys(Array.from(residentChunkKeys)),
    getDebugEntries: () => Array.from(instances.entries()).map(([runtimeKey, instance]) => ({
      runtimeKey,
      nodeId: instance.nodeId,
      source: runtimeKey.startsWith('manifest:')
        ? 'manifest'
        : runtimeKey.startsWith('runtime-detailed:')
          ? 'runtime-detailed'
          : 'base-flat',
      instance,
      shapes: debugShapes.get(runtimeKey)?.map((shape) => ({
        ...shape,
        matrix: shape.matrix.map((column) => [...column]),
      })) ?? [],
    })),
  }
}
