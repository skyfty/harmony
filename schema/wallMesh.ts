import * as THREE from 'three'
import type { WallDynamicMesh } from './index'
import {
  createAutoTiledMaterialVariant,
  MATERIAL_CONFIG_ID_KEY,
  MATERIAL_TEXTURE_REPEAT_INFO_KEY,
} from './material'
import { compileWallSegmentsFromDefinition, resolveWallDimensionsFromDefinition, type WallRenderSegment } from './wallLayout'

export type WallRenderAssetObjects = {
  /** Lower wall body model root (instanced along segments). */
  bodyObject?: THREE.Object3D | null
  /** Upper wall head model root (instanced along segments). Only used when bodyObject is present. */
  headObject?: THREE.Object3D | null
  /** Lower wall foot model root (instanced along segments). Only used when bodyObject is present. */
  footObject?: THREE.Object3D | null

  /** Lower wall end-cap model root. Only used when bodyObject is present and wall is not a closed loop. */
  bodyEndCapObject?: THREE.Object3D | null
  /** Upper wall head end-cap model root. Only used when bodyEndCapObject is present and wall is not a closed loop. */
  headEndCapObject?: THREE.Object3D | null
  /** Lower wall foot end-cap model root. Only used when bodyEndCapObject is present and wall is not a closed loop. */
  footEndCapObject?: THREE.Object3D | null
  /**
   * Lower wall body corner/joint models keyed by assetId.
   * Multiple assets are supported so walls can pick different models by angle.
   */
  bodyCornerObjectsByAssetId?: Record<string, THREE.Object3D | null> | null
  /**
   * Upper wall head corner/joint models keyed by assetId.
   * Multiple assets are supported so walls can pick different models by angle.
   */
  headCornerObjectsByAssetId?: Record<string, THREE.Object3D | null> | null
  /**
   * Lower wall foot corner/joint models keyed by assetId.
   * Multiple assets are supported so walls can pick different models by angle.
   */
  footCornerObjectsByAssetId?: Record<string, THREE.Object3D | null> | null
}

export const WALL_ASSET_REPEAT_VARIANT_INFO_KEY = '__harmonyWallAssetRepeatVariantInfo'

export type WallCornerModelRule = {
  bodyAssetId: string | null
  headAssetId: string | null
  footAssetId: string | null
  angle: number
  tolerance: number
  jointTrim: { start: number; end: number }

  /** Local positional offset (meters) applied to the body corner instance, in the model's local frame (Option A). */
  bodyOffsetLocal?: { x: number; y: number; z: number }
  /** Local positional offset (meters) applied to the head corner instance, in the model's local frame (Option A). */
  headOffsetLocal?: { x: number; y: number; z: number }
  /** Local positional offset (meters) applied to the foot corner instance, in the model's local frame (Option A). */
  footOffsetLocal?: { x: number; y: number; z: number }

  // Per-part orientation overrides (Option B).
  bodyForwardAxis: WallForwardAxis
  bodyYawDeg: number
  headForwardAxis: WallForwardAxis
  headYawDeg: number
  footForwardAxis: WallForwardAxis
  footYawDeg: number
}

export type WallOffsetLocal = {
  x: number
  y: number
  z: number
}

export type WallForwardAxis = '+x' | '-x' | '+z' | '-z'

export type WallModelOrientation = {
  forwardAxis: WallForwardAxis
  yawDeg: number
}

export type WallUvAxis = 'auto' | 'u' | 'v'
type WallResolvedUvAxis = 'u' | 'v'
export type WallRenderMode = 'stretch' | 'repeatInstances'

export type WallRenderOptions = {
  materialConfigId?: string | null
  bodyMaterialConfigId?: string | null
  cornerModels?: WallCornerModelRule[]
  wallRenderMode?: WallRenderMode
  repeatInstanceStep?: number

  // Optional explicit vertical-layout overrides used by procedural body fallback.
  headAssetHeight?: number
  footAssetHeight?: number

  // Per-part UV repeat axis for stretched wall tiling.
  bodyUvAxis?: WallUvAxis
  headUvAxis?: WallUvAxis
  footUvAxis?: WallUvAxis

  // Part orientations.
  bodyOrientation?: WallModelOrientation
  headOrientation?: WallModelOrientation
  footOrientation?: WallModelOrientation
  bodyEndCapOffsetLocal?: WallOffsetLocal
  bodyEndCapOrientation?: WallModelOrientation
  headEndCapOffsetLocal?: WallOffsetLocal
  headEndCapOrientation?: WallModelOrientation
  footEndCapOffsetLocal?: WallOffsetLocal
  footEndCapOrientation?: WallModelOrientation
}

function normalizeWallMaterialConfigId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.length ? raw : null
}

function applyWallMeshMaterialConfigId(meshes: THREE.Mesh[], materialConfigId: string | null): void {
  meshes.forEach((mesh) => {
    mesh.userData[MATERIAL_CONFIG_ID_KEY] = materialConfigId
  })
}

const WALL_DEFAULT_COLOR = 0xcfd2d6
const WALL_MIN_HEIGHT = 0.5
const WALL_MIN_WIDTH = 0.1
const WALL_DEFAULT_HEIGHT = 3
// (WALL_DEFAULT_WIDTH removed: unused after refactor)
const WALL_EPSILON = 1e-6

const WALL_INSTANCING_MIN_TILE_LENGTH = 1e-4
const WALL_REPEAT_INSTANCE_STEP_M_DEFAULT = 0.5
const WALL_INSTANCING_DIR_EPSILON = 1e-6
const WALL_INSTANCING_JOINT_ANGLE_EPSILON = 1e-3
const WALL_SKIP_GEOMETRY_DISPOSE_USERDATA_KEY = '__harmonySkipGeometryDispose'
const WALL_SKIP_MATERIAL_DISPOSE_USERDATA_KEY = '__harmonySkipMaterialDispose'
const WALL_OWNED_TEXTURES_USERDATA_KEY = '__harmonyOwnedTextures'

/** Local alias so all helpers below use the same segment type. */
type WallRenderSeg = WallRenderSegment

type WallForwardAxisInfo = { axis: 'x' | 'z'; sign: 1 | -1 }

type WallVerticalLayout = {
  bodyBaseY: number
  bodyHeight: number
  headBaseY: number
  footBaseY: number
}

type WallVerticalLayoutOptions = {
  headAssetHeight?: number
  footAssetHeight?: number
}

function resolveWallVerticalLayout(totalHeightRaw: number, options: WallVerticalLayoutOptions = {}): WallVerticalLayout {
  const totalHeight = Math.max(0, Number.isFinite(totalHeightRaw) ? totalHeightRaw : WALL_DEFAULT_HEIGHT)
  const headAssetHeight = Math.max(0, Number.isFinite(options.headAssetHeight) ? (options.headAssetHeight as number) : 0)
  const footAssetHeight = Math.max(0, Number.isFinite(options.footAssetHeight) ? (options.footAssetHeight as number) : 0)
  const bodyHeight = Math.max(0, totalHeight - headAssetHeight - footAssetHeight)
  return {
    bodyBaseY: 0,
    bodyHeight,
    headBaseY: totalHeight - headAssetHeight,
    footBaseY: 0,
  }
}

function requireWallForwardAxis(value: unknown, label: string): WallForwardAxis {
  if (value === '+x' || value === '-x' || value === '+z' || value === '-z') {
    return value
  }
  throw new Error(`Wall: invalid ${label}`)
}

function normalizeWallYawDeg(value: unknown, label: string): number {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) {
    throw new Error(`Wall: invalid ${label}`)
  }
  return THREE.MathUtils.clamp(raw, -180, 180)
}

function requireWallOrientation(value: unknown, label: string): WallModelOrientation {
  const obj = value as { forwardAxis?: unknown; yawDeg?: unknown } | null
  if (!obj || typeof obj !== 'object') {
    throw new Error(`Wall: missing ${label}`)
  }
  return {
    forwardAxis: requireWallForwardAxis(obj.forwardAxis, `${label}.forwardAxis`),
    yawDeg: normalizeWallYawDeg(obj.yawDeg, `${label}.yawDeg`),
  }
}

function wallForwardAxisInfo(forwardAxis: WallForwardAxis): WallForwardAxisInfo {
  switch (forwardAxis) {
    case '+x':
      return { axis: 'x', sign: 1 }
    case '-x':
      return { axis: 'x', sign: -1 }
    case '+z':
      return { axis: 'z', sign: 1 }
    case '-z':
      return { axis: 'z', sign: -1 }
  }
}

function writeWallLocalForward(out: THREE.Vector3, forwardAxis: WallForwardAxis): THREE.Vector3 {
  switch (forwardAxis) {
    case '+x':
      return out.set(1, 0, 0)
    case '-x':
      return out.set(-1, 0, 0)
    case '+z':
      return out.set(0, 0, 1)
    case '-z':
      return out.set(0, 0, -1)
  }
}

function resolveWallTemplateAlongAxis(template: InstancedAssetTemplate, forwardAxis: WallForwardAxis): {
  tileLengthLocal: number
  minAlongAxis: number
  maxAlongAxis: number
} {
  const info = wallForwardAxisInfo(forwardAxis)
  const axis = info.axis

  const minRaw = template.bounds.min[axis]
  const maxRaw = template.bounds.max[axis]
  const lengthAbs = Math.abs(maxRaw - minRaw)
  const tileLengthLocal = Math.max(WALL_INSTANCING_MIN_TILE_LENGTH, lengthAbs)

  // Along coordinate is dot(localForward, localPos). With axis-aligned forward,
  // this becomes either +axis or -axis.
  const minAlongAxis = info.sign === 1 ? minRaw : -maxRaw
  const maxAlongAxis = info.sign === 1 ? maxRaw : -minRaw

  return { tileLengthLocal, minAlongAxis, maxAlongAxis }
}

function wallDistanceSqXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

function wallSegmentLengthXZ(segment: WallRenderSeg): number {
  const dx = Number((segment as any).end?.x) - Number((segment as any).start?.x)
  const dz = Number((segment as any).end?.z) - Number((segment as any).start?.z)
  const len = Math.sqrt(dx * dx + dz * dz)
  return Number.isFinite(len) ? len : 0
}

type WallVisualChain = {
  segs: WallRenderSeg[]
  closed: boolean
}

type WallArcInterval = {
  chainIndex: number
  start: number
  end: number
}

function buildWallVisualChainsFromSegs(renderSegs: WallRenderSeg[]): WallVisualChain[] {
  if (!renderSegs.length) return []

  const result: WallVisualChain[] = []
  let current: WallRenderSeg[] = []

  for (const seg of renderSegs) {
    const len = wallSegmentLengthXZ(seg)
    if (len <= WALL_EPSILON) continue

    const prev = current[current.length - 1]
    if (prev && wallDistanceSqXZ(prev.end as any, seg.start as any) > WALL_EPSILON) {
      if (current.length) {
        const first = current[0]!
        const last = current[current.length - 1]!
        const closedDist = wallDistanceSqXZ(first.start as any, last.end as any)
        result.push({ segs: current, closed: closedDist <= WALL_EPSILON })
      }
      current = []
    }
    current.push(seg)
  }

  if (current.length) {
    const first = current[0]!
    const last = current[current.length - 1]!
    const closedDist = wallDistanceSqXZ(first.start as any, last.end as any)
    result.push({ segs: current, closed: closedDist <= WALL_EPSILON })
  }

  return result
}

