import { decode, encode } from '@msgpack/msgpack'
import type { PhysicsSceneAsset } from '@harmony/physics-core'

export const ROAD_COLLISION_COMPILED_PACKAGE_USERDATA_KEY = '__harmonyRoadCollisionCompiledPackage'
export const ROAD_COLLISION_COMPILED_PACKAGE_VERSION = 2 as const
export const ROAD_COLLISION_COMPILED_MANIFEST_VERSION = 2 as const

export function buildRoadCollisionCompiledRootPath(sceneId: string): string {
  const normalizedSceneId = typeof sceneId === 'string' ? sceneId.trim() : ''
  if (!normalizedSceneId) {
    return 'scenes/unknown/road-collision'
  }
  return `scenes/${encodeURIComponent(normalizedSceneId)}/road-collision`
}

export function buildRoadCollisionCompiledManifestPath(sceneId: string): string {
  return `${buildRoadCollisionCompiledRootPath(sceneId)}/manifest.bin`
}

export function buildRoadCollisionCompiledPackagePath(sceneId: string, roadNodeId: string): string {
  const normalizedNodeId = typeof roadNodeId === 'string' ? roadNodeId.trim() : ''
  const fileName = normalizedNodeId ? `${encodeURIComponent(normalizedNodeId)}.bin` : 'unknown.bin'
  return `${buildRoadCollisionCompiledRootPath(sceneId)}/roads/${fileName}`
}

export interface RoadCollisionCompiledPackage {
  version: typeof ROAD_COLLISION_COMPILED_PACKAGE_VERSION
  sceneId: string
  roadNodeId: string
  signature: string
  asset: PhysicsSceneAsset
}

export interface RoadCollisionCompiledRoadEntry {
  nodeId: string
  path: string
  signature: string
  bodyCount: number
  shapeCount: number
}

export interface RoadCollisionCompiledManifest {
  version: typeof ROAD_COLLISION_COMPILED_MANIFEST_VERSION
  sceneId: string
  revision: number
  roads: RoadCollisionCompiledRoadEntry[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeRoadCollisionCompiledRoadEntry(raw: unknown): RoadCollisionCompiledRoadEntry | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const nodeId = normalizeString(raw.nodeId)
  const path = normalizeString(raw.path)
  const signature = normalizeString(raw.signature)
  const bodyCount = Math.max(0, Math.trunc(normalizeNumber(raw.bodyCount, 0)))
  const shapeCount = Math.max(0, Math.trunc(normalizeNumber(raw.shapeCount, 0)))
  if (!nodeId || !path || !signature) {
    return null
  }
  return {
    nodeId,
    path,
    signature,
    bodyCount,
    shapeCount,
  }
}

function normalizePhysicsVector3(value: unknown, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) {
    return [...fallback] as [number, number, number]
  }
  return [
    normalizeNumber(value[0], fallback[0]),
    normalizeNumber(value[1], fallback[1]),
    normalizeNumber(value[2], fallback[2]),
  ]
}

function normalizePhysicsQuaternion(value: unknown, fallback: [number, number, number, number] = [0, 0, 0, 1]): [number, number, number, number] {
  if (!Array.isArray(value) || value.length < 4) {
    return [...fallback] as [number, number, number, number]
  }
  return [
    normalizeNumber(value[0], fallback[0]),
    normalizeNumber(value[1], fallback[1]),
    normalizeNumber(value[2], fallback[2]),
    normalizeNumber(value[3], fallback[3]),
  ]
}

