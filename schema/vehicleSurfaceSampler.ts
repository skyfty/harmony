import * as THREE from 'three'
import type { FloorDynamicMesh, GroundDynamicMesh, GroundRuntimeDynamicMesh, RoadDynamicMesh, SceneNode } from './index'
import { sampleGroundNormal, sampleGroundTriangleHeight } from './groundMesh'
import { isPointInsideRegionXZ } from './regionUtils'
import { createSegmentHeightSampler, resolveRoadLocalHeightSampler } from './roadMesh'

export type VehicleSurfaceKind = 'ground' | 'road' | 'floor'

export type VehicleSurfaceSample = {
  kind: VehicleSurfaceKind
  nodeId: string
  point: THREE.Vector3
  normal: THREE.Vector3
  distance: number
}

export type VehicleSurfaceSampler = {
  sampleSurfaceAtWorld: (x: number, z: number, preferredHeight?: number | null) => VehicleSurfaceSample | null
}

type FloorSurfaceEntry = {
  nodeId: string
  definition: FloorDynamicMesh
  worldMatrix: THREE.Matrix4
  inverseWorldMatrix: THREE.Matrix4
  worldQuaternion: THREE.Quaternion
  topHeightLocal: number
}

type RoadSurfaceEntry = {
  nodeId: string
  definition: RoadDynamicMesh
  roadOriginX: number
  roadOriginY: number
  roadOriginZ: number
  localHeightSampler: ((x: number, z: number) => number) | null
  serializedHeightSampler: ((x: number, z: number) => number) | null
  inverseYawQuaternion: THREE.Quaternion
  yawQuaternion: THREE.Quaternion
  localSegments: Array<{ a: THREE.Vector2; b: THREE.Vector2 }>
  halfWidth: number
}

type GroundSurfaceEntry = {
  nodeId: string
  definition: GroundRuntimeDynamicMesh
  origin: THREE.Vector3
}

const SURFACE_NORMAL_DELTA = 0.2
const ROAD_SEGMENT_EPSILON = 1e-6

const localPointHelper = new THREE.Vector3()
const worldPointHelper = new THREE.Vector3()
const localNormalHelper = new THREE.Vector3()
const worldNormalHelper = new THREE.Vector3()
const composePositionHelper = new THREE.Vector3()
const composeQuaternionHelper = new THREE.Quaternion()
const composeScaleHelper = new THREE.Vector3()
const invertMatrixHelper = new THREE.Matrix4()
const pointOnSegmentHelper = new THREE.Vector2()
const roadSampleWorldHelper = new THREE.Vector3()

function formatDebugObject(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value, (_key, currentValue) => {
      if (currentValue instanceof THREE.Vector3) {
        return { x: currentValue.x, y: currentValue.y, z: currentValue.z }
      }
      if (currentValue instanceof THREE.Euler) {
        return { x: currentValue.x, y: currentValue.y, z: currentValue.z, order: currentValue.order }
      }
      if (currentValue instanceof THREE.Quaternion) {
        return { x: currentValue.x, y: currentValue.y, z: currentValue.z, w: currentValue.w }
      }
      if (currentValue instanceof THREE.Matrix4) {
        return { elements: currentValue.elements.slice() }
      }
      if (currentValue && typeof currentValue === 'object') {
        if (seen.has(currentValue)) {
          return '[Circular]'
        }
        seen.add(currentValue)
      }
      return currentValue
    }, 2)
  } catch {
    try {
      return String(value)
    } catch {
      return '[Unserializable]'
    }
  }
}

function logSurfaceDebug(label: string, payload: unknown): void {
  console.log(`[VehicleSurfaceSampler] ${label}\n${formatDebugObject(payload)}`)
}

function readFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function readNodePosition(node: SceneNode | null | undefined): THREE.Vector3 {
  const position = (node?.position as { x?: unknown; y?: unknown; z?: unknown } | undefined) ?? undefined
  return new THREE.Vector3(
    readFiniteNumber(position?.x, 0),
    readFiniteNumber(position?.y, 0),
    readFiniteNumber(position?.z, 0),
  )
}

function readNodeRotation(node: SceneNode | null | undefined): THREE.Euler {
  const rotation = (node?.rotation as { x?: unknown; y?: unknown; z?: unknown } | undefined) ?? undefined
  return new THREE.Euler(
    readFiniteNumber(rotation?.x, 0),
    readFiniteNumber(rotation?.y, 0),
    readFiniteNumber(rotation?.z, 0),
    'XYZ',
  )
}