function buildWallChainDefinitions(definition: WallDynamicMesh): WallVisualChain[] {
  const renderSegs = compileWallSegmentsFromDefinition(definition)
  return buildWallVisualChainsFromSegs(renderSegs)
}

function mergeWallArcIntervals(intervals: WallArcInterval[]): WallArcInterval[] {
  const byChain = new Map<number, WallArcInterval[]>()
  intervals.forEach((interval) => {
    const chainIndex = Math.max(0, Math.trunc(Number(interval.chainIndex ?? 0)))
    const start = Number(interval.start)
    const end = Number(interval.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= WALL_EPSILON) {
      return
    }
    const bucket = byChain.get(chainIndex) ?? []
    if (!byChain.has(chainIndex)) {
      byChain.set(chainIndex, bucket)
    }
    bucket.push({ chainIndex, start: Math.min(start, end), end: Math.max(start, end) })
  })

  const merged: WallArcInterval[] = []
  byChain.forEach((bucket, chainIndex) => {
    bucket.sort((a, b) => a.start - b.start)
    let current: WallArcInterval | null = null
    bucket.forEach((entry) => {
      if (!current) {
        current = { ...entry, chainIndex }
        return
      }
      if (entry.start <= current.end + WALL_EPSILON) {
        current.end = Math.max(current.end, entry.end)
      } else {
        merged.push(current)
        current = { ...entry, chainIndex }
      }
    })
    if (current) {
      merged.push(current)
    }
  })

  return merged
}

function clipWallSegmentToArcInterval(
  seg: WallRenderSeg,
  clipStart: number,
  clipEnd: number,
): WallRenderSeg | null {
  const baseArcStart = Number(seg.chainArcStart ?? 0)
  const dx = Number(seg.end.x) - Number(seg.start.x)
  const dy = Number(seg.end.y) - Number(seg.start.y)
  const dz = Number(seg.end.z) - Number(seg.start.z)
  const len = Math.sqrt(dx * dx + dz * dz)
  if (!Number.isFinite(len) || len <= WALL_EPSILON) {
    return null
  }

  const segArcEnd = baseArcStart + len
  const startArc = Math.max(baseArcStart, Math.min(segArcEnd, clipStart))
  const endArc = Math.max(baseArcStart, Math.min(segArcEnd, clipEnd))
  if (endArc - startArc <= WALL_EPSILON) {
    return null
  }

  const t0 = (startArc - baseArcStart) / len
  const t1 = (endArc - baseArcStart) / len
  const lerpPoint = (t: number) => ({
    x: Number(seg.start.x) + dx * t,
    y: Number(seg.start.y) + dy * t,
    z: Number(seg.start.z) + dz * t,
  })

  return {
    ...seg,
    start: lerpPoint(t0),
    end: lerpPoint(t1),
    chainArcStart: startArc,
  }
}

function subtractWallArcIntervalsFromSegs(
  segs: WallRenderSeg[],
  intervals: WallArcInterval[],
): WallRenderSeg[] {
  if (!segs.length || !intervals.length) {
    return segs.slice()
  }

  const byChain = new Map<number, WallArcInterval[]>()
  intervals.forEach((interval) => {
    const chainIndex = Math.max(0, Math.trunc(Number(interval.chainIndex ?? 0)))
    const bucket = byChain.get(chainIndex) ?? []
    if (!byChain.has(chainIndex)) {
      byChain.set(chainIndex, bucket)
    }
    bucket.push(interval)
  })

  const result: WallRenderSeg[] = []
  segs.forEach((seg) => {
    const chainIndex = Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0)))
    const chainIntervals = byChain.get(chainIndex)
    if (!chainIntervals?.length) {
      result.push(seg)
      return
    }

    const baseArcStart = Number(seg.chainArcStart ?? 0)
    const dx = Number(seg.end.x) - Number(seg.start.x)
    const dz = Number(seg.end.z) - Number(seg.start.z)
    const len = Math.sqrt(dx * dx + dz * dz)
    if (!Number.isFinite(len) || len <= WALL_EPSILON) {
      return
    }
    const segArcEnd = baseArcStart + len
    let cursor = baseArcStart
    chainIntervals.forEach((interval) => {
      if (interval.end <= cursor + WALL_EPSILON || interval.start >= segArcEnd - WALL_EPSILON) {
        return
      }
      const visibleEnd = Math.min(segArcEnd, interval.start)
      if (visibleEnd - cursor > WALL_EPSILON) {
        const clipped = clipWallSegmentToArcInterval(seg, cursor, visibleEnd)
        if (clipped) {
          result.push(clipped)
        }
      }
      cursor = Math.max(cursor, Math.min(segArcEnd, interval.end))
    })

    if (segArcEnd - cursor > WALL_EPSILON) {
      const clipped = clipWallSegmentToArcInterval(seg, cursor, segArcEnd)
      if (clipped) {
        result.push(clipped)
      }
    }
  })

  return result
}

function cross2dXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return a.x * b.z - a.z * b.x
}

function intersectWallLinesXZ(
  pointA: { x: number; z: number },
  dirA: { x: number; z: number },
  pointB: { x: number; z: number },
  dirB: { x: number; z: number },
  out: THREE.Vector3,
): boolean {
  const denom = cross2dXZ(dirA, dirB)
  if (Math.abs(denom) <= WALL_EPSILON) {
    return false
  }
  const deltaX = pointB.x - pointA.x
  const deltaZ = pointB.z - pointA.z
  const t = (deltaX * dirB.z - deltaZ * dirB.x) / denom
  out.set(pointA.x + dirA.x * t, 0, pointA.z + dirA.z * t)
  return Number.isFinite(out.x) && Number.isFinite(out.z)
}

function computeWallJoinOffsetPoint(
  vertex: { x: number; y: number; z: number },
  prevDir: THREE.Vector3 | null,
  nextDir: THREE.Vector3 | null,
  halfWidth: number,
  sideSign: 1 | -1,
  fallbackDir: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  const directionA = prevDir && prevDir.lengthSq() > WALL_EPSILON ? prevDir : fallbackDir
  const directionB = nextDir && nextDir.lengthSq() > WALL_EPSILON ? nextDir : fallbackDir

  const normalA = new THREE.Vector3(-directionA.z * sideSign, 0, directionA.x * sideSign)
  const normalB = new THREE.Vector3(-directionB.z * sideSign, 0, directionB.x * sideSign)
  const pointA = new THREE.Vector3(vertex.x + normalA.x * halfWidth, 0, vertex.z + normalA.z * halfWidth)
  const pointB = new THREE.Vector3(vertex.x + normalB.x * halfWidth, 0, vertex.z + normalB.z * halfWidth)

  if (intersectWallLinesXZ(pointA, directionA, pointB, directionB, out)) {
    const dx = out.x - vertex.x
    const dz = out.z - vertex.z
    const maxMiter = halfWidth * 4
    if (dx * dx + dz * dz <= maxMiter * maxMiter) {
      out.y = vertex.y
      return out
    }
  }

  out.set(vertex.x + (-fallbackDir.z * sideSign) * halfWidth, vertex.y, vertex.z + (fallbackDir.x * sideSign) * halfWidth)
  return out
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }

    const userData = (mesh.userData ?? {}) as Record<string, unknown>
    if (mesh.geometry && !userData[WALL_SKIP_GEOMETRY_DISPOSE_USERDATA_KEY]) {
      mesh.geometry.dispose()
    }
    const ownedTextures = userData[WALL_OWNED_TEXTURES_USERDATA_KEY]
    if (Array.isArray(ownedTextures)) {
      ownedTextures.forEach((entry) => {
        if ((entry as THREE.Texture | null | undefined)?.isTexture) {
          ;(entry as THREE.Texture).dispose()
        }
      })
    }

    if (userData[WALL_SKIP_MATERIAL_DISPOSE_USERDATA_KEY]) {
      return
    }

    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose())
    } else if (material) {
      material.dispose()
    }
  })
}

function clearGroupContent(group: THREE.Group) {
  while (group.children.length) {
    const child = group.children[group.children.length - 1]
    if (!child) {
      break
    }
    group.remove(child)
    disposeObject3D(child)
  }
}

type InstancedAssetTemplate = {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  /** Transform from template mesh local space into the asset root local space. */
  meshToRoot: THREE.Matrix4
  /** AABB of template geometry after meshToRoot (in root local space). */
  bounds: THREE.Box3
  baseSize: THREE.Vector3
}

const wallInstancedBoundsPoint = new THREE.Vector3()
const wallInstancedBoundsCorners = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
] as [
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
]

function expandBoxByTransformedBounds(target: THREE.Box3, bounds: THREE.Box3, matrix: THREE.Matrix4): void {
  if (bounds.isEmpty()) {
    return
  }

  const { min, max } = bounds
  wallInstancedBoundsCorners[0].set(min.x, min.y, min.z)
  wallInstancedBoundsCorners[1].set(min.x, min.y, max.z)
  wallInstancedBoundsCorners[2].set(min.x, max.y, min.z)
  wallInstancedBoundsCorners[3].set(min.x, max.y, max.z)
  wallInstancedBoundsCorners[4].set(max.x, min.y, min.z)
  wallInstancedBoundsCorners[5].set(max.x, min.y, max.z)
  wallInstancedBoundsCorners[6].set(max.x, max.y, min.z)
  wallInstancedBoundsCorners[7].set(max.x, max.y, max.z)

  for (const corner of wallInstancedBoundsCorners) {
    wallInstancedBoundsPoint.copy(corner).applyMatrix4(matrix)
    target.expandByPoint(wallInstancedBoundsPoint)
  }
}

function computeWallAssetBounds(
  templateBounds: THREE.Box3,
  matrices: THREE.Matrix4[],
): THREE.Box3 | null {
  if (templateBounds.isEmpty() || !matrices.length) {
    return null
  }

  const combinedBounds = new THREE.Box3()
  combinedBounds.makeEmpty()
  for (const matrix of matrices) {
    expandBoxByTransformedBounds(combinedBounds, templateBounds, matrix)
  }
  if (combinedBounds.isEmpty()) {
    return null
  }
  return combinedBounds
}

function serializeBounds(bounds: THREE.Box3 | null): { min: [number, number, number]; max: [number, number, number] } | null {
  if (!bounds || bounds.isEmpty()) {
    return null
  }
  return {
    min: [bounds.min.x, bounds.min.y, bounds.min.z],
    max: [bounds.max.x, bounds.max.y, bounds.max.z],
  }
}

function findFirstInstancableMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((child) => {
    if (found) {
      return
    }
    const candidate = child as unknown as THREE.Mesh
    if (!candidate || !(candidate as any).isMesh) {
      return
    }
    // Skinned meshes are not safe to instance.
    if ((candidate as any).isSkinnedMesh) {
      return
    }
    const geometry = (candidate as any).geometry as THREE.BufferGeometry | undefined
    if (!geometry || !(geometry as any).isBufferGeometry) {
      return
    }
    const material = (candidate as any).material as THREE.Material | THREE.Material[] | undefined
    if (!material) {
      return
    }
    if (Array.isArray(material) && material.length === 0) {
      return
    }
    found = candidate
  })
  return found
}

function extractInstancedAssetTemplate(root: THREE.Object3D): InstancedAssetTemplate | null {
  root.updateMatrixWorld(true)
  const mesh = findFirstInstancableMesh(root)
  if (!mesh) {
    return null
  }

  const geometry = mesh.geometry as THREE.BufferGeometry
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }
  if (!geometry.boundingBox) {
    return null
  }

  const material = mesh.material as THREE.Material | THREE.Material[]
  const rootWorldInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const meshToRoot = new THREE.Matrix4().multiplyMatrices(rootWorldInv, mesh.matrixWorld)

  const bounds = geometry.boundingBox.clone().applyMatrix4(meshToRoot)
  const baseSize = bounds.getSize(new THREE.Vector3())
  return { geometry, material, meshToRoot, bounds, baseSize }
}