function normalizePhysicsShapeDesc(raw: any): any | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const kind = normalizeString(raw.kind)
  const id = Math.trunc(normalizeNumber(raw.id, 0))
  if (!(id > 0) || !kind) {
    return null
  }
  switch (kind) {
    case 'box':
      return {
        id,
        kind,
        halfExtents: normalizePhysicsVector3(raw.halfExtents),
      }
    case 'sphere':
      return {
        id,
        kind,
        radius: normalizeNumber(raw.radius, 0),
      }
    case 'cylinder':
      return {
        id,
        kind,
        radiusTop: normalizeNumber(raw.radiusTop, 0),
        radiusBottom: normalizeNumber(raw.radiusBottom, 0),
        height: normalizeNumber(raw.height, 0),
        segments: Number.isFinite(Number(raw.segments)) ? Math.trunc(Number(raw.segments)) : undefined,
      }
    case 'convex-hull':
      return {
        id,
        kind,
        vertices: Array.isArray(raw.vertices) ? raw.vertices.map((entry: unknown) => normalizeNumber(entry, 0)) : [],
        faces: Array.isArray(raw.faces)
          ? raw.faces
              .map((face: unknown) => (Array.isArray(face) ? face.map((entry: unknown) => Math.trunc(normalizeNumber(entry, 0))) : []))
              .filter((face: number[]) => face.length >= 3)
          : undefined,
      }
    case 'heightfield':
      return {
        id,
        kind,
        rows: Math.max(1, Math.trunc(normalizeNumber(raw.rows, 0))),
        columns: Math.max(1, Math.trunc(normalizeNumber(raw.columns, 0))),
        elementSize: normalizeNumber(raw.elementSize, 1),
        heights: Array.isArray(raw.heights) ? raw.heights.map((entry: unknown) => normalizeNumber(entry, 0)) : [],
        minHeight: Number.isFinite(Number(raw.minHeight)) ? normalizeNumber(raw.minHeight, 0) : undefined,
        maxHeight: Number.isFinite(Number(raw.maxHeight)) ? normalizeNumber(raw.maxHeight, 0) : undefined,
        localOffset: Array.isArray(raw.localOffset) ? normalizePhysicsVector3(raw.localOffset) : undefined,
      }
    case 'static-mesh':
      return {
        id,
        kind,
        vertices: Array.isArray(raw.vertices) ? raw.vertices.map((entry: unknown) => normalizeNumber(entry, 0)) : [],
        indices: Array.isArray(raw.indices) ? raw.indices.map((entry: unknown) => Math.trunc(normalizeNumber(entry, 0))) : [],
      }
    case 'compound':
      return {
        id,
        kind,
        children: Array.isArray(raw.children)
          ? raw.children.map((entry: unknown) => {
              if (!isPlainObject(entry)) {
                return null
              }
              const shapeId = Math.trunc(normalizeNumber(entry.shapeId, 0))
              if (!(shapeId > 0)) {
                return null
              }
              return {
                shapeId,
                transform: {
                  position: normalizePhysicsVector3(
                    isPlainObject((entry as Record<string, unknown>).transform)
                      ? ((entry as Record<string, unknown>).transform as Record<string, unknown>).position
                      : undefined,
                  ),
                  rotation: normalizePhysicsQuaternion(
                    isPlainObject((entry as Record<string, unknown>).transform)
                      ? ((entry as Record<string, unknown>).transform as Record<string, unknown>).rotation
                      : undefined,
                  ),
                },
              }
            }).filter((entry: unknown): entry is { shapeId: number; transform: { position: [number, number, number]; rotation: [number, number, number, number] } } => Boolean(entry))
          : [],
      }
    default:
      return null
  }
}

function normalizePhysicsMaterialDesc(raw: any): any | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const id = Math.trunc(normalizeNumber(raw.id, 0))
  if (!(id > 0)) {
    return null
  }
  return {
    id,
    friction: normalizeNumber(raw.friction, 0.5),
    restitution: normalizeNumber(raw.restitution, 0.1),
  }
}

function normalizePhysicsBodyDesc(raw: any): any | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const id = Math.trunc(normalizeNumber(raw.id, 0))
  const shapeId = Math.trunc(normalizeNumber(raw.shapeId, 0))
  const type = normalizeString(raw.type)
  if (!(id > 0) || !(shapeId > 0) || !type) {
    return null
  }
  return {
    id,
    type,
    mass: normalizeNumber(raw.mass, 0),
    materialId: raw.materialId == null ? null : Math.trunc(normalizeNumber(raw.materialId, 0)),
    shapeId,
    transform: {
      position: normalizePhysicsVector3(isPlainObject(raw.transform) ? raw.transform.position : undefined),
      rotation: normalizePhysicsQuaternion(isPlainObject(raw.transform) ? raw.transform.rotation : undefined),
    },
    linearDamping: raw.linearDamping == null ? undefined : normalizeNumber(raw.linearDamping, 0),
    angularDamping: raw.angularDamping == null ? undefined : normalizeNumber(raw.angularDamping, 0),
    userDataKey: raw.userDataKey == null ? null : normalizeString(raw.userDataKey),
  }
}

