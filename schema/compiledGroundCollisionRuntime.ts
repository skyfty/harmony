import * as THREE from 'three'

import {
  deserializeCompiledGroundCollisionTile,
  type CompiledGroundCollisionTileData,
  type CompiledGroundCollisionTileRecord,
  type CompiledGroundManifest,
} from './compiledGround'
import {
  RIGIDBODY_COMPONENT_TYPE,
  clampRigidbodyComponentProps,
  type RigidbodyComponentProps,
  type RigidbodyPhysicsShape,
  type SceneNode,
  type SceneNodeComponentState,
} from './index'
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

const GROUND_COLLISION_RADIUS_METERS = 150

export type CompiledGroundCollisionRuntimeState = {
  enabled: boolean
  sourceId: string
  revision: number
  signature: string
  tileKeys: string[]
}

type CompiledGroundCollisionRuntimeDeps = {
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

type SyncCompiledGroundCollisionTilesParams = {
  enabled: boolean
  groundObject: THREE.Object3D
  camera: THREE.Camera | null | undefined
  sourceId: string
  revision: number
  manifest: CompiledGroundManifest
  loadTileData: (record: CompiledGroundCollisionTileRecord) => Promise<ArrayBuffer | null>
  activeRadiusTiles?: number
  retainRadiusTiles?: number
}

type PendingEntry = {
  signature: string
  promise: Promise<void>
}

type CollisionTileWindow = {
  activeKeys: string[]
  retainedKeys: string[]
  desiredRecords: CompiledGroundCollisionTileRecord[]
}

const compiledGroundCameraLocalHelper = new THREE.Vector3()

function stringifyCollisionDebugPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload)
  } catch (_error) {
    return '"[unserializable]"'
  }
}

function logCompiledGroundCollisionDebug(loggerTag: string | undefined, message: string, payload?: unknown): void {
  if (!loggerTag) {
    return
  }
  const suffix = typeof payload === 'undefined' ? '' : ` ${stringifyCollisionDebugPayload(payload)}`
  console.warn(`[${loggerTag}] ${message}${suffix}`)
}

function uniqueSortedKeys(keys: Iterable<string> | null | undefined): string[] {
  return Array.from(new Set(Array.from(keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))).sort()
}

function distanceSquaredPointToRect(
  x: number,
  z: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): number {
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0
  return dx * dx + dz * dz
}