function readNodeScale(node: SceneNode | null | undefined): THREE.Vector3 {
  const scale = (node?.scale as { x?: unknown; y?: unknown; z?: unknown } | undefined) ?? undefined
  return new THREE.Vector3(
    readFiniteNumber(scale?.x, 1),
    readFiniteNumber(scale?.y, 1),
    readFiniteNumber(scale?.z, 1),
  )
}

function composeNodeWorldMatrix(node: SceneNode): { matrix: THREE.Matrix4; inverse: THREE.Matrix4; quaternion: THREE.Quaternion } {
  composePositionHelper.copy(readNodePosition(node))
  composeQuaternionHelper.setFromEuler(readNodeRotation(node))
  composeScaleHelper.copy(readNodeScale(node))
  const matrix = new THREE.Matrix4().compose(composePositionHelper, composeQuaternionHelper, composeScaleHelper)
  const inverse = invertMatrixHelper.copy(matrix).invert().clone()
  return {
    matrix,
    inverse,
    quaternion: composeQuaternionHelper.clone(),
  }
}


function isGroundNode(node: SceneNode | null | undefined): node is SceneNode & { dynamicMesh: GroundDynamicMesh } {
  return Boolean(node?.dynamicMesh && (node.dynamicMesh as { type?: unknown }).type === 'Ground')
}

function isRoadNode(node: SceneNode | null | undefined): node is SceneNode & { dynamicMesh: RoadDynamicMesh } {
  return Boolean(node?.dynamicMesh && (node.dynamicMesh as { type?: unknown }).type === 'Road')
}

function isFloorNode(node: SceneNode | null | undefined): node is SceneNode & { dynamicMesh: FloorDynamicMesh } {
  return Boolean(node?.dynamicMesh && (node.dynamicMesh as { type?: unknown }).type === 'Floor')
}

function distanceSqPointToSegment(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2, outPoint?: THREE.Vector2): number {
  const abx = b.x - a.x
  const abz = b.y - a.y
  const lengthSq = abx * abx + abz * abz
  if (lengthSq <= ROAD_SEGMENT_EPSILON) {
    outPoint?.copy(a)
    const dx = point.x - a.x
    const dz = point.y - a.y
    return dx * dx + dz * dz
  }
  const t = THREE.MathUtils.clamp(((point.x - a.x) * abx + (point.y - a.y) * abz) / lengthSq, 0, 1)
  const px = a.x + abx * t
  const pz = a.y + abz * t
  outPoint?.set(px, pz)
  const dx = point.x - px
  const dz = point.y - pz
  return dx * dx + dz * dz
}

function createRoadSurfaceEntry(node: SceneNode, groundNode: SceneNode | null): RoadSurfaceEntry | null {
  const definition = node.dynamicMesh as RoadDynamicMesh
  if (!Array.isArray(definition.vertices) || !Array.isArray(definition.segments) || !definition.segments.length) {
    return null
  }
  const roadPosition = readNodePosition(node)
  const yaw = readNodeRotation(node).y
  const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
  const inverseYawQuaternion = yawQuaternion.clone().invert()
  const localSegments = definition.segments
    .map((segment) => {
      const a = definition.vertices[segment.a]
      const b = definition.vertices[segment.b]
      if (!Array.isArray(a) || !Array.isArray(b)) {
        return null
      }
      return {
        a: new THREE.Vector2(readFiniteNumber(a[0], 0), readFiniteNumber(a[1], 0)),
        b: new THREE.Vector2(readFiniteNumber(b[0], 0), readFiniteNumber(b[1], 0)),
      }
    })
    .filter((entry): entry is { a: THREE.Vector2; b: THREE.Vector2 } => Boolean(entry))
  if (!localSegments.length) {
    return null
  }

  return {
    nodeId: node.id,
    definition,
    roadOriginX: roadPosition.x,
    roadOriginY: roadPosition.y,
    roadOriginZ: roadPosition.z,
    localHeightSampler: resolveRoadLocalHeightSampler(node, groundNode) ?? (() => 0),
    serializedHeightSampler: Array.isArray((definition as any).segmentHeights)
      ? createSegmentHeightSampler({
        vertexVectors: definition.vertices.map((vertex) => new THREE.Vector3(readFiniteNumber(vertex?.[0], 0), 0, readFiniteNumber(vertex?.[1], 0))),
        sanitizedSegments: definition.segments.map((segment, index) => ({ a: segment.a, b: segment.b, segmentIndex: index })),
      } as any, (definition as any).segmentHeights)
      : null,
    inverseYawQuaternion,
    yawQuaternion,
    localSegments,
    halfWidth: Math.max(0.1, readFiniteNumber(definition.width, 2) * 0.5),
  }
}