function normalizePhysicsVehicleDesc(raw: any): any | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const id = Math.trunc(normalizeNumber(raw.id, 0))
  const bodyId = Math.trunc(normalizeNumber(raw.bodyId, 0))
  if (!(id > 0) || !(bodyId > 0)) {
    return null
  }
  return {
    id,
    bodyId,
    indexRightAxis: Math.trunc(normalizeNumber(raw.indexRightAxis, 0)) as 0 | 1 | 2,
    indexUpAxis: Math.trunc(normalizeNumber(raw.indexUpAxis, 1)) as 0 | 1 | 2,
    indexForwardAxis: Math.trunc(normalizeNumber(raw.indexForwardAxis, 2)) as 0 | 1 | 2,
    wheels: Array.isArray(raw.wheels) ? raw.wheels.map((wheel: any) => wheel && typeof wheel === 'object' ? {
      id: Math.trunc(normalizeNumber((wheel as Record<string, unknown>).id, 0)),
      radius: normalizeNumber((wheel as Record<string, unknown>).radius, 0),
      isFrontWheel: Boolean((wheel as Record<string, unknown>).isFrontWheel),
      connectionPoint: normalizePhysicsVector3((wheel as Record<string, unknown>).connectionPoint),
      direction: normalizePhysicsVector3((wheel as Record<string, unknown>).direction),
      axle: normalizePhysicsVector3((wheel as Record<string, unknown>).axle),
      suspensionRestLength: normalizeNumber((wheel as Record<string, unknown>).suspensionRestLength, 0),
      suspensionStiffness: normalizeNumber((wheel as Record<string, unknown>).suspensionStiffness, 0),
      dampingRelaxation: normalizeNumber((wheel as Record<string, unknown>).dampingRelaxation, 0),
      dampingCompression: normalizeNumber((wheel as Record<string, unknown>).dampingCompression, 0),
      frictionSlip: normalizeNumber((wheel as Record<string, unknown>).frictionSlip, 0),
      rollInfluence: normalizeNumber((wheel as Record<string, unknown>).rollInfluence, 0),
      maxSuspensionTravel: (wheel as Record<string, unknown>).maxSuspensionTravel == null ? undefined : normalizeNumber((wheel as Record<string, unknown>).maxSuspensionTravel, 0),
      maxSuspensionForce: (wheel as Record<string, unknown>).maxSuspensionForce == null ? undefined : normalizeNumber((wheel as Record<string, unknown>).maxSuspensionForce, 0),
    } : null).filter((wheel: unknown) => Boolean(wheel)) : [],
  }
}

export function normalizeRoadCollisionCompiledManifest(input: unknown): RoadCollisionCompiledManifest | null {
  if (!isPlainObject(input) || input.version !== ROAD_COLLISION_COMPILED_MANIFEST_VERSION) {
    return null
  }
  const sceneId = normalizeString(input.sceneId)
  if (!sceneId) {
    return null
  }
  const revision = Math.max(0, Math.trunc(normalizeNumber(input.revision, 0)))
  const roads = Array.isArray(input.roads)
    ? input.roads
        .map((entry: unknown) => normalizeRoadCollisionCompiledRoadEntry(entry))
        .filter((entry: RoadCollisionCompiledRoadEntry | null): entry is RoadCollisionCompiledRoadEntry => entry !== null)
    : []
  return {
    version: ROAD_COLLISION_COMPILED_MANIFEST_VERSION,
    sceneId,
    revision,
    roads,
  }
}