function resolveWallBodyHeight(segment: WallRenderSeg | null | undefined): number {
  const raw = (segment as any)?.height
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) {
    return WALL_DEFAULT_HEIGHT
  }
  return Math.max(WALL_MIN_HEIGHT, value)
}

function sanitizeWallRepeatScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function normalizeWallRenderMode(value: unknown): WallRenderMode {
  return value === 'repeatInstances' ? 'repeatInstances' : 'stretch'
}

function normalizeWallRepeatInstanceStep(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) {
    return WALL_REPEAT_INSTANCE_STEP_M_DEFAULT
  }
  return Math.max(WALL_INSTANCING_MIN_TILE_LENGTH, raw)
}


type WallRepeatedMaterialSet = {
  material: THREE.Material | THREE.Material[]
  ownedTextures: THREE.Texture[]
  shared: boolean
}

type WallMaterialVariantCacheEntry = WallRepeatedMaterialSet & {
  ownerClaimed: boolean
}

type WallMaterialVariantCache = Map<string, WallMaterialVariantCacheEntry>

const wallMaterialIdentityIds = new WeakMap<THREE.Material, number>()
let wallMaterialIdentityCounter = 1

function getWallMaterialIdentityId(material: THREE.Material): number {
  const cached = wallMaterialIdentityIds.get(material)
  if (cached) {
    return cached
  }
  const next = wallMaterialIdentityCounter
  wallMaterialIdentityCounter += 1
  wallMaterialIdentityIds.set(material, next)
  return next
}

function buildWallMaterialVariantCacheKey(
  original: THREE.Material | THREE.Material[],
  repeatKey: string,
): string {
  const materialKey = Array.isArray(original)
    ? original.map((entry) => `${getWallMaterialIdentityId(entry)}`).join(',')
    : `${getWallMaterialIdentityId(original)}`
  return `${repeatKey}|${materialKey}`
}

function getOrCreateWallAutoTiledMaterialSet(
  cache: WallMaterialVariantCache,
  original: THREE.Material | THREE.Material[],
  repeatInfo: {
    uvMetersPerUnit: { x: number; y: number }
    repeatScale?: { x: number; y: number }
  } | null,
): WallRepeatedMaterialSet & { owner: boolean } {
  if (!repeatInfo) {
    return { material: original, ownedTextures: [], shared: true, owner: false }
  }

  const cacheKey = buildWallMaterialVariantCacheKey(original, JSON.stringify(repeatInfo))
  let cached = cache.get(cacheKey)
  if (!cached) {
    const variant = createAutoTiledMaterialVariant(original, repeatInfo)
    cached = {
      material: variant.material,
      ownedTextures: variant.ownedTextures,
      shared: variant.shared,
      ownerClaimed: false,
    }
    cache.set(cacheKey, cached)
  }

  if (cached.shared) {
    return { material: cached.material, ownedTextures: [], shared: true, owner: false }
  }

  if (!cached.ownerClaimed) {
    cached.ownerClaimed = true
    return {
      material: cached.material,
      ownedTextures: cached.ownedTextures,
      shared: false,
      owner: true,
    }
  }

  return {
    material: cached.material,
    ownedTextures: [],
    shared: false,
    owner: false,
  }
}

type StretchedWallInstance = {
  matrix: THREE.Matrix4
  repeatScaleU: number
  repeatScaleV: number
  chainIndex: number
  chainArcStart: number
  chainArcEnd: number
  repeatSlotIndex: number
}

/**
 * Build stretched transforms for each render segment in `segs`.
 * UV tiling repeat scale is returned per instance and later bucketed into material-level repeats.
 */
function buildStretchedWallInstancesForSegs(
  segs: WallRenderSeg[],
  template: InstancedAssetTemplate,
  mode: 'body' | 'head' | 'foot',
  orientation: WallModelOrientation,
  verticalLayoutOptions: WallVerticalLayoutOptions,
  rules: WallCornerModelRule[] = [],
): StretchedWallInstance[] {
  const instances: StretchedWallInstance[] = []
  const trims = computeWallSegmentJointTrimForChain(segs, rules, mode)
  const repeatSlotByChain = new Map<number, number>()

  const localForward = writeWallLocalForward(new THREE.Vector3(), orientation.forwardAxis)
  const { tileLengthLocal, minAlongAxis } = resolveWallTemplateAlongAxis(template, orientation.forwardAxis)
  const templateHeight = Math.max(WALL_EPSILON, Math.abs(template.baseSize.y))
  const templateMinY = template.bounds.min.y
  const info = wallForwardAxisInfo(orientation.forwardAxis)

  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const unitDir = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const yawQuat = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)
  const offset = new THREE.Vector3()
  const pos = new THREE.Vector3()
  const localMatrix = new THREE.Matrix4()

  for (let segmentIndex = 0; segmentIndex < segs.length; segmentIndex += 1) {
    const seg = segs[segmentIndex]!
    const trim = trims[segmentIndex] ?? { start: 0, end: 0 }
    start.set(seg.start.x, seg.start.y, seg.start.z)
    end.set(seg.end.x, seg.end.y, seg.end.z)
    dir.subVectors(end, start)
    dir.y = 0
    const length = dir.length()
    if (length <= WALL_INSTANCING_DIR_EPSILON) continue

    const trimStart = Math.max(0, trim.start)
    const trimEnd = Math.max(0, trim.end)
    const trimmedLength = Math.max(0, length - trimStart - trimEnd)
    if (trimmedLength <= WALL_INSTANCING_DIR_EPSILON) continue

    const segmentTotalHeight = resolveWallBodyHeight(seg)
    const layout = resolveWallVerticalLayout(segmentTotalHeight, verticalLayoutOptions)
    if (mode === 'body' && layout.bodyHeight <= WALL_EPSILON) {
      continue
    }
    const scaleY = mode === 'body' ? layout.bodyHeight / templateHeight : 1
    // Stretch factor along the template's forward axis.
    const stretchFactor = trimmedLength / Math.max(WALL_INSTANCING_MIN_TILE_LENGTH, tileLengthLocal)

    unitDir.copy(dir).multiplyScalar(1 / length)
    if (trimStart > WALL_EPSILON) {
      start.addScaledVector(unitDir, trimStart)
    }
    quat.setFromUnitVectors(localForward, unitDir)
    if (orientation.yawDeg) {
      yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(orientation.yawDeg))
      quat.multiply(yawQuat)
    }

    // Apply stretch + Y scale via mesh scale matrix.
    // Scale is in model local space along the forward axis.
    scale.set(
      info.axis === 'x' ? stretchFactor : 1,
      scaleY,
      info.axis === 'z' ? stretchFactor : 1,
    )

    // Y anchor (same logic as the original instancing code).
    let anchoredY: number
    if (mode === 'body') {
      anchoredY = start.y + layout.bodyBaseY - scaleY * templateMinY
    } else if (mode === 'head') {
      anchoredY = start.y + layout.headBaseY - templateMinY
    } else {
      anchoredY = start.y + layout.footBaseY - templateMinY
    }

    // Position: place mesh so its min-face in the forward axis aligns with `start`.
    // After scale the stretched min-face local coord = minAlongAxis * stretchFactor.
    // The world offset from origin to that face = quat.apply(localForward * minAlongAxis * stretchFactor)
    // = unitDir * minAlongAxis * stretchFactor (because we rotated localForward → unitDir).
    offset.copy(unitDir).multiplyScalar(minAlongAxis * stretchFactor)
    pos.copy(start)
    pos.y = anchoredY
    pos.sub(offset)

    localMatrix.compose(pos, quat, scale)
    localMatrix.multiply(template.meshToRoot)

    instances.push({
      matrix: new THREE.Matrix4().copy(localMatrix),
      repeatScaleU: sanitizeWallRepeatScale(stretchFactor),
      repeatScaleV: sanitizeWallRepeatScale(scaleY),
      chainIndex: Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0))),
      chainArcStart: Number(seg.chainArcStart ?? 0) + trimStart,
      chainArcEnd: Number(seg.chainArcStart ?? 0) + trimStart + trimmedLength,
      repeatSlotIndex: (() => {
        const chainIndex = Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0)))
        const next = (repeatSlotByChain.get(chainIndex) ?? 0) + 1
        repeatSlotByChain.set(chainIndex, next)
        return next - 1
      })(),
    })
  }
  return instances
}

function buildRepeatedWallInstancesForSegs(
  segs: WallRenderSeg[],
  template: InstancedAssetTemplate,
  mode: 'body' | 'head' | 'foot',
  orientation: WallModelOrientation,
  verticalLayoutOptions: WallVerticalLayoutOptions,
  repeatInstanceStep: number,
  erasedSlotSet: Set<string>,
  rules: WallCornerModelRule[] = [],
): StretchedWallInstance[] {
  const instances: StretchedWallInstance[] = []
  const trims = computeWallSegmentJointTrimForChain(segs, rules, mode)
  const repeatSlotByChain = new Map<number, number>()

  const localForward = writeWallLocalForward(new THREE.Vector3(), orientation.forwardAxis)
  const { tileLengthLocal, minAlongAxis } = resolveWallTemplateAlongAxis(template, orientation.forwardAxis)
  const templateHeight = Math.max(WALL_EPSILON, Math.abs(template.baseSize.y))
  const templateMinY = template.bounds.min.y

  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const unitDir = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const yawQuat = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)
  const offset = new THREE.Vector3()
  const pos = new THREE.Vector3()
  const localMatrix = new THREE.Matrix4()

  for (let segmentIndex = 0; segmentIndex < segs.length; segmentIndex += 1) {
    const seg = segs[segmentIndex]!
    const trim = trims[segmentIndex] ?? { start: 0, end: 0 }
    start.set(seg.start.x, seg.start.y, seg.start.z)
    end.set(seg.end.x, seg.end.y, seg.end.z)
    dir.subVectors(end, start)
    dir.y = 0
    const length = dir.length()
    if (length <= WALL_INSTANCING_DIR_EPSILON) continue

    const trimStart = Math.max(0, trim.start)
    const trimEnd = Math.max(0, trim.end)
    const trimmedLength = Math.max(0, length - trimStart - trimEnd)
    if (trimmedLength <= WALL_INSTANCING_DIR_EPSILON) continue

    const segmentTotalHeight = resolveWallBodyHeight(seg)
    const layout = resolveWallVerticalLayout(segmentTotalHeight, verticalLayoutOptions)
    if (mode === 'body' && layout.bodyHeight <= WALL_EPSILON) {
      continue
    }
    const scaleY = mode === 'body' ? layout.bodyHeight / templateHeight : 1

    unitDir.copy(dir).multiplyScalar(1 / length)
    if (trimStart > WALL_EPSILON) {
      start.addScaledVector(unitDir, trimStart)
    }

    quat.setFromUnitVectors(localForward, unitDir)
    if (orientation.yawDeg) {
      yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(orientation.yawDeg))
      quat.multiply(yawQuat)
    }

    scale.set(1, scaleY, 1)

    let anchoredY: number
    if (mode === 'body') {
      anchoredY = start.y + layout.bodyBaseY - scaleY * templateMinY
    } else if (mode === 'head') {
      anchoredY = start.y + layout.headBaseY - templateMinY
    } else {
      anchoredY = start.y + layout.footBaseY - templateMinY
    }

    const maxLocalStart = trimmedLength - tileLengthLocal
    if (maxLocalStart < -WALL_EPSILON) {
      continue
    }

    for (
      let localStart = 0;
      localStart <= maxLocalStart + WALL_EPSILON;
      localStart += repeatInstanceStep
    ) {
      const snappedLocalStart = Math.max(0, Math.min(maxLocalStart, localStart))
      offset.copy(unitDir).multiplyScalar(minAlongAxis)
      pos.copy(start).addScaledVector(unitDir, snappedLocalStart)
      pos.y = anchoredY
      pos.sub(offset)

      localMatrix.compose(pos, quat, scale)
      localMatrix.multiply(template.meshToRoot)

      const chainIndex = Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0)))
      const repeatSlotIndex = (() => {
        const next = (repeatSlotByChain.get(chainIndex) ?? 0) + 1
        repeatSlotByChain.set(chainIndex, next)
        return next - 1
      })()
      const erasedKey = `${chainIndex}:${repeatSlotIndex}`
      if (erasedSlotSet.has(erasedKey)) {
        continue
      }

      instances.push({
        matrix: new THREE.Matrix4().copy(localMatrix),
        repeatScaleU: 1,
        repeatScaleV: sanitizeWallRepeatScale(scaleY),
        chainIndex,
        chainArcStart: Number(seg.chainArcStart ?? 0) + trimStart + snappedLocalStart,
        chainArcEnd: Number(seg.chainArcStart ?? 0) + trimStart + snappedLocalStart + tileLengthLocal,
        repeatSlotIndex,
      })
    }
  }

  return instances
}