function sampleRoadSurface(entry: RoadSurfaceEntry, worldX: number, worldZ: number, preferredHeight?: number | null): VehicleSurfaceSample | null {
  const roadLocalPoint = new THREE.Vector3(
    worldX - entry.roadOriginX,
    0,
    worldZ - entry.roadOriginZ,
  )
  roadLocalPoint.applyQuaternion(entry.inverseYawQuaternion)
  const q = new THREE.Vector2(roadLocalPoint.x, roadLocalPoint.z)

  let bestDistanceSq = Number.POSITIVE_INFINITY
  for (const segment of entry.localSegments) {
    const distanceSq = distanceSqPointToSegment(q, segment.a, segment.b, pointOnSegmentHelper)
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
    }
  }
  if (bestDistanceSq > entry.halfWidth * entry.halfWidth) {
    logSurfaceDebug('road-rejected-width', {
      nodeId: entry.nodeId,
      queryWorld: { x: worldX, z: worldZ },
      queryLocal: { x: q.x, z: q.y },
      roadOrigin: { x: entry.roadOriginX, y: entry.roadOriginY, z: entry.roadOriginZ },
      halfWidth: entry.halfWidth,
      minDistance: Math.sqrt(bestDistanceSq),
    })
    return null
  }

  const heightSampler = entry.serializedHeightSampler ?? entry.localHeightSampler
  if (!heightSampler) {
    logSurfaceDebug('road-rejected-no-height-sampler', {
      nodeId: entry.nodeId,
      queryWorld: { x: worldX, z: worldZ },
      roadOrigin: { x: entry.roadOriginX, y: entry.roadOriginY, z: entry.roadOriginZ },
    })
    return null
  }
  const localHeight = heightSampler(q.x, q.y)
  if (!Number.isFinite(localHeight)) {
    logSurfaceDebug('road-rejected-nonfinite-height', {
      nodeId: entry.nodeId,
      queryWorld: { x: worldX, z: worldZ },
      queryLocal: { x: q.x, z: q.y },
      roadOrigin: { x: entry.roadOriginX, y: entry.roadOriginY, z: entry.roadOriginZ },
    })
    return null
  }

  const sampleDelta = SURFACE_NORMAL_DELTA
  const left = heightSampler(q.x - sampleDelta, q.y)
  const right = heightSampler(q.x + sampleDelta, q.y)
  const back = heightSampler(q.x, q.y - sampleDelta)
  const front = heightSampler(q.x, q.y + sampleDelta)
  localNormalHelper.set(left - right, sampleDelta * 2, back - front)
  if (localNormalHelper.lengthSq() <= 1e-8) {
    localNormalHelper.set(0, 1, 0)
  } else {
    localNormalHelper.normalize()
  }
  worldNormalHelper.copy(localNormalHelper).applyQuaternion(entry.yawQuaternion).normalize()

  roadSampleWorldHelper.set(q.x, localHeight, q.y).applyQuaternion(entry.yawQuaternion)
  roadSampleWorldHelper.add(new THREE.Vector3(entry.roadOriginX, entry.roadOriginY, entry.roadOriginZ))
  const preferredDelta = typeof preferredHeight === 'number' && Number.isFinite(preferredHeight)
    ? Math.abs(preferredHeight - roadSampleWorldHelper.y)
    : 0

  const result: VehicleSurfaceSample = {
    kind: 'road',
    nodeId: entry.nodeId,
    point: roadSampleWorldHelper.clone(),
    normal: worldNormalHelper.clone(),
    distance: Math.sqrt(bestDistanceSq) + preferredDelta,
  }
  logSurfaceDebug('road-sample', {
    nodeId: entry.nodeId,
    queryWorld: { x: worldX, z: worldZ },
    queryLocal: { x: q.x, z: q.y },
    roadOrigin: { x: entry.roadOriginX, y: entry.roadOriginY, z: entry.roadOriginZ },
    result,
    preferredHeight,
    localHeight,
    segmentDistance: Math.sqrt(bestDistanceSq),
    hasSerializedHeightSampler: Boolean(entry.serializedHeightSampler),
  })
  return result
}

function createFloorSurfaceEntry(node: SceneNode): FloorSurfaceEntry | null {
  const definition = node.dynamicMesh as FloorDynamicMesh
  if (!Array.isArray(definition.vertices) || definition.vertices.length < 3) {
    return null
  }
  const { matrix, inverse, quaternion } = composeNodeWorldMatrix(node)
  const thickness = Math.max(0, readFiniteNumber(definition.thickness, 0))
  return {
    nodeId: node.id,
    definition,
    worldMatrix: matrix,
    inverseWorldMatrix: inverse,
    worldQuaternion: quaternion,
    topHeightLocal: thickness,
  }
}