function convertHeightsToMatrix(
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

function buildHeightfieldShapeFromCompiledTile(
  record: CompiledGroundCollisionTileRecord,
  data: CompiledGroundCollisionTileData,
): HeightfieldShapeDefinition | null {
  const rows = Math.max(1, Math.trunc(Number(data.header.rows) || 0))
  const columns = Math.max(1, Math.trunc(Number(data.header.columns) || 0))
  const elementSize = Number(data.header.elementSize)
  if (!Number.isFinite(elementSize) || elementSize <= 1e-6) {
    return null
  }
  return {
    kind: 'heightfield',
    matrix: convertHeightsToMatrix(data.heights, rows, columns),
    elementSize,
    width: columns * elementSize,
    depth: rows * elementSize,
    offset: [record.bounds.minX, record.bounds.minZ, 0],
    applyScale: false,
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

function resolveCollisionTileWindow(
  groundObject: THREE.Object3D,
  manifest: CompiledGroundManifest,
  camera: THREE.Camera,
  activeRadiusTiles?: number,
  retainRadiusTiles?: number,
): CollisionTileWindow {
  groundObject.updateWorldMatrix(true, false)
  camera.updateWorldMatrix(true, false)
  camera.getWorldPosition(compiledGroundCameraLocalHelper)
  groundObject.worldToLocal(compiledGroundCameraLocalHelper)

  const tileSizeMeters = Math.max(1e-6, Number(manifest.collisionTileSizeMeters) || 1)
  const resolvedActiveRadiusTiles = Math.max(
    1,
    Math.trunc(activeRadiusTiles ?? Math.ceil(GROUND_COLLISION_RADIUS_METERS / tileSizeMeters)),
  )
  const resolvedRetainRadiusTiles = Math.max(
    resolvedActiveRadiusTiles,
    Math.trunc(retainRadiusTiles ?? (resolvedActiveRadiusTiles + 1)),
  )
  const activeRadiusMeters = resolvedActiveRadiusTiles * tileSizeMeters
  const retainRadiusMeters = resolvedRetainRadiusTiles * tileSizeMeters

  const desired: Array<{ record: CompiledGroundCollisionTileRecord; distSq: number }> = []
  const retained: string[] = []
  for (const record of manifest.collisionTiles ?? []) {
    const distSq = distanceSquaredPointToRect(
      compiledGroundCameraLocalHelper.x,
      compiledGroundCameraLocalHelper.z,
      Number(record.bounds?.minX) || 0,
      Number(record.bounds?.maxX) || 0,
      Number(record.bounds?.minZ) || 0,
      Number(record.bounds?.maxZ) || 0,
    )
    if (distSq <= retainRadiusMeters * retainRadiusMeters) {
      retained.push(record.key)
      if (distSq <= activeRadiusMeters * activeRadiusMeters) {
        desired.push({ record, distSq })
      }
    }
  }
  desired.sort((left, right) => left.distSq - right.distSq)
  return {
    activeKeys: desired.map((entry) => entry.record.key),
    retainedKeys: uniqueSortedKeys(retained),
    desiredRecords: desired.map((entry) => entry.record),
  }
}

export function collectCompiledGroundCollisionTileKeys(
  manifest: CompiledGroundManifest | null | undefined,
  runtimeLoadedTileKeys?: readonly string[] | null,
): string[] {
  const runtimeKeys = uniqueSortedKeys(runtimeLoadedTileKeys)
  if (runtimeKeys.length > 0) {
    return runtimeKeys
  }
  if (!manifest?.collisionTiles?.length) {
    return []
  }
  return uniqueSortedKeys(manifest.collisionTiles.map((tile) => tile.key))
}

export function resolveCompiledGroundCollisionRuntimeState(params: {
  enabled: boolean
  manifest: CompiledGroundManifest | null | undefined
  runtimeLoadedTileKeys?: readonly string[] | null
  sourceId: string
  revision: number
}): CompiledGroundCollisionRuntimeState {
  const tileKeys = params.enabled
    ? collectCompiledGroundCollisionTileKeys(params.manifest, params.runtimeLoadedTileKeys)
    : []
  return {
    enabled: params.enabled,
    sourceId: params.sourceId,
    revision: Math.max(0, Math.trunc(params.revision)),
    signature: [
      params.enabled ? 1 : 0,
      params.sourceId.trim(),
      Math.max(0, Math.trunc(params.revision)),
      tileKeys.join(','),
    ].join('|'),
    tileKeys,
  }
}

export type CompiledGroundCollisionDebugEntry = {
  nodeId: string
  tileKey: string
  instance: RigidbodyInstance
  shapes: HeightfieldShapeDefinition[]
}

export function createCompiledGroundCollisionRuntime(
  deps: CompiledGroundCollisionRuntimeDeps,
): {
  clear: () => void
  sync: (params: SyncCompiledGroundCollisionTilesParams) => void
  getActiveTileKeys: () => string[]
  getDebugEntries: () => CompiledGroundCollisionDebugEntry[]
} {
  const instances = new Map<string, RigidbodyInstance>()
  const debugShapes = new Map<string, HeightfieldShapeDefinition[]>()
  const pendingLoads = new Map<string, PendingEntry>()
  let residentTileKeys: string[] = []
  let generation = 0
  let currentSourceId = ''
  let currentRevision = -1
  let lastWindowSignature = ''

  function removeInstance(tileKey: string): void {
    const instance = instances.get(tileKey)
    if (!instance) {
      return
    }
    removePhysicsBodyBindingBodies(deps.getPhysicsWorld(), instance)
    instances.delete(tileKey)
    debugShapes.delete(tileKey)
  }

  function clear(): void {
    generation += 1
    residentTileKeys = []
    pendingLoads.clear()
    Array.from(instances.keys()).forEach(removeInstance)
    currentSourceId = ''
    currentRevision = -1
    lastWindowSignature = ''
  }

  function sync(params: SyncCompiledGroundCollisionTilesParams): void {
    if (!params.enabled || !params.camera || !params.manifest?.collisionTiles?.length) {
      clear()
      return
    }
    if (currentSourceId !== params.sourceId || currentRevision !== params.revision) {
      clear()
      currentSourceId = params.sourceId
      currentRevision = params.revision
    }

    const window = resolveCollisionTileWindow(
      params.groundObject,
      params.manifest,
      params.camera,
      params.activeRadiusTiles,
      params.retainRadiusTiles,
    )
    const windowSignature = [
      params.sourceId.trim(),
      Math.max(0, Math.trunc(Number(params.revision) || 0)),
      window.activeKeys.join(','),
      window.retainedKeys.join(','),
    ].join('|')
    if (windowSignature !== lastWindowSignature) {
      lastWindowSignature = windowSignature
      logCompiledGroundCollisionDebug(deps.loggerTag, 'Compiled collision window', {
        sourceId: params.sourceId,
        revision: params.revision,
        activeKeys: window.activeKeys,
        retainedKeys: window.retainedKeys,
        desiredRecordCount: window.desiredRecords.length,
        manifestTileCount: params.manifest.collisionTiles?.length ?? 0,
      })
    }
    const retainedKeySet = new Set(window.retainedKeys)
    residentTileKeys = window.retainedKeys

    Array.from(instances.keys()).forEach((tileKey) => {
      if (!retainedKeySet.has(tileKey)) {
        removeInstance(tileKey)
      }
    })
    Array.from(pendingLoads.keys()).forEach((tileKey) => {
      if (!retainedKeySet.has(tileKey)) {
        pendingLoads.delete(tileKey)
      }
    })

    for (const record of window.desiredRecords) {
      if (instances.has(record.key) || pendingLoads.has(record.key)) {
        continue
      }
      const pendingSignature = `${params.sourceId}|${params.revision}|${record.key}|${record.path}`
      const pendingGeneration = generation
      const promise = params.loadTileData(record)
        .then((buffer) => {
          const pending = pendingLoads.get(record.key)
          if (!pending || pending.signature !== pendingSignature) {
            return
          }
          if (pendingGeneration !== generation || !retainedKeySet.has(record.key)) {
            return
          }
          const tileData = deserializeCompiledGroundCollisionTile(buffer)
          if (!tileData) {
            logCompiledGroundCollisionDebug(deps.loggerTag, 'Compiled collision tile decode failed', {
              sourceId: params.sourceId,
              tileKey: record.key,
              path: record.path,
              hasBuffer: buffer instanceof ArrayBuffer,
              byteLength: buffer instanceof ArrayBuffer ? buffer.byteLength : null,
            })
            return
          }
          const shape = buildHeightfieldShapeFromCompiledTile(record, tileData)
          if (!shape) {
            logCompiledGroundCollisionDebug(deps.loggerTag, 'Compiled collision tile shape build failed', {
              sourceId: params.sourceId,
              tileKey: record.key,
              path: record.path,
              rows: tileData.header.rows,
              columns: tileData.header.columns,
              elementSize: tileData.header.elementSize,
            })
            return
          }
          const { node, component } = createStaticCollisionNode(`ground-collision:${params.sourceId}:compiled:${record.key}`)
          const bodyResult = deps.createBody(node, component, shape, params.groundObject)
          if (!bodyResult?.body) {
            logCompiledGroundCollisionDebug(deps.loggerTag, 'Compiled collision body creation failed', {
              sourceId: params.sourceId,
              tileKey: record.key,
              path: record.path,
              shape,
            })
            debugShapes.set(record.key, [shape])
            return
          }
          const world = deps.ensurePhysicsWorld()
          addPhysicsBodyToWorld(world, bodyResult.body)
          ;(bodyResult.body as PhysicsBodyLike & { name?: string }).name = `compiled-ground:${params.sourceId}:${record.key}`
          instances.set(record.key, {
            nodeId: node.id,
            body: bodyResult.body,
            bodies: [bodyResult.body],
            object: params.groundObject,
            orientationAdjustment: bodyResult.orientationAdjustment,
            syncObjectFromBody: false,
            signature: pendingSignature,
          })
          debugShapes.set(record.key, [shape])
          logCompiledGroundCollisionDebug(deps.loggerTag, 'Compiled collision body created', {
            sourceId: params.sourceId,
            tileKey: record.key,
            path: record.path,
            shapeKind: shape.kind,
            rows: shape.kind === 'heightfield' ? shape.matrix[0]?.length ?? 0 : null,
            columns: shape.kind === 'heightfield' ? shape.matrix.length : null,
            elementSize: shape.kind === 'heightfield' ? shape.elementSize : null,
            offset: shape.offset,
          })
        })
        .catch(() => {
          logCompiledGroundCollisionDebug(deps.loggerTag, 'Compiled collision tile load failed', {
            sourceId: params.sourceId,
            tileKey: record.key,
            path: record.path,
          })
        })
        .finally(() => {
          const currentPending = pendingLoads.get(record.key)
          if (currentPending?.signature === pendingSignature) {
            pendingLoads.delete(record.key)
          }
        })
      pendingLoads.set(record.key, {
        signature: pendingSignature,
        promise,
      })
    }
  }

  return {
    clear,
    sync,
    getActiveTileKeys: () => [...residentTileKeys],
    getDebugEntries: () => Array.from(instances.entries()).map(([tileKey, instance]) => ({
      nodeId: instance.nodeId,
      tileKey,
      instance,
      shapes: debugShapes.get(tileKey)?.map((shape) => ({
        ...shape,
        matrix: shape.matrix.map((column) => [...column]),
      })) ?? [],
    })),
  }
}