function buildRepeatedWallArcIntervalsForSegs(
  segs: WallRenderSeg[],
  mode: 'body' | 'head' | 'foot',
  tileLengthLocal: number,
  verticalLayoutOptions: WallVerticalLayoutOptions,
  repeatInstanceStep: number,
  erasedSlotSet: Set<string>,
  rules: WallCornerModelRule[] = [],
): WallArcInterval[] {
  if (!segs.length || !erasedSlotSet.size) {
    return []
  }

  const intervals: WallArcInterval[] = []
  const trims = computeWallSegmentJointTrimForChain(segs, rules, mode)
  const repeatSlotByChain = new Map<number, number>()
  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const dir = new THREE.Vector3()

  for (let segmentIndex = 0; segmentIndex < segs.length; segmentIndex += 1) {
    const seg = segs[segmentIndex]!
    const trim = trims[segmentIndex] ?? { start: 0, end: 0 }
    start.set(seg.start.x, seg.start.y, seg.start.z)
    end.set(seg.end.x, seg.end.y, seg.end.z)
    dir.subVectors(end, start)
    dir.y = 0
    const length = dir.length()
    if (length <= WALL_INSTANCING_DIR_EPSILON) continue

    const trimStart = Math.max(0, trim.start)
    const trimEnd = Math.max(0, trim.end)
    const trimmedLength = Math.max(0, length - trimStart - trimEnd)
    if (trimmedLength <= WALL_INSTANCING_DIR_EPSILON) continue

    const segmentTotalHeight = resolveWallBodyHeight(seg)
    const layout = resolveWallVerticalLayout(segmentTotalHeight, verticalLayoutOptions)
    if (mode === 'body' && layout.bodyHeight <= WALL_EPSILON) {
      continue
    }

    const maxLocalStart = trimmedLength - tileLengthLocal
    if (maxLocalStart < -WALL_EPSILON) {
      continue
    }

    const chainIndex = Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0)))
    for (
      let localStart = 0;
      localStart <= maxLocalStart + WALL_EPSILON;
      localStart += repeatInstanceStep
    ) {
      const snappedLocalStart = Math.max(0, Math.min(maxLocalStart, localStart))
      const repeatSlotIndex = (() => {
        const next = (repeatSlotByChain.get(chainIndex) ?? 0) + 1
        repeatSlotByChain.set(chainIndex, next)
        return next - 1
      })()
      const erasedKey = `${chainIndex}:${repeatSlotIndex}`
      if (!erasedSlotSet.has(erasedKey)) {
        continue
      }

      intervals.push({
        chainIndex,
        start: Number(seg.chainArcStart ?? 0) + trimStart + snappedLocalStart,
        end: Number(seg.chainArcStart ?? 0) + trimStart + snappedLocalStart + tileLengthLocal,
      })
    }
  }

  return intervals
}

function applyWallShadowSide(
  material: THREE.Material | THREE.Material[],
  shadowSide: THREE.Side = THREE.FrontSide,
): THREE.Material | THREE.Material[] {
  const applyOne = (entry: THREE.Material) => {
    const typed = entry as THREE.Material & { shadowSide?: THREE.Side }
    typed.shadowSide = shadowSide
  }

  if (Array.isArray(material)) {
    material.forEach((entry) => applyOne(entry))
    return material
  }

  applyOne(material)
  return material
}

function createWallAssetMesh(
  name: string,
  template: InstancedAssetTemplate,
  matrix: THREE.Matrix4,
  material: THREE.Material | THREE.Material[],
  options: {
    skipMaterialDispose?: boolean
    ownedTextures?: THREE.Texture[]
    shadowSide?: THREE.Side
    repeatInfo?: {
      uvMetersPerUnit: { x: number; y: number }
      repeatScale?: { x: number; y: number }
    }
    repeatVariantInfo?: {
      repeatScaleU: number
      repeatScaleV: number
      uvAxis: WallResolvedUvAxis
    }
  } = {},
): THREE.Mesh {
  const resolvedMaterial = applyWallShadowSide(material, options.shadowSide)
  const mesh = new THREE.Mesh(template.geometry, resolvedMaterial)
  mesh.name = name
  mesh.userData.dynamicMeshType = 'WallAsset'
  mesh.userData[WALL_SKIP_GEOMETRY_DISPOSE_USERDATA_KEY] = true
  if (options.skipMaterialDispose) {
    mesh.userData[WALL_SKIP_MATERIAL_DISPOSE_USERDATA_KEY] = true
  }
  if (options.ownedTextures?.length) {
    mesh.userData[WALL_OWNED_TEXTURES_USERDATA_KEY] = options.ownedTextures
  }
  if (options.repeatInfo) {
    mesh.userData[MATERIAL_TEXTURE_REPEAT_INFO_KEY] = options.repeatInfo
  }
  if (options.repeatVariantInfo) {
    mesh.userData[WALL_ASSET_REPEAT_VARIANT_INFO_KEY] = options.repeatVariantInfo
  }
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  matrix.decompose(mesh.position, mesh.quaternion, mesh.scale)
  mesh.updateMatrix()
  mesh.updateMatrixWorld(false)
  return mesh
}

function createWallRepeatedAssetMeshes(
  namePrefix: string,
  template: InstancedAssetTemplate,
  instances: StretchedWallInstance[],
  materialVariantCache: WallMaterialVariantCache,
  orientation: WallModelOrientation,
  uvAxis: WallResolvedUvAxis = 'u',
  shadowSide: THREE.Side = THREE.FrontSide,
): { meshes: THREE.Mesh[]; bounds: THREE.Box3 | null } {
  if (!instances.length) {
    return { meshes: [], bounds: null }
  }

  const { tileLengthLocal } = resolveWallTemplateAlongAxis(template, orientation.forwardAxis)
  const templateHeight = Math.max(WALL_EPSILON, Math.abs(template.baseSize.y))

  const meshes = instances.map((instance, index) => {
    const repeatInfo = uvAxis === 'v'
      ? {
          uvMetersPerUnit: { x: templateHeight, y: tileLengthLocal },
          repeatScale: { x: instance.repeatScaleV, y: instance.repeatScaleU },
        }
      : {
          uvMetersPerUnit: { x: tileLengthLocal, y: templateHeight },
          repeatScale: { x: instance.repeatScaleU, y: instance.repeatScaleV },
        }
    const materialVariant = getOrCreateWallAutoTiledMaterialSet(
      materialVariantCache,
      template.material,
      repeatInfo,
    )
    return createWallAssetMesh(
      `${namePrefix}:${index}`,
      template,
      instance.matrix,
      materialVariant.material,
      {
        skipMaterialDispose: materialVariant.shared || !materialVariant.owner,
        ownedTextures: materialVariant.owner ? materialVariant.ownedTextures : [],
        shadowSide,
        repeatInfo,
        repeatVariantInfo: {
          repeatScaleU: instance.repeatScaleU,
          repeatScaleV: instance.repeatScaleV,
          uvAxis,
        },
      },
    )
  }).map((mesh, index) => {
    const instance = instances[index]
    if (!instance) {
      return mesh
    }
    mesh.userData.wallInstanceMeta = {
      chainIndex: instance.chainIndex,
      chainArcStart: instance.chainArcStart,
      chainArcEnd: instance.chainArcEnd,
      repeatSlotIndex: instance.repeatSlotIndex,
    }
    return mesh
  })

  return {
    meshes,
    bounds: computeWallAssetBounds(template.bounds, instances.map((entry) => entry.matrix)),
  }
}

function createWallStaticAssetMeshes(
  namePrefix: string,
  template: InstancedAssetTemplate,
  matrices: THREE.Matrix4[],
  shadowSide: THREE.Side = THREE.FrontSide,
): { meshes: THREE.Mesh[]; bounds: THREE.Box3 | null } {
  if (!matrices.length) {
    return { meshes: [], bounds: null }
  }

  return {
    meshes: matrices.map((matrix, index) => createWallAssetMesh(
      `${namePrefix}:${index}`,
      template,
      matrix,
      template.material,
      { skipMaterialDispose: true, shadowSide },
    )),
    bounds: computeWallAssetBounds(template.bounds, matrices),
  }
}

function pickWallCornerRule(
  angleRadians: number,
  rules: WallCornerModelRule[],
  mode: 'body' | 'head' | 'foot',
): WallCornerModelRule | null {
  if (!Number.isFinite(angleRadians)) {
    return null
  }

  const angleDeg = Math.max(0, Math.min(180, THREE.MathUtils.radToDeg(angleRadians)))
  // Special-case straight joints (interior angle ≈ 180°): if a 180° rule exists,
  // always use it and ignore tolerance. Use the radian epsilon constant defined above.
  if (Math.abs(angleRadians - Math.PI) < WALL_INSTANCING_JOINT_ANGLE_EPSILON) {
    for (const rule of rules) {
      const rawAsset = mode === 'body'
        ? rule?.bodyAssetId
        : mode === 'head'
          ? rule?.headAssetId
          : rule?.footAssetId
      const assetId = typeof rawAsset === 'string' && rawAsset.trim().length ? rawAsset.trim() : null
      if (!assetId) {
        continue
      }
      const rawAngle = typeof rule.angle === 'number' ? rule.angle : Number((rule as any).angle)
      const ruleAngle = Number.isFinite(rawAngle) ? Math.max(0, Math.min(180, rawAngle)) : 90
      if (ruleAngle >= 180 - 1e-6) {
        return rule
      }
    }
  }

  let best:
    | { rule: WallCornerModelRule; diff: number; ruleAngle: number }
    | null = null

  for (const rule of rules) {
    const rawAsset = mode === 'body'
      ? rule?.bodyAssetId
      : mode === 'head'
        ? rule?.headAssetId
        : rule?.footAssetId
    const assetId = typeof rawAsset === 'string' && rawAsset.trim().length ? rawAsset.trim() : null
    if (!assetId) {
      continue
    }

    const rawAngle = typeof rule.angle === 'number' ? rule.angle : Number((rule as any).angle)
    const ruleAngle = Number.isFinite(rawAngle) ? Math.max(0, Math.min(180, rawAngle)) : 90
    const rawTolerance = typeof rule.tolerance === 'number' ? rule.tolerance : Number((rule as any).tolerance)
    const tolerance = Number.isFinite(rawTolerance) ? Math.max(0, Math.min(90, rawTolerance)) : 5

    const diff = Math.abs(angleDeg - ruleAngle)

    // Only consider this rule if the difference is within tolerance.
    // NOTE: We intentionally do NOT use supplement angle (180 - angle) matching.
    if (diff > tolerance + 1e-6) {
      continue
    }

    if (!best) {
      best = { rule, diff, ruleAngle }
      continue
    }

    if (diff + 1e-6 < best.diff) {
      best = { rule, diff, ruleAngle }
      continue
    }

    // Tie-breaker: lower target angle for determinism.
    if (Math.abs(diff - best.diff) <= 1e-6 && ruleAngle + 1e-6 < best.ruleAngle) {
      best = { rule, diff, ruleAngle }
    }
  }

  return best ? best.rule : null
}

function computeWallSegmentJointTrimForChain(
  segments: WallRenderSeg[],
  rules: WallCornerModelRule[],
  mode: 'body' | 'head' | 'foot',
): Array<{ start: number; end: number }> {
  const trims = Array.from({ length: segments.length }, () => ({ start: 0, end: 0 }))
  if (segments.length < 2 || !rules.length) {
    return trims
  }

  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const incoming = new THREE.Vector3()
  const outgoing = new THREE.Vector3()

  const applyTrimForPair = (aIndex: number, bIndex: number) => {
    const current = segments[aIndex]
    const next = segments[bIndex]
    if (!current || !next) {
      return
    }
    const gapDx = next.start.x - current.end.x
    const gapDz = next.start.z - current.end.z
    if (gapDx * gapDx + gapDz * gapDz > WALL_EPSILON) {
      return
    }

    start.set(current.start.x, current.start.y, current.start.z)
    end.set(current.end.x, current.end.y, current.end.z)
    incoming.subVectors(end, start)
    incoming.y = 0

    start.set(next.start.x, next.start.y, next.start.z)
    end.set(next.end.x, next.end.y, next.end.z)
    outgoing.subVectors(end, start)
    outgoing.y = 0

    if (incoming.lengthSq() < WALL_INSTANCING_DIR_EPSILON || outgoing.lengthSq() < WALL_INSTANCING_DIR_EPSILON) {
      return
    }
    incoming.normalize()
    outgoing.normalize()

    const dotInterior = THREE.MathUtils.clamp(-incoming.dot(outgoing), -1, 1)
    const angle = Math.acos(dotInterior)
    if (!Number.isFinite(angle)) {
      return
    }

    const rule = pickWallCornerRule(angle, rules, mode)
    if (!rule) {
      return
    }
    const rawStart = Number((rule as any)?.jointTrim?.start)
    const rawEnd = Number((rule as any)?.jointTrim?.end)
    const trimStart = Number.isFinite(rawStart) ? Math.max(0, rawStart) : 0
    const trimEnd = Number.isFinite(rawEnd) ? Math.max(0, rawEnd) : 0
    if (trimEnd > 0) {
      trims[aIndex]!.end = Math.max(trims[aIndex]!.end, trimEnd)
    }
    if (trimStart > 0) {
      trims[bIndex]!.start = Math.max(trims[bIndex]!.start, trimStart)
    }
  }

  for (let i = 0; i < segments.length - 1; i += 1) {
    applyTrimForPair(i, i + 1)
  }

  const first = segments[0]!
  const last = segments[segments.length - 1]!
  const dx = first.start.x - last.end.x
  const dz = first.start.z - last.end.z
  if (dx * dx + dz * dz <= WALL_EPSILON) {
    applyTrimForPair(segments.length - 1, 0)
  }

  return trims
}

function computeWallCornerInstanceMatricesByAsset(
  segments: WallRenderSeg[],
  templatesByAssetId: Map<string, InstancedAssetTemplate>,
  rules: WallCornerModelRule[],
  mode: 'body' | 'head' | 'foot',
  verticalLayoutOptions: WallVerticalLayoutOptions,
): Map<string, THREE.Matrix4[]> {
  const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
  if (segments.length < 2) {
    return matricesByAssetId
  }

  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const incoming = new THREE.Vector3()
  const outgoing = new THREE.Vector3()
  const bisector = new THREE.Vector3()
  const localForward = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const yawQuat = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const offsetLocal = new THREE.Vector3()
  const offsetWorld = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  const localMatrix = new THREE.Matrix4()

  const readOffsetLocal = (rule: WallCornerModelRule): THREE.Vector3 => {
    const raw = mode === 'body'
      ? (rule as any)?.bodyOffsetLocal
      : mode === 'head'
        ? (rule as any)?.headOffsetLocal
        : (rule as any)?.footOffsetLocal
    const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    const read = (key: 'x' | 'y' | 'z'): number => {
      const value = record ? record[key] : 0
      const num = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(num) ? num : 0
    }
    offsetLocal.set(read('x'), read('y'), read('z'))
    return offsetLocal
  }

  const push = (assetId: string, matrix: THREE.Matrix4) => {
    const bucket = matricesByAssetId.get(assetId) ?? []
    if (!matricesByAssetId.has(assetId)) {
      matricesByAssetId.set(assetId, bucket)
    }
    bucket.push(matrix)
  }

  const buildCorner = (
    current: WallRenderSeg,
    next: WallRenderSeg,
    cornerX: number,
    cornerY: number,
    cornerZ: number,
  ) => {
    start.set(current.start.x, current.start.y, current.start.z)
    end.set(current.end.x, current.end.y, current.end.z)
    incoming.subVectors(end, start)
    incoming.y = 0

    start.set(next.start.x, next.start.y, next.start.z)
    end.set(next.end.x, next.end.y, next.end.z)
    outgoing.subVectors(end, start)
    outgoing.y = 0

    if (incoming.lengthSq() < WALL_INSTANCING_DIR_EPSILON || outgoing.lengthSq() < WALL_INSTANCING_DIR_EPSILON) {
      return
    }
    incoming.normalize()
    outgoing.normalize()

    // Use interior angle semantics (straight = 180°).
    // interiorAngle = acos((-incoming)·outgoing) = π - acos(incoming·outgoing)
    const dotInterior = THREE.MathUtils.clamp(-incoming.dot(outgoing), -1, 1)
    const angle = Math.acos(dotInterior)
    if (!Number.isFinite(angle)) {
      return
    }

    const rule = pickWallCornerRule(angle, rules, mode)
    if (!rule) {
      return
    }

    const rawAsset = mode === 'body'
      ? rule.bodyAssetId
      : mode === 'head'
        ? rule.headAssetId
        : rule.footAssetId
    const assetId = typeof rawAsset === 'string' ? rawAsset.trim() : ''
    if (!assetId) {
      return
    }
    const template = templatesByAssetId.get(assetId)
    if (!template) {
      return
    }

    const forwardAxis = requireWallForwardAxis(
      mode === 'body'
        ? rule.bodyForwardAxis
        : mode === 'head'
          ? rule.headForwardAxis
          : rule.footForwardAxis,
      `cornerModels.${mode}ForwardAxis`,
    )
    const yawDeg = normalizeWallYawDeg(
      mode === 'body'
        ? rule.bodyYawDeg
        : mode === 'head'
          ? rule.headYawDeg
          : rule.footYawDeg,
      `cornerModels.${mode}YawDeg`,
    )
    writeWallLocalForward(localForward, forwardAxis)

    const layout = resolveWallVerticalLayout(resolveWallBodyHeight(current as any), verticalLayoutOptions)
    const templateHeight = Math.max(WALL_EPSILON, Math.abs(template.baseSize.y))
    const templateMinY = template.bounds.min.y
    if (mode === 'body' && layout.bodyHeight <= WALL_EPSILON) {
      return
    }
    const scaleY = mode === 'body' ? layout.bodyHeight / templateHeight : 1
    let anchoredY = cornerY + layout.headBaseY - templateMinY
    if (mode === 'body') {
      anchoredY = cornerY + layout.bodyBaseY - scaleY * templateMinY
    } else if (mode === 'foot') {
      anchoredY = cornerY + layout.footBaseY - templateMinY
    }
    scale.set(1, scaleY, 1)

    bisector.copy(incoming).multiplyScalar(-1).add(outgoing)
    if (bisector.lengthSq() < WALL_INSTANCING_DIR_EPSILON) {
      bisector.copy(outgoing)
    }

    quat.setFromUnitVectors(localForward, bisector.normalize())
    if (yawDeg) {
      yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yawDeg))
      quat.multiply(yawQuat)
    }

    pos.set(cornerX, anchoredY, cornerZ)
    // Option A: apply per-rule local offset in the model's local frame, rotated by the final corner orientation.
    offsetWorld.copy(readOffsetLocal(rule)).applyQuaternion(quat)
    pos.add(offsetWorld)
    localMatrix.compose(pos, quat, scale)
    localMatrix.multiply(template.meshToRoot)
    push(assetId, new THREE.Matrix4().copy(localMatrix))
  }

  for (let i = 0; i < segments.length - 1; i += 1) {
    const current = segments[i]!
    const next = segments[i + 1]!
    // Skip pairs that straddle an opening gap (spatially disconnected).
    const gapDx = next.start.x - current.end.x
    const gapDz = next.start.z - current.end.z
    if (gapDx * gapDx + gapDz * gapDz > WALL_EPSILON) {
      continue
    }
    buildCorner(current, next, current.end.x, current.end.y, current.end.z)
  }

  // Closed loop: add corner for last -> first.
  // This also handles the seam of a closed chain that has been split into multiple
  // visual sub-chains by openings: the caller is responsible for passing the correct
  // first/last segments of the full original chain group.
  const first = segments[0]!
  const last = segments[segments.length - 1]!
  const dx = first.start.x - last.end.x
  const dz = first.start.z - last.end.z
  if (dx * dx + dz * dz <= WALL_EPSILON) {
    buildCorner(last, first, last.end.x, last.end.y, last.end.z)
  }

  return matricesByAssetId
}

function computeWallEndCapInstanceMatrices(
  segments: WallRenderSeg[],
  closed: boolean,
  template: InstancedAssetTemplate,
  mode: 'body' | 'head' | 'foot',
  orientation: WallModelOrientation,
  verticalLayoutOptions: WallVerticalLayoutOptions,
  offsetLocalValue?: WallOffsetLocal,
): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []
  if (!segments.length || closed) {
    return matrices
  }

  const firstSeg = segments[0]!
  const lastSeg = segments[segments.length - 1]!

  const localForward = new THREE.Vector3()
  writeWallLocalForward(localForward, orientation.forwardAxis)
  const { minAlongAxis } = resolveWallTemplateAlongAxis(template, orientation.forwardAxis)
  const templateHeight = Math.max(WALL_EPSILON, Math.abs(template.baseSize.y))
  const templateMinY = template.bounds.min.y

  const dir = new THREE.Vector3()
  const unitDir = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const yawQuat = new THREE.Quaternion()
  const offset = new THREE.Vector3()
  const offsetLocal = new THREE.Vector3()
  const offsetWorld = new THREE.Vector3()
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  const localMatrix = new THREE.Matrix4()

  const readOffsetLocal = (value: WallOffsetLocal | undefined): THREE.Vector3 => {
    const record = value && typeof value === 'object' ? value : null
    const read = (key: 'x' | 'y' | 'z'): number => {
      const raw = record ? record[key] : 0
      const num = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(num) ? num : 0
    }
    offsetLocal.set(read('x'), read('y'), read('z'))
    return offsetLocal
  }

  const pushCap = (point: { x: number; y: number; z: number }, outwardDir: THREE.Vector3, layout: WallVerticalLayout) => {
    if (outwardDir.lengthSq() <= WALL_INSTANCING_DIR_EPSILON) {
      return
    }
    quat.setFromUnitVectors(localForward, outwardDir)
    if (orientation.yawDeg) {
      yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(orientation.yawDeg))
      quat.multiply(yawQuat)
    }
    offset.copy(localForward).multiplyScalar(minAlongAxis)
    offset.applyQuaternion(quat)
    pos.set(point.x, point.y, point.z)
    pos.sub(offset)

    if (mode === 'body' && layout.bodyHeight <= WALL_EPSILON) {
      return
    }
    const scaleY = mode === 'body' ? layout.bodyHeight / templateHeight : 1
    let anchoredY = point.y + layout.headBaseY - templateMinY
    if (mode === 'body') {
      anchoredY = point.y + layout.bodyBaseY - scaleY * templateMinY
    } else if (mode === 'foot') {
      anchoredY = point.y + layout.footBaseY - templateMinY
    }
    pos.y = anchoredY
    offsetWorld.copy(readOffsetLocal(offsetLocalValue)).applyQuaternion(quat)
    pos.add(offsetWorld)
    scale.set(1, scaleY, 1)

    localMatrix.compose(pos, quat, scale)
    localMatrix.multiply(template.meshToRoot)
    matrices.push(new THREE.Matrix4().copy(localMatrix))
  }

  // Start cap points outward: opposite of the first segment direction.
  dir.set(firstSeg.end.x - firstSeg.start.x, 0, firstSeg.end.z - firstSeg.start.z)
  if (dir.lengthSq() > WALL_INSTANCING_DIR_EPSILON) {
    unitDir.copy(dir).normalize().multiplyScalar(-1)
    pushCap(firstSeg.start, unitDir, resolveWallVerticalLayout(resolveWallBodyHeight(firstSeg as any), verticalLayoutOptions))
  }

  // End cap points outward: along the last segment direction.
  dir.set(lastSeg.end.x - lastSeg.start.x, 0, lastSeg.end.z - lastSeg.start.z)
  if (dir.lengthSq() > WALL_INSTANCING_DIR_EPSILON) {
    unitDir.copy(dir).normalize()
    pushCap(lastSeg.end, unitDir, resolveWallVerticalLayout(resolveWallBodyHeight(lastSeg as any), verticalLayoutOptions))
  }

  return matrices
}

function createWallMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: WALL_DEFAULT_COLOR,
    metalness: 0.05,
    roughness: 0.85,
  })
  material.name = 'WallMaterial'
  // Keep walls single-sided; geometry winding/normals must face outward.
  material.side = THREE.FrontSide
  material.shadowSide = THREE.FrontSide
  material.transparent = false
  material.opacity = 1
  material.depthWrite = true
  return material
}

function normalizeWallUvAxis(value: unknown, fallback: WallUvAxis = 'auto'): WallUvAxis {
  if (value === 'u' || value === 'v' || value === 'auto') {
    return value
  }
  return fallback
}

const wallResolvedUvAxisByTemplate = new WeakMap<InstancedAssetTemplate, Map<WallForwardAxis, WallResolvedUvAxis>>()

function resolveAutoWallUvAxis(template: InstancedAssetTemplate, forwardAxis: WallForwardAxis): WallResolvedUvAxis {
  let byAxis = wallResolvedUvAxisByTemplate.get(template)
  if (!byAxis) {
    byAxis = new Map<WallForwardAxis, WallResolvedUvAxis>()
    wallResolvedUvAxisByTemplate.set(template, byAxis)
  }
  const cached = byAxis.get(forwardAxis)
  if (cached) {
    return cached
  }

  const geometry = template.geometry
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!positionAttr || !uvAttr || positionAttr.count <= 0 || uvAttr.count < positionAttr.count) {
    byAxis.set(forwardAxis, 'u')
    return 'u'
  }

  const forwardInfo = wallForwardAxisInfo(forwardAxis)
  const alongKey = forwardInfo.axis
  const sideKey = alongKey === 'x' ? 'z' : 'x'
  const position = new THREE.Vector3()

  const vertexCount = positionAttr.count
  const alongValues = new Float32Array(vertexCount)
  const sideValues = new Float32Array(vertexCount)
  const uValues = new Float32Array(vertexCount)
  const vValues = new Float32Array(vertexCount)

  for (let i = 0; i < vertexCount; i += 1) {
    position.fromBufferAttribute(positionAttr, i)
    position.applyMatrix4(template.meshToRoot)
    const alongRaw = alongKey === 'x' ? position.x : position.z
    const sideRaw = sideKey === 'x' ? position.x : position.z
    alongValues[i] = (forwardInfo.sign === 1 ? alongRaw : -alongRaw)
    sideValues[i] = sideRaw
    uValues[i] = uvAttr.getX(i)
    vValues[i] = uvAttr.getY(i)
  }

  let sumAlongUvsU = 0
  let sumAlongUvsV = 0
  let contributingEdges = 0

  const accumulateEdge = (ia: number, ib: number) => {
    if (ia < 0 || ib < 0 || ia >= vertexCount || ib >= vertexCount) {
      return
    }
    const alongDelta = Math.abs(alongValues[ib]! - alongValues[ia]!)
    const sideDelta = Math.abs(sideValues[ib]! - sideValues[ia]!)
    if (!Number.isFinite(alongDelta) || alongDelta <= WALL_EPSILON) {
      return
    }
    if (sideDelta > alongDelta * 2) {
      return
    }
    const du = Math.abs(uValues[ib]! - uValues[ia]!)
    const dv = Math.abs(vValues[ib]! - vValues[ia]!)
    if (!Number.isFinite(du) || !Number.isFinite(dv)) {
      return
    }
    sumAlongUvsU += du
    sumAlongUvsV += dv
    contributingEdges += 1
  }

  const indexAttr = geometry.getIndex()
  if (indexAttr && indexAttr.count >= 3) {
    for (let i = 0; i <= indexAttr.count - 3; i += 3) {
      const a = indexAttr.getX(i)
      const b = indexAttr.getX(i + 1)
      const c = indexAttr.getX(i + 2)
      accumulateEdge(a, b)
      accumulateEdge(b, c)
      accumulateEdge(c, a)
    }
  } else {
    for (let i = 0; i <= vertexCount - 3; i += 3) {
      const a = i
      const b = i + 1
      const c = i + 2
      accumulateEdge(a, b)
      accumulateEdge(b, c)
      accumulateEdge(c, a)
    }
  }

  // Prefer U by default; only switch to V when V is clearly dominant.
  const resolved: WallResolvedUvAxis = contributingEdges > 0 && sumAlongUvsV > sumAlongUvsU * 1.1 ? 'v' : 'u'
  byAxis.set(forwardAxis, resolved)
  return resolved
}

function resolveWallUvAxisForTemplate(
  template: InstancedAssetTemplate,
  orientation: WallModelOrientation,
  requested: WallUvAxis,
): WallResolvedUvAxis {
  if (requested === 'u' || requested === 'v') {
    return requested
  }
  return resolveAutoWallUvAxis(template, orientation.forwardAxis)
}

function rebuildWallGroup(
  group: THREE.Group,
  definition: WallDynamicMesh,
  assets: WallRenderAssetObjects = {},
  options: WallRenderOptions = {},
) {
  clearGroupContent(group)
  const wallAssetBounds = new THREE.Box3()
  wallAssetBounds.makeEmpty()

  const mergeAssetBounds = (bounds: THREE.Box3 | null) => {
    if (!bounds || bounds.isEmpty()) {
      return
    }
    wallAssetBounds.union(bounds)
  }

  const chainDefinitions = buildWallChainDefinitions(definition)
  if (!chainDefinitions.length) {
    const userData = group.userData ?? (group.userData = {})
    delete userData.instancedBounds
    return
  }

  const { width: _dimWidth, height: _dimHeight } = resolveWallDimensionsFromDefinition(definition)
  const width = Math.max(WALL_MIN_WIDTH, _dimWidth)

  const bodyTemplate = assets.bodyObject ? extractInstancedAssetTemplate(assets.bodyObject) : null
  const proceduralBodyVisible = !bodyTemplate
  const headTemplate = assets.headObject ? extractInstancedAssetTemplate(assets.headObject) : null
  const footTemplate = assets.footObject ? extractInstancedAssetTemplate(assets.footObject) : null
  const bodyEndCapTemplate = assets.bodyEndCapObject
    ? extractInstancedAssetTemplate(assets.bodyEndCapObject)
    : null
  const headEndCapTemplate = assets.headEndCapObject
    ? extractInstancedAssetTemplate(assets.headEndCapObject)
    : null
  const footEndCapTemplate = assets.footEndCapObject
    ? extractInstancedAssetTemplate(assets.footEndCapObject)
    : null

  const resolvedHeadAssetHeight = headTemplate ? Math.max(0, Math.abs(headTemplate.baseSize.y)) : 0
  const resolvedFootAssetHeight = footTemplate ? Math.max(0, Math.abs(footTemplate.baseSize.y)) : 0
  const headAssetHeight = Math.max(
    0,
    Number.isFinite(options.headAssetHeight) ? Number(options.headAssetHeight) : resolvedHeadAssetHeight,
  )
  const footAssetHeight = Math.max(
    0,
    Number.isFinite(options.footAssetHeight) ? Number(options.footAssetHeight) : resolvedFootAssetHeight,
  )

  const wallRenderMode = normalizeWallRenderMode(options.wallRenderMode)
  const repeatInstanceStep = normalizeWallRepeatInstanceStep(options.repeatInstanceStep)
  const repeatErasedSlotSet = new Set(
    Array.isArray((definition as any).repeatErasedSlots)
      ? ((definition as any).repeatErasedSlots as Array<{ chainIndex?: unknown; slotIndex?: unknown }>)
          .map((entry) => {
            const chainIndex = Math.max(0, Math.trunc(Number(entry?.chainIndex ?? 0)))
            const slotIndex = Math.max(0, Math.trunc(Number(entry?.slotIndex ?? -1)))
            if (!Number.isFinite(chainIndex) || !Number.isFinite(slotIndex) || slotIndex < 0) {
              return null
            }
            return `${chainIndex}:${slotIndex}`
          })
          .filter((value): value is string => Boolean(value))
      : [],
  )
  const resolvedCornerModels = Array.isArray(options.cornerModels) ? options.cornerModels : []
  const bodyUvAxis = normalizeWallUvAxis(options.bodyUvAxis, 'auto')
  const headUvAxis = normalizeWallUvAxis(options.headUvAxis, bodyUvAxis)
  const footUvAxis = normalizeWallUvAxis(options.footUvAxis, bodyUvAxis)
  const bodyMaterialConfigId = normalizeWallMaterialConfigId(options.bodyMaterialConfigId)
    ?? normalizeWallMaterialConfigId(options.materialConfigId)
    ?? normalizeWallMaterialConfigId(definition.bodyMaterialConfigId)
  const materialVariantCache: WallMaterialVariantCache = new Map()

  const repeatErasedIntervals = (() => {
    if (wallRenderMode !== 'repeatInstances' || !repeatErasedSlotSet.size) {
      return [] as WallArcInterval[]
    }

    const intervals: WallArcInterval[] = []
    const bodyOrientation = bodyTemplate ? requireWallOrientation(options.bodyOrientation, 'bodyOrientation') : null
    const headOrientation = headTemplate ? requireWallOrientation(options.headOrientation, 'headOrientation') : null
    const footOrientation = footTemplate ? requireWallOrientation(options.footOrientation, 'footOrientation') : null

    const pushTemplateIntervals = (
      template: InstancedAssetTemplate | null,
      orientation: WallModelOrientation | null,
      mode: 'body' | 'head' | 'foot',
    ) => {
      if (!template || !orientation) {
        return
      }
      const { tileLengthLocal } = resolveWallTemplateAlongAxis(template, orientation.forwardAxis)
      chainDefinitions.forEach((chainDef) => {
        intervals.push(...buildRepeatedWallArcIntervalsForSegs(
          chainDef.segs,
          mode,
          tileLengthLocal,
          { headAssetHeight, footAssetHeight },
          repeatInstanceStep,
          repeatErasedSlotSet,
          resolvedCornerModels,
        ))
      })
    }

    pushTemplateIntervals(bodyTemplate, bodyOrientation, 'body')
    pushTemplateIntervals(headTemplate, headOrientation, 'head')
    pushTemplateIntervals(footTemplate, footOrientation, 'foot')

    if (!intervals.length) {
      chainDefinitions.forEach((chainDef) => {
        intervals.push(...buildRepeatedWallArcIntervalsForSegs(
          chainDef.segs,
          'body',
          repeatInstanceStep,
          { headAssetHeight, footAssetHeight },
          repeatInstanceStep,
          repeatErasedSlotSet,
          resolvedCornerModels,
        ))
      })
    }

    return mergeWallArcIntervals(intervals)
  })()
  const proceduralChainDefinitions = wallRenderMode === 'repeatInstances' && repeatErasedIntervals.length
    ? chainDefinitions.flatMap((chainDef) => buildWallVisualChainsFromSegs(
        subtractWallArcIntervalsFromSegs(chainDef.segs, repeatErasedIntervals),
      ))
    : chainDefinitions

  const pushSegmentQuad = (
    positions: number[],
    uvs: number[],
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    uvA: [number, number],
    uvB: [number, number],
    uvC: [number, number],
    uvD: [number, number],
  ) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    uvs.push(uvA[0], uvA[1], uvB[0], uvB[1], uvC[0], uvC[1])
    positions.push(c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z)
    uvs.push(uvC[0], uvC[1], uvB[0], uvB[1], uvD[0], uvD[1])
  }

  const proceduralGeometryByChain = (segs: WallRenderSeg[], closed: boolean): THREE.BufferGeometry | null => {
    const halfWidth = Math.max(WALL_EPSILON, width * 0.5)
    const positions: number[] = []
    const uvs: number[] = []
    const start = new THREE.Vector3()
    const end = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const unitDir = new THREE.Vector3()
    const lb0 = new THREE.Vector3()
    const rb0 = new THREE.Vector3()
    const lt0 = new THREE.Vector3()
    const rt0 = new THREE.Vector3()
    const lb1 = new THREE.Vector3()
    const rb1 = new THREE.Vector3()
    const lt1 = new THREE.Vector3()
    const rt1 = new THREE.Vector3()
    const prevDir = new THREE.Vector3()
    const nextDir = new THREE.Vector3()
    const fallbackDir = new THREE.Vector3()
    const leftJoint = new THREE.Vector3()
    const rightJoint = new THREE.Vector3()
    let arc = 0

    const segmentInfos = segs
      .map((seg) => {
        const segmentLayout = resolveWallVerticalLayout(resolveWallBodyHeight(seg), { headAssetHeight, footAssetHeight })
        const segmentBodyHeight = segmentLayout.bodyHeight
        if (segmentBodyHeight <= WALL_EPSILON) {
          return null
        }

        start.set(seg.start.x, seg.start.y + segmentLayout.bodyBaseY, seg.start.z)
        end.set(seg.end.x, seg.end.y + segmentLayout.bodyBaseY, seg.end.z)
        dir.subVectors(end, start)
        dir.y = 0
        const len = dir.length()
        if (len <= WALL_EPSILON) {
          return null
        }

        unitDir.copy(dir).multiplyScalar(1 / len)
        return {
          seg,
          baseY: segmentLayout.bodyBaseY,
          bodyHeight: segmentBodyHeight,
          start: seg.start,
          end: seg.end,
          len,
          dir: unitDir.clone(),
        }
      })
      .filter((entry): entry is {
        seg: WallRenderSeg
        baseY: number
        bodyHeight: number
        start: WallRenderSeg['start']
        end: WallRenderSeg['end']
        len: number
        dir: THREE.Vector3
      } => Boolean(entry))

    if (!segmentInfos.length) {
      return null
    }

    for (let i = 0; i < segmentInfos.length; i += 1) {
      const info = segmentInfos[i]!
      const prev = i > 0 ? segmentInfos[i - 1]! : (closed ? segmentInfos[segmentInfos.length - 1]! : null)
      const next = i < segmentInfos.length - 1 ? segmentInfos[i + 1]! : (closed ? segmentInfos[0]! : null)

      fallbackDir.copy(info.dir)
      prevDir.copy(prev?.dir ?? info.dir)
      nextDir.copy(next?.dir ?? info.dir)

      start.set(info.start.x, info.start.y + info.baseY, info.start.z)
      end.set(info.end.x, info.end.y + info.baseY, info.end.z)

      computeWallJoinOffsetPoint(start, prev ? prevDir : null, info.dir, halfWidth, 1, fallbackDir, leftJoint)
      lb0.copy(leftJoint)
      computeWallJoinOffsetPoint(start, prev ? prevDir : null, info.dir, halfWidth, -1, fallbackDir, rightJoint)
      rb0.copy(rightJoint)

      computeWallJoinOffsetPoint(end, info.dir, next ? nextDir : null, halfWidth, 1, fallbackDir, leftJoint)
      lb1.copy(leftJoint)
      computeWallJoinOffsetPoint(end, info.dir, next ? nextDir : null, halfWidth, -1, fallbackDir, rightJoint)
      rb1.copy(rightJoint)

      lt0.copy(lb0).setY(lb0.y + info.bodyHeight)
      rt0.copy(rb0).setY(rb0.y + info.bodyHeight)
      lt1.copy(lb1).setY(lb1.y + info.bodyHeight)
      rt1.copy(rb1).setY(rb1.y + info.bodyHeight)

      const u0 = arc
      const u1 = arc + info.len
      pushSegmentQuad(positions, uvs, lb0, lb1, lt0, lt1, [u0, 0], [u1, 0], [u0, info.bodyHeight], [u1, info.bodyHeight])
      pushSegmentQuad(positions, uvs, rb0, rt0, rb1, rt1, [u0, 0], [u0, info.bodyHeight], [u1, 0], [u1, info.bodyHeight])
      pushSegmentQuad(positions, uvs, lt0, lt1, rt0, rt1, [u0, 0], [u1, 0], [u0, width], [u1, width])
      pushSegmentQuad(positions, uvs, rb0, rb1, lb0, lb1, [u0, 0], [u1, 0], [u0, width], [u1, width])

      if (!prev) {
        pushSegmentQuad(positions, uvs, rb0, lb0, rt0, lt0, [0, 0], [width, 0], [0, info.bodyHeight], [width, info.bodyHeight])
      }
      if (!next) {
        pushSegmentQuad(positions, uvs, lb1, rb1, lt1, rt1, [0, 0], [width, 0], [0, info.bodyHeight], [width, info.bodyHeight])
      }

      arc = u1
    }

    if (!positions.length) {
      return null
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }

  for (let chainIndex = 0; chainIndex < proceduralChainDefinitions.length; chainIndex += 1) {
    const chainDef = proceduralChainDefinitions[chainIndex]!
    const geometry = proceduralGeometryByChain(chainDef.segs, chainDef.closed)
    if (!geometry) {
      continue
    }
    const mesh = new THREE.Mesh(geometry, createWallMaterial())
    mesh.name = proceduralChainDefinitions.length > 1 ? `WallMesh:${chainIndex}` : 'WallMesh'
    mesh.userData.dynamicMeshType = 'Wall'
    mesh.userData[MATERIAL_CONFIG_ID_KEY] = bodyMaterialConfigId
    mesh.userData[MATERIAL_TEXTURE_REPEAT_INFO_KEY] = {
      uvMetersPerUnit: { x: 1, y: 1 },
      repeatScale: { x: 1, y: 1 },
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.visible = proceduralBodyVisible
    group.add(mesh)
  }

  const rawBodyCornerMap = assets.bodyCornerObjectsByAssetId ?? null
  const bodyCornerObjectsByAssetId = rawBodyCornerMap && typeof rawBodyCornerMap === 'object' ? rawBodyCornerMap : null
  const bodyCornerTemplatesByAssetId = new Map<string, InstancedAssetTemplate>()
  if (bodyCornerObjectsByAssetId) {
    Object.entries(bodyCornerObjectsByAssetId).forEach(([assetId, object]) => {
      const id = typeof assetId === 'string' ? assetId.trim() : ''
      if (!id || !object) {
        return
      }
      const template = extractInstancedAssetTemplate(object)
      if (template) {
        bodyCornerTemplatesByAssetId.set(id, template)
      }
    })
  }

  const rawHeadCornerMap = assets.headCornerObjectsByAssetId ?? null
  const headCornerObjectsByAssetId = rawHeadCornerMap && typeof rawHeadCornerMap === 'object' ? rawHeadCornerMap : null
  const headCornerTemplatesByAssetId = new Map<string, InstancedAssetTemplate>()
  if (headCornerObjectsByAssetId) {
    Object.entries(headCornerObjectsByAssetId).forEach(([assetId, object]) => {
      const id = typeof assetId === 'string' ? assetId.trim() : ''
      if (!id || !object) {
        return
      }
      const template = extractInstancedAssetTemplate(object)
      if (template) {
        headCornerTemplatesByAssetId.set(id, template)
      }
    })
  }

  const rawFootCornerMap = assets.footCornerObjectsByAssetId ?? null
  const footCornerObjectsByAssetId = rawFootCornerMap && typeof rawFootCornerMap === 'object' ? rawFootCornerMap : null
  const footCornerTemplatesByAssetId = new Map<string, InstancedAssetTemplate>()
  if (footCornerObjectsByAssetId) {
    Object.entries(footCornerObjectsByAssetId).forEach(([assetId, object]) => {
      const id = typeof assetId === 'string' ? assetId.trim() : ''
      if (!id || !object) {
        return
      }
      const template = extractInstancedAssetTemplate(object)
      if (template) {
        footCornerTemplatesByAssetId.set(id, template)
      }
    })
  }

  if (bodyTemplate) {
    const bodyOrientation = requireWallOrientation(options.bodyOrientation, 'bodyOrientation')
    const resolvedBodyUvAxis = resolveWallUvAxisForTemplate(bodyTemplate, bodyOrientation, bodyUvAxis)
    const instances: StretchedWallInstance[] = []
    for (const chainDef of chainDefinitions) {
      instances.push(...(
        wallRenderMode === 'repeatInstances'
          ? buildRepeatedWallInstancesForSegs(
              chainDef.segs,
              bodyTemplate,
              'body',
              bodyOrientation,
              { headAssetHeight, footAssetHeight },
              repeatInstanceStep,
              repeatErasedSlotSet,
              resolvedCornerModels,
            )
          : buildStretchedWallInstancesForSegs(chainDef.segs, bodyTemplate, 'body', bodyOrientation, { headAssetHeight, footAssetHeight }, resolvedCornerModels)
      ))
    }
    const bodyAssets = createWallRepeatedAssetMeshes('WallBodyMesh', bodyTemplate, instances, materialVariantCache, bodyOrientation, resolvedBodyUvAxis)
    applyWallMeshMaterialConfigId(bodyAssets.meshes, bodyMaterialConfigId)
    mergeAssetBounds(bodyAssets.bounds)
    for (const mesh of bodyAssets.meshes) {
      group.add(mesh)
    }
  }

  if (headTemplate) {
    const headOrientation = requireWallOrientation(options.headOrientation, 'headOrientation')
    const resolvedHeadUvAxis = resolveWallUvAxisForTemplate(headTemplate, headOrientation, headUvAxis)
    const instances: StretchedWallInstance[] = []
    for (const chainDef of chainDefinitions) {
      instances.push(...(
        wallRenderMode === 'repeatInstances'
          ? buildRepeatedWallInstancesForSegs(
              chainDef.segs,
              headTemplate,
              'head',
              headOrientation,
              { headAssetHeight, footAssetHeight },
              repeatInstanceStep,
              repeatErasedSlotSet,
              resolvedCornerModels,
            )
          : buildStretchedWallInstancesForSegs(chainDef.segs, headTemplate, 'head', headOrientation, { headAssetHeight, footAssetHeight }, resolvedCornerModels)
      ))
    }
    const headAssets = createWallRepeatedAssetMeshes('WallHeadMesh', headTemplate, instances, materialVariantCache, headOrientation, resolvedHeadUvAxis)
    mergeAssetBounds(headAssets.bounds)
    for (const mesh of headAssets.meshes) {
      group.add(mesh)
    }
  }

  if (footTemplate) {
    const footOrientation = requireWallOrientation(options.footOrientation, 'footOrientation')
    const resolvedFootUvAxis = resolveWallUvAxisForTemplate(footTemplate, footOrientation, footUvAxis)
    const instances: StretchedWallInstance[] = []
    for (const chainDef of chainDefinitions) {
      instances.push(...(
        wallRenderMode === 'repeatInstances'
          ? buildRepeatedWallInstancesForSegs(
              chainDef.segs,
              footTemplate,
              'foot',
              footOrientation,
              { headAssetHeight, footAssetHeight },
              repeatInstanceStep,
              repeatErasedSlotSet,
              resolvedCornerModels,
            )
          : buildStretchedWallInstancesForSegs(chainDef.segs, footTemplate, 'foot', footOrientation, { headAssetHeight, footAssetHeight }, resolvedCornerModels)
      ))
    }
    const footAssets = createWallRepeatedAssetMeshes('WallFootMesh', footTemplate, instances, materialVariantCache, footOrientation, resolvedFootUvAxis)
    mergeAssetBounds(footAssets.bounds)
    for (const mesh of footAssets.meshes) {
      group.add(mesh)
    }
  }

  if (bodyEndCapTemplate) {
    const bodyEndCapOrientation = requireWallOrientation(options.bodyEndCapOrientation, 'bodyEndCapOrientation')
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallEndCapInstanceMatrices(
      entry.segs,
      entry.closed,
      bodyEndCapTemplate,
      'body',
      bodyEndCapOrientation,
      { headAssetHeight, footAssetHeight },
      options.bodyEndCapOffsetLocal,
    ))
    if (localMatrices.length > 0) {
      const bodyEndCapAssets = createWallStaticAssetMeshes('WallBodyEndCapMesh', bodyEndCapTemplate, localMatrices)
      mergeAssetBounds(bodyEndCapAssets.bounds)
      bodyEndCapAssets.meshes.forEach((mesh) => group.add(mesh))
    }
  }

  if (headEndCapTemplate) {
    const headEndCapOrientation = requireWallOrientation(options.headEndCapOrientation, 'headEndCapOrientation')
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallEndCapInstanceMatrices(
      entry.segs,
      entry.closed,
      headEndCapTemplate,
      'head',
      headEndCapOrientation,
      { headAssetHeight, footAssetHeight },
      options.headEndCapOffsetLocal,
    ))
    if (localMatrices.length > 0) {
      const headEndCapAssets = createWallStaticAssetMeshes('WallHeadEndCapMesh', headEndCapTemplate, localMatrices)
      mergeAssetBounds(headEndCapAssets.bounds)
      headEndCapAssets.meshes.forEach((mesh) => group.add(mesh))
    }
  }

  if (footEndCapTemplate) {
    const footEndCapOrientation = requireWallOrientation(options.footEndCapOrientation, 'footEndCapOrientation')
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallEndCapInstanceMatrices(
      entry.segs,
      entry.closed,
      footEndCapTemplate,
      'foot',
      footEndCapOrientation,
      { headAssetHeight, footAssetHeight },
      options.footEndCapOffsetLocal,
    ))
    if (localMatrices.length > 0) {
      const footEndCapAssets = createWallStaticAssetMeshes('WallFootEndCapMesh', footEndCapTemplate, localMatrices)
      mergeAssetBounds(footEndCapAssets.bounds)
      footEndCapAssets.meshes.forEach((mesh) => group.add(mesh))
    }
  }

  const cornerRules = options.cornerModels

  // Pre-compute: merge all visual chain segments from the same original chain index into
  // a single ordered array. This ensures that the closed-loop seam corner (at the original
  // arc=0 vertex of a chain) is correctly detected even when an opening splits the chain
  // into multiple spatially-disconnected sub-arcs. The gap-check inside
  // computeWallCornerInstanceMatricesByAsset will skip building corners across those gaps.
  const cornerSegsByChainIndex = new Map<number, WallRenderSeg[]>()
  for (const chainDef of chainDefinitions) {
    for (const seg of chainDef.segs) {
      const ci = Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0)))
      let bucket = cornerSegsByChainIndex.get(ci)
      if (!bucket) {
        bucket = []
        cornerSegsByChainIndex.set(ci, bucket)
      }
      bucket.push(seg)
    }
  }
  const mergedSegsPerChain = Array.from(cornerSegsByChainIndex.values())

  if (Array.isArray(cornerRules) && cornerRules.length && bodyCornerTemplatesByAssetId.size) {
    const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
    for (const mergedSegs of mergedSegsPerChain) {
      const local = computeWallCornerInstanceMatricesByAsset(mergedSegs, bodyCornerTemplatesByAssetId, cornerRules, 'body', { headAssetHeight, footAssetHeight })
      for (const [assetId, mats] of local.entries()) {
        const bucket = matricesByAssetId.get(assetId) ?? []
        if (!matricesByAssetId.has(assetId)) {
          matricesByAssetId.set(assetId, bucket)
        }
        bucket.push(...mats)
      }
    }
    const sortedAssetIds = Array.from(matricesByAssetId.keys()).sort()
    for (const assetId of sortedAssetIds) {
      const template = bodyCornerTemplatesByAssetId.get(assetId)
      const localMatrices = matricesByAssetId.get(assetId) ?? []
      if (!template || !localMatrices.length) {
        continue
      }
      const cornerAssets = createWallStaticAssetMeshes(`WallCornerMesh:${assetId}`, template, localMatrices)
      mergeAssetBounds(cornerAssets.bounds)
      cornerAssets.meshes.forEach((mesh) => group.add(mesh))
    }
  }

  if (Array.isArray(cornerRules) && cornerRules.length && headCornerTemplatesByAssetId.size) {
    const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
    for (const mergedSegs of mergedSegsPerChain) {
      const local = computeWallCornerInstanceMatricesByAsset(mergedSegs, headCornerTemplatesByAssetId, cornerRules, 'head', { headAssetHeight, footAssetHeight })
      for (const [assetId, mats] of local.entries()) {
        const bucket = matricesByAssetId.get(assetId) ?? []
        if (!matricesByAssetId.has(assetId)) {
          matricesByAssetId.set(assetId, bucket)
        }
        bucket.push(...mats)
      }
    }
    const sortedAssetIds = Array.from(matricesByAssetId.keys()).sort()
    for (const assetId of sortedAssetIds) {
      const template = headCornerTemplatesByAssetId.get(assetId)
      const localMatrices = matricesByAssetId.get(assetId) ?? []
      if (!template || !localMatrices.length) {
        continue
      }
      const headCornerAssets = createWallStaticAssetMeshes(`WallHeadCornerMesh:${assetId}`, template, localMatrices)
      mergeAssetBounds(headCornerAssets.bounds)
      headCornerAssets.meshes.forEach((mesh) => group.add(mesh))
    }
  }

  if (Array.isArray(cornerRules) && cornerRules.length && footCornerTemplatesByAssetId.size) {
    const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
    for (const mergedSegs of mergedSegsPerChain) {
      const local = computeWallCornerInstanceMatricesByAsset(mergedSegs, footCornerTemplatesByAssetId, cornerRules, 'foot', { headAssetHeight, footAssetHeight })
      for (const [assetId, mats] of local.entries()) {
        const bucket = matricesByAssetId.get(assetId) ?? []
        if (!matricesByAssetId.has(assetId)) {
          matricesByAssetId.set(assetId, bucket)
        }
        bucket.push(...mats)
      }
    }
    const sortedAssetIds = Array.from(matricesByAssetId.keys()).sort()
    for (const assetId of sortedAssetIds) {
      const template = footCornerTemplatesByAssetId.get(assetId)
      const localMatrices = matricesByAssetId.get(assetId) ?? []
      if (!template || !localMatrices.length) {
        continue
      }
      const footCornerAssets = createWallStaticAssetMeshes(`WallFootCornerMesh:${assetId}`, template, localMatrices)
      mergeAssetBounds(footCornerAssets.bounds)
      footCornerAssets.meshes.forEach((mesh) => group.add(mesh))
    }
  }

  const serializedBounds = serializeBounds(wallAssetBounds.isEmpty() ? null : wallAssetBounds)
  const userData = group.userData ?? (group.userData = {})
  if (serializedBounds) {
    userData.instancedBounds = serializedBounds
  } else {
    delete userData.instancedBounds
  }
}

export function createWallRenderGroup(
  definition: WallDynamicMesh,
  assets: WallRenderAssetObjects = {},
  options: WallRenderOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'WallGroup'
  const userData = group.userData ?? (group.userData = {})
  userData.dynamicMeshType = 'Wall'

  // Store asset references so updateWallGroup can rebuild consistently.
  userData.wallRenderAssets = assets
  rebuildWallGroup(group, definition, getWallRenderAssets(group), options)
  return group
}

export function createWallGroup(definition: WallDynamicMesh, options: WallRenderOptions = {}) {
  return createWallRenderGroup(definition, {}, options)
}

function getWallRenderAssets(group: THREE.Group): WallRenderAssetObjects {
  const userData = group.userData ?? (group.userData = {})
  const current = userData.wallRenderAssets
  if (current && typeof current === 'object') {
    return current as WallRenderAssetObjects
  }

  const fallback: WallRenderAssetObjects = {}
  userData.wallRenderAssets = fallback
  return fallback
}

export function updateWallGroup(
  object: THREE.Object3D,
  definition: WallDynamicMesh,
  options: WallRenderOptions = {},
): boolean {
  const group = object as THREE.Group
  if (!group || !group.isGroup) {
    return false
  }
  const assets = getWallRenderAssets(group)
  rebuildWallGroup(group, definition, assets, options)
  return true
}