function sampleFloorSurface(entry: FloorSurfaceEntry, worldX: number, worldZ: number, preferredHeight?: number | null): VehicleSurfaceSample | null {
  localPointHelper.set(worldX, 0, worldZ).applyMatrix4(entry.inverseWorldMatrix)
  if (!isPointInsideRegionXZ({ x: localPointHelper.x, z: localPointHelper.z }, entry.definition.vertices)) {
    return null
  }
  worldPointHelper.set(localPointHelper.x, entry.topHeightLocal, localPointHelper.z).applyMatrix4(entry.worldMatrix)
  worldNormalHelper.set(0, 1, 0).applyQuaternion(entry.worldQuaternion).normalize()
  const preferredDelta = typeof preferredHeight === 'number' && Number.isFinite(preferredHeight)
    ? Math.abs(preferredHeight - worldPointHelper.y)
    : 0
  return {
    kind: 'floor',
    nodeId: entry.nodeId,
    point: worldPointHelper.clone(),
    normal: worldNormalHelper.clone(),
    distance: preferredDelta,
  }
}

function sampleGroundSurface(entry: GroundSurfaceEntry, worldX: number, worldZ: number, preferredHeight?: number | null): VehicleSurfaceSample | null {
  const localX = worldX - entry.origin.x
  const localZ = worldZ - entry.origin.z
  const localHeight = sampleGroundTriangleHeight(entry.definition, localX, localZ)
  if (!Number.isFinite(localHeight)) {
    return null
  }
  const point = new THREE.Vector3(worldX, entry.origin.y + localHeight, worldZ)
  const normal = sampleGroundNormal(entry.definition, localX, localZ, new THREE.Vector3()).normalize()
  const preferredDelta = typeof preferredHeight === 'number' && Number.isFinite(preferredHeight)
    ? Math.abs(preferredHeight - point.y)
    : 0
  return {
    kind: 'ground',
    nodeId: entry.nodeId,
    point,
    normal,
    distance: preferredDelta,
  }
}

export function createVehicleSurfaceSampler(nodes: SceneNode[]): VehicleSurfaceSampler {
  const groundNode = nodes.find((node) => isGroundNode(node)) ?? null
  const groundEntry = groundNode && isGroundNode(groundNode)
    ? {
      nodeId: groundNode.id,
      definition: groundNode.dynamicMesh as GroundRuntimeDynamicMesh,
      origin: readNodePosition(groundNode),
    } satisfies GroundSurfaceEntry
    : null

  const roadEntries = nodes
    .filter((node) => isRoadNode(node))
    .map((node) => createRoadSurfaceEntry(node, groundNode))
    .filter((entry): entry is RoadSurfaceEntry => Boolean(entry))

  const floorEntries = nodes
    .filter((node) => isFloorNode(node))
    .map((node) => createFloorSurfaceEntry(node))
    .filter((entry): entry is FloorSurfaceEntry => Boolean(entry))

  return {
    sampleSurfaceAtWorld(x: number, z: number, preferredHeight?: number | null): VehicleSurfaceSample | null {
      let best: VehicleSurfaceSample | null = null

      for (const roadEntry of roadEntries) {
        const sample = sampleRoadSurface(roadEntry, x, z, preferredHeight)
        if (sample && (!best || sample.distance < best.distance)) {
          best = sample
        }
      }

      for (const floorEntry of floorEntries) {
        const sample = sampleFloorSurface(floorEntry, x, z, preferredHeight)
        if (!sample) {
          continue
        }
        if (!best || best.kind === 'ground' || sample.point.y > best.point.y || sample.distance < best.distance) {
          best = sample
        }
      }

      const groundSample = groundEntry ? sampleGroundSurface(groundEntry, x, z, preferredHeight) : null
      const result = !best
        ? groundSample
        : !groundSample
          ? best
          : best.point.y >= groundSample.point.y
            ? best
            : groundSample
      if (roadEntries.length > 0) {
        logSurfaceDebug('surface-choice', {
          queryWorld: { x, z },
          preferredHeight,
          result: result
            ? {
              kind: result.kind,
              nodeId: result.nodeId,
              point: result.point,
              normal: result.normal,
              distance: result.distance,
            }
            : null,
          roadCandidates: roadEntries.length,
          floorCandidates: floorEntries.length,
          groundCandidate: groundSample
            ? {
              kind: groundSample.kind,
              nodeId: groundSample.nodeId,
              point: groundSample.point,
              normal: groundSample.normal,
              distance: groundSample.distance,
            }
            : null,
        })
      }
      return result
    },
  }
}