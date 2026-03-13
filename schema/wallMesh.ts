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
  smoothing?: number
  materialConfigId?: string | null
  bodyMaterialConfigId?: string | null
  cornerModels?: WallCornerModelRule[]
  wallRenderMode?: WallRenderMode
  repeatInstanceStep?: number

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
const WALL_MAX_ADAPTIVE_DEPTH = 10
const WALL_MAX_SAMPLE_POINTS = 512

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

function buildWallChainDefinitions(definition: WallDynamicMesh): WallVisualChain[] {
  const renderSegs = compileWallSegmentsFromDefinition(definition)
  if (!renderSegs.length) return []

  // Group into chains: consecutive segments whose endpoints connect (gap ≤ WALL_EPSILON).
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

    const bodyHeight = resolveWallBodyHeight(seg)
    const scaleY = mode === 'body' ? bodyHeight / templateHeight : 1
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
      anchoredY = start.y - scaleY * templateMinY
    } else if (mode === 'head') {
      anchoredY = start.y + bodyHeight - templateMinY
    } else {
      anchoredY = start.y - templateMinY
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

    const bodyHeight = resolveWallBodyHeight(seg)
    const scaleY = mode === 'body' ? bodyHeight / templateHeight : 1

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
      anchoredY = start.y - scaleY * templateMinY
    } else if (mode === 'head') {
      anchoredY = start.y + bodyHeight - templateMinY
    } else {
      anchoredY = start.y - templateMinY
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

    const bodyHeight = resolveWallBodyHeight(current as any)
    const templateHeight = Math.max(WALL_EPSILON, Math.abs(template.baseSize.y))
    const templateMinY = template.bounds.min.y
    const scaleY = mode === 'body' ? bodyHeight / templateHeight : 1
    let anchoredY = cornerY + bodyHeight - templateMinY
    if (mode === 'body') {
      anchoredY = cornerY - scaleY * templateMinY
    } else if (mode === 'foot') {
      anchoredY = cornerY - templateMinY
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

  const pushCap = (point: { x: number; y: number; z: number }, outwardDir: THREE.Vector3, bodyHeight: number) => {
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

    const scaleY = mode === 'body' ? bodyHeight / templateHeight : 1
    let anchoredY = point.y + bodyHeight - templateMinY
    if (mode === 'body') {
      anchoredY = point.y - scaleY * templateMinY
    } else if (mode === 'foot') {
      anchoredY = point.y - templateMinY
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
    pushCap(firstSeg.start, unitDir, resolveWallBodyHeight(firstSeg as any))
  }

  // End cap points outward: along the last segment direction.
  dir.set(lastSeg.end.x - lastSeg.start.x, 0, lastSeg.end.z - lastSeg.start.z)
  if (dir.lengthSq() > WALL_INSTANCING_DIR_EPSILON) {
    unitDir.copy(dir).normalize()
    pushCap(lastSeg.end, unitDir, resolveWallBodyHeight(lastSeg as any))
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

function normalizeWallSmoothing(value?: number): number {
  const raw = Number.isFinite(value) ? (value as number) : Number(value ?? NaN)
  if (!Number.isFinite(raw)) {
    return 0
  }
  return Math.max(0, Math.min(1, raw))
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

type WallPath = {
  points: THREE.Vector3[]
  closed: boolean
}

  function simplifyWallPolylinePoints(points: THREE.Vector3[], closed: boolean): THREE.Vector3[] {
    if (points.length < 3) {
      return points.slice()
    }

    const planarDir = (from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3): boolean => {
      out.subVectors(to, from)
      out.y = 0
      const lenSq = out.lengthSq()
      if (lenSq <= WALL_EPSILON) {
        return false
      }
      out.multiplyScalar(1 / Math.sqrt(lenSq))
      return true
    }

    const simplified: THREE.Vector3[] = []
    const dirA = new THREE.Vector3()
    const dirB = new THREE.Vector3()

    const count = points.length
    const lastIndex = count - 1

    const startIndex = 0
    const endIndex = lastIndex

    for (let i = 0; i < count; i += 1) {
      const prevIndex = i === 0 ? (closed ? lastIndex : 0) : i - 1
      const nextIndex = i === lastIndex ? (closed ? 0 : lastIndex) : i + 1

      const prev = points[prevIndex]!
      const curr = points[i]!
      const next = points[nextIndex]!

      if (!closed && (i === startIndex || i === endIndex)) {
        simplified.push(curr)
        continue
      }

      if (!planarDir(prev, curr, dirA) || !planarDir(curr, next, dirB)) {
        simplified.push(curr)
        continue
      }

      // If nearly collinear in XZ plane, drop the middle point.
      const crossY = dirA.x * dirB.z - dirA.z * dirB.x
      const dot = THREE.MathUtils.clamp(dirA.dot(dirB), -1, 1)
      if (Math.abs(crossY) < 1e-4 && dot > 0.9995) {
        continue
      }

      simplified.push(curr)
    }

    // Ensure open polylines keep endpoints.
    if (!closed) {
      if (!simplified.length || simplified[0]!.distanceToSquared(points[0]!) > WALL_EPSILON) {
        simplified.unshift(points[0]!)
      }
      if (simplified[simplified.length - 1]!.distanceToSquared(points[lastIndex]!) > WALL_EPSILON) {
        simplified.push(points[lastIndex]!)
      }
    }

    // Closed rings: avoid degeneracy.
    if (simplified.length >= 3) {
      return simplified
    }
    return points.slice()
  }

function normalizeWallPoint(value: unknown): THREE.Vector3 | null {
  const candidate = value as { x?: unknown; y?: unknown; z?: unknown } | null
  if (!candidate) {
    return null
  }
  const x = Number(candidate.x)
  const y = Number(candidate.y)
  const z = Number(candidate.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null
  }
  return new THREE.Vector3(x, y, z)
}

function collectWallPath(segments: WallRenderSeg[]): WallPath | null {
  const points: THREE.Vector3[] = []
  for (const segment of segments) {
    const start = normalizeWallPoint(segment.start)
    const end = normalizeWallPoint(segment.end)
    if (!start || !end) {
      continue
    }
      if (points.length === 0) {
        points.push(start)
      } else if (points[points.length - 1]!.distanceToSquared(start) > WALL_EPSILON) {
        points.push(start)
      }

      if (points.length === 0) {
        points.push(end)
      } else if (points[points.length - 1]!.distanceToSquared(end) > WALL_EPSILON) {
        points.push(end)
      }
  }
  if (points.length < 2) {
    return null
  }
    const first = points[0]!
    const last = points[points.length - 1]!
    const closed = first.distanceToSquared(last) <= WALL_EPSILON
  if (closed && points.length > 1) {
    points.pop()
  }
  if (points.length < 2) {
    return null
  }
  return { points, closed }
}

  function createWallPolyline(points: THREE.Vector3[], closed: boolean): THREE.Curve<THREE.Vector3> {
    const path = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 0; i < points.length - 1; i += 1) {
      path.add(new THREE.LineCurve3(points[i]!, points[i + 1]!))
    }
    if (closed && points.length > 1) {
      path.add(new THREE.LineCurve3(points[points.length - 1]!, points[0]!))
    }
    return path
  }

  function createWallCurve(points: THREE.Vector3[], closed: boolean, smoothing: number): THREE.Curve<THREE.Vector3> {
    if (points.length === 2) {
      return new THREE.LineCurve3(points[0], points[1])
    }

    // smoothing = 0 should keep hard corners (polyline).
    if (smoothing <= WALL_EPSILON) {
      return createWallPolyline(points, closed)
    }

    // For smoothing > 0, interpolate through points via Catmull-Rom.
    // Map smoothing so that larger values round corners more.
    const tension = THREE.MathUtils.clamp(smoothing, 0, 1)
    const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom')
    curve.tension = tension
    return curve
  }

  function distancePointToSegmentXZ(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
    const ax = a.x
    const az = a.z
    const bx = b.x
    const bz = b.z
    const px = point.x
    const pz = point.z
    const abx = bx - ax
    const abz = bz - az
    const apx = px - ax
    const apz = pz - az

    const abLenSq = abx * abx + abz * abz
    if (abLenSq <= WALL_EPSILON) {
      const dx = px - ax
      const dz = pz - az
      return Math.sqrt(dx * dx + dz * dz)
    }
    const t = THREE.MathUtils.clamp((apx * abx + apz * abz) / abLenSq, 0, 1)
    const cx = ax + abx * t
    const cz = az + abz * t
    const dx = px - cx
    const dz = pz - cz
    return Math.sqrt(dx * dx + dz * dz)
  }

  function computeAdaptiveWallSamplePoints(
    curve: THREE.Curve<THREE.Vector3>,
    height: number,
    smoothing: number,
    closed: boolean,
  ): THREE.Vector3[] {
    const rawHeight = Math.max(WALL_MIN_HEIGHT, height)
    // Higher walls and higher smoothing get a tighter tolerance (more detail).
    const base = 0.06
    const heightFactor = 1 / Math.max(1, rawHeight)
    const smoothingFactor = THREE.MathUtils.lerp(1.2, 0.6, THREE.MathUtils.clamp(smoothing, 0, 1))
    const maxError = THREE.MathUtils.clamp(base * heightFactor * smoothingFactor, 0.01, 0.08)

    const points: THREE.Vector3[] = []

    const recurse = (t0: number, p0: THREE.Vector3, t1: number, p1: THREE.Vector3, depth: number) => {
      if (points.length >= WALL_MAX_SAMPLE_POINTS) {
        points.push(p1)
        return
      }
      const tm = (t0 + t1) * 0.5
      const pm = curve.getPoint(tm)
      const error = distancePointToSegmentXZ(pm, p0, p1)
      if (depth >= WALL_MAX_ADAPTIVE_DEPTH || error <= maxError) {
        points.push(p1)
        return
      }
      recurse(t0, p0, tm, pm, depth + 1)
      recurse(tm, pm, t1, p1, depth + 1)
    }

    const pStart = curve.getPoint(0)
    const pEnd = curve.getPoint(1)
    points.push(pStart)
    recurse(0, pStart, 1, pEnd, 0)

    if (closed && points.length > 2) {
      // If start and end are effectively identical, drop the duplicate.
      if (points[0]!.distanceToSquared(points[points.length - 1]!) <= WALL_EPSILON) {
        points.pop()
      }
    }

    return points
  }

  function buildWallGeometryFromPoints(
    centers: THREE.Vector3[],
    width: number,
    height: number,
    closed: boolean,
  ): THREE.BufferGeometry | null {
    if (centers.length < 2) {
      return null
    }
    const halfWidth = Math.max(WALL_EPSILON, width * 0.5)
    const heightValue = Math.max(WALL_MIN_HEIGHT, height)

    const positions: number[] = []
    const uvs: number[] = []

    const center = new THREE.Vector3()
    const tangent = new THREE.Vector3()
    const lateral = new THREE.Vector3()
    const prevLateral = new THREE.Vector3()
    const hasPrevLateral = { value: false }
    const leftPos = new THREE.Vector3()
    const rightPos = new THREE.Vector3()
    const currentLeftBottom = new THREE.Vector3()
    const currentRightBottom = new THREE.Vector3()
    const currentLeftTop = new THREE.Vector3()
    const currentRightTop = new THREE.Vector3()
    const nextLeftBottom = new THREE.Vector3()
    const nextRightBottom = new THREE.Vector3()
    const nextLeftTop = new THREE.Vector3()
    const nextRightTop = new THREE.Vector3()

    const leftSamples: THREE.Vector3[] = []
    const rightSamples: THREE.Vector3[] = []

    const pushVertex = (vertex: THREE.Vector3, u: number, v: number) => {
      positions.push(vertex.x, vertex.y, vertex.z)
      uvs.push(u, v)
    }

    const pushQuad = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      c: THREE.Vector3,
      d: THREE.Vector3,
      uvA: [number, number],
      uvB: [number, number],
      uvC: [number, number],
      uvD: [number, number],
    ) => {
      pushVertex(a, uvA[0], uvA[1])
      pushVertex(b, uvB[0], uvB[1])
      pushVertex(c, uvC[0], uvC[1])

      pushVertex(c, uvC[0], uvC[1])
      pushVertex(b, uvB[0], uvB[1])
      pushVertex(d, uvD[0], uvD[1])
    }

    const cumulativeDistances: number[] = [0]

    const sampleCount = centers.length
    for (let i = 0; i < sampleCount; i += 1) {
      center.copy(centers[i]!)

      // Tangent from neighboring samples (stable for polylines + adaptive samples).
      const prev = centers[i === 0 ? (closed ? sampleCount - 1 : 0) : i - 1]!
      const next = centers[i === sampleCount - 1 ? (closed ? 0 : sampleCount - 1) : i + 1]!
      tangent.subVectors(next, prev)
      tangent.y = 0
      if (tangent.lengthSq() <= WALL_EPSILON) {
        tangent.set(1, 0, 0)
      } else {
        tangent.normalize()
      }

      lateral.set(-tangent.z, 0, tangent.x)
      if (lateral.lengthSq() <= WALL_EPSILON) {
        lateral.set(0, 0, 1)
      } else {
        lateral.normalize()
      }

      // Enforce a consistent lateral direction along the path to avoid
      // frame flips that can invert winding and make some faces disappear.
      if (hasPrevLateral.value && prevLateral.dot(lateral) < 0) {
        lateral.multiplyScalar(-1)
      }
      prevLateral.copy(lateral)
      hasPrevLateral.value = true

      leftPos.copy(center).addScaledVector(lateral, halfWidth)
      rightPos.copy(center).addScaledVector(lateral, -halfWidth)
      leftSamples.push(leftPos.clone())
      rightSamples.push(rightPos.clone())

      if (i < sampleCount - 1) {
        cumulativeDistances.push(cumulativeDistances[i]! + center.distanceTo(centers[i + 1]!))
      }
    }

    const totalLength = closed
      ? cumulativeDistances[sampleCount - 1]! + centers[sampleCount - 1]!.distanceTo(centers[0]!)
      : cumulativeDistances[sampleCount - 1]!

    const loopCount = closed ? sampleCount : sampleCount - 1
    for (let i = 0; i < loopCount; i += 1) {
      const next = (i + 1) % sampleCount
      const segmentLength = centers[i]!.distanceTo(centers[next]!)
      if (segmentLength <= WALL_EPSILON) {
        continue
      }

      const u0 = cumulativeDistances[i]!
      const u1 = closed && next === 0 ? totalLength : cumulativeDistances[next]!

      currentLeftBottom.copy(leftSamples[i]!)
      currentRightBottom.copy(rightSamples[i]!)
      nextLeftBottom.copy(leftSamples[next]!)
      nextRightBottom.copy(rightSamples[next]!)

      currentLeftTop.copy(currentLeftBottom).setY(currentLeftBottom.y + heightValue)
      currentRightTop.copy(currentRightBottom).setY(currentRightBottom.y + heightValue)
      nextLeftTop.copy(nextLeftBottom).setY(nextLeftBottom.y + heightValue)
      nextRightTop.copy(nextRightBottom).setY(nextRightBottom.y + heightValue)

      // Left exterior face.
      pushQuad(
        currentLeftBottom,
        nextLeftBottom,
        currentLeftTop,
        nextLeftTop,
        [u0, 0],
        [u1, 0],
        [u0, heightValue],
        [u1, heightValue],
      )

      // Right exterior face.
      pushQuad(
        currentRightBottom,
        currentRightTop,
        nextRightBottom,
        nextRightTop,
        [u0, 0],
        [u0, heightValue],
        [u1, 0],
        [u1, heightValue],
      )

      // Top face.
      pushQuad(
        currentLeftTop,
        nextLeftTop,
        currentRightTop,
        nextRightTop,
        [u0, 0],
        [u1, 0],
        [u0, width],
        [u1, width],
      )

      // Bottom face.
      pushQuad(
        currentRightBottom,
        nextRightBottom,
        currentLeftBottom,
        nextLeftBottom,
        [u0, 0],
        [u1, 0],
        [u0, width],
        [u1, width],
      )
    }

    if (!closed) {
      currentLeftBottom.copy(leftSamples[0]!)
      currentRightBottom.copy(rightSamples[0]!)
      currentLeftTop.copy(currentLeftBottom).setY(currentLeftBottom.y + heightValue)
      currentRightTop.copy(currentRightBottom).setY(currentRightBottom.y + heightValue)
      pushQuad(
        currentRightBottom,
        currentLeftBottom,
        currentRightTop,
        currentLeftTop,
        [0, 0],
        [width, 0],
        [0, heightValue],
        [width, heightValue],
      )

      nextLeftBottom.copy(leftSamples[sampleCount - 1]!)
      nextRightBottom.copy(rightSamples[sampleCount - 1]!)
      nextLeftTop.copy(nextLeftBottom).setY(nextLeftBottom.y + heightValue)
      nextRightTop.copy(nextRightBottom).setY(nextRightBottom.y + heightValue)
      pushQuad(
        nextLeftBottom,
        nextRightBottom,
        nextLeftTop,
        nextRightTop,
        [0, 0],
        [width, 0],
        [0, heightValue],
        [width, heightValue],
      )
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
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
  const bodyHeight = Math.max(WALL_MIN_HEIGHT, _dimHeight)

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

  const headHeightExtra = headTemplate ? Math.max(0, headTemplate.baseSize.y) : 0
  const totalHeight = bodyHeight + headHeightExtra

  const smoothing = normalizeWallSmoothing(options.smoothing)
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
  const bodyUvAxis = normalizeWallUvAxis(options.bodyUvAxis, 'auto')
  const headUvAxis = normalizeWallUvAxis(options.headUvAxis, bodyUvAxis)
  const footUvAxis = normalizeWallUvAxis(options.footUvAxis, bodyUvAxis)
  const bodyMaterialConfigId = normalizeWallMaterialConfigId(options.bodyMaterialConfigId)
    ?? normalizeWallMaterialConfigId(options.materialConfigId)
    ?? normalizeWallMaterialConfigId(definition.bodyMaterialConfigId)
  const materialVariantCache: WallMaterialVariantCache = new Map()

  for (let chainIndex = 0; chainIndex < chainDefinitions.length; chainIndex += 1) {
    const chainDef = chainDefinitions[chainIndex]!
    const path = collectWallPath(chainDef.segs)
    if (!path) {
      continue
    }

    let centers: THREE.Vector3[]
    if (smoothing <= WALL_EPSILON) {
      // Default: keep corners sharp and avoid extra triangles on long straight runs.
      centers = simplifyWallPolylinePoints(path.points, path.closed)
    } else {
      const curve = createWallCurve(path.points, path.closed, smoothing)
      centers = computeAdaptiveWallSamplePoints(curve, totalHeight, smoothing, path.closed)
    }

    const geometry = buildWallGeometryFromPoints(centers, width, bodyHeight, path.closed)
    if (!geometry) {
      continue
    }

    const mesh = new THREE.Mesh(geometry, createWallMaterial())
    mesh.name = chainDefinitions.length > 1 ? `WallMesh:${chainIndex}` : 'WallMesh'
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
              repeatInstanceStep,
              repeatErasedSlotSet,
              Array.isArray(options.cornerModels) ? options.cornerModels : [],
            )
          : buildStretchedWallInstancesForSegs(chainDef.segs, bodyTemplate, 'body', bodyOrientation, Array.isArray(options.cornerModels) ? options.cornerModels : [])
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
              repeatInstanceStep,
              repeatErasedSlotSet,
              Array.isArray(options.cornerModels) ? options.cornerModels : [],
            )
          : buildStretchedWallInstancesForSegs(chainDef.segs, headTemplate, 'head', headOrientation, Array.isArray(options.cornerModels) ? options.cornerModels : [])
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
              repeatInstanceStep,
              repeatErasedSlotSet,
              Array.isArray(options.cornerModels) ? options.cornerModels : [],
            )
          : buildStretchedWallInstancesForSegs(chainDef.segs, footTemplate, 'foot', footOrientation, Array.isArray(options.cornerModels) ? options.cornerModels : [])
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
      const local = computeWallCornerInstanceMatricesByAsset(mergedSegs, bodyCornerTemplatesByAssetId, cornerRules, 'body')
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
      const local = computeWallCornerInstanceMatricesByAsset(mergedSegs, headCornerTemplatesByAssetId, cornerRules, 'head')
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
      const local = computeWallCornerInstanceMatricesByAsset(mergedSegs, footCornerTemplatesByAssetId, cornerRules, 'foot')
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