export function normalizeRoadCollisionCompiledPackage(input: unknown): RoadCollisionCompiledPackage | null {
  if (!isPlainObject(input) || input.version !== ROAD_COLLISION_COMPILED_PACKAGE_VERSION) {
    return null
  }
  const assetRaw = isPlainObject(input.asset) ? input.asset : null
  if (!assetRaw || assetRaw.format !== 'harmony-physics') {
    return null
  }
  const materials = Array.isArray(assetRaw.materials)
    ? assetRaw.materials.map((entry: unknown) => normalizePhysicsMaterialDesc(entry)).filter((entry: unknown) => entry !== null)
    : []
  const shapes = Array.isArray(assetRaw.shapes)
    ? assetRaw.shapes.map((entry: unknown) => normalizePhysicsShapeDesc(entry)).filter((entry: unknown) => entry !== null)
    : []
  const bodies = Array.isArray(assetRaw.bodies)
    ? assetRaw.bodies.map((entry: unknown) => normalizePhysicsBodyDesc(entry)).filter((entry: unknown) => entry !== null)
    : []
  const vehicles = Array.isArray(assetRaw.vehicles)
    ? assetRaw.vehicles.map((entry: unknown) => normalizePhysicsVehicleDesc(entry)).filter((entry: unknown) => entry !== null)
    : []
  const sceneId = normalizeString(input.sceneId)
  const roadNodeId = normalizeString(input.roadNodeId)
  const signature = normalizeString(input.signature)
  if (!sceneId || !roadNodeId || !signature) {
    return null
  }
  return {
    version: ROAD_COLLISION_COMPILED_PACKAGE_VERSION,
    sceneId,
    roadNodeId,
    signature,
    asset: {
      format: 'harmony-physics',
      materials: materials as PhysicsSceneAsset['materials'],
      shapes: shapes as PhysicsSceneAsset['shapes'],
      bodies: bodies as PhysicsSceneAsset['bodies'],
      vehicles: vehicles as PhysicsSceneAsset['vehicles'],
      characters: [],
    },
  }
}

export function serializeRoadCollisionCompiledManifest(manifest: RoadCollisionCompiledManifest): Uint8Array {
  return encode(manifest)
}

export function deserializeRoadCollisionCompiledManifest(payload: ArrayBuffer | Uint8Array): RoadCollisionCompiledManifest | null {
  try {
    const decoded = decode(payload instanceof Uint8Array ? payload : new Uint8Array(payload)) as unknown
    return normalizeRoadCollisionCompiledManifest(decoded)
  } catch (_error) {
    return null
  }
}

export function serializeRoadCollisionCompiledPackage(pkg: RoadCollisionCompiledPackage): Uint8Array {
  return encode(pkg)
}

export function deserializeRoadCollisionCompiledPackage(payload: ArrayBuffer | Uint8Array): RoadCollisionCompiledPackage | null {
  try {
    const decoded = decode(payload instanceof Uint8Array ? payload : new Uint8Array(payload)) as unknown
    return normalizeRoadCollisionCompiledPackage(decoded)
  } catch (_error) {
    return null
  }
}

export function extractRoadCollisionCompiledPackageFromUserData(userData: unknown): RoadCollisionCompiledPackage | null {
  if (!isPlainObject(userData)) {
    return null
  }
  const raw = userData[ROAD_COLLISION_COMPILED_PACKAGE_USERDATA_KEY]
  return normalizeRoadCollisionCompiledPackage(raw)
}

export function attachRoadCollisionCompiledPackagesToDocument(
  document: { nodes?: unknown } | null | undefined,
  packagesByNodeId: Record<string, RoadCollisionCompiledPackage | null | undefined>,
): void {
  if (!document || !Array.isArray(document.nodes)) {
    return
  }
  const stack: unknown[] = [...document.nodes]
  while (stack.length) {
    const current = stack.pop() as Record<string, unknown> | null | undefined
    if (!current || typeof current !== 'object') {
      continue
    }
    const nodeId = normalizeString(current.id)
    if (nodeId) {
      const pkg = packagesByNodeId[nodeId] ?? null
      if (pkg) {
        const userData = isPlainObject(current.userData) ? { ...(current.userData as Record<string, unknown>) } : {}
        userData[ROAD_COLLISION_COMPILED_PACKAGE_USERDATA_KEY] = pkg
        current.userData = userData
      }
    }
    if (Array.isArray(current.children)) {
      stack.push(...current.children)
    }
  }
}
