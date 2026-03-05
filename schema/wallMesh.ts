import * as THREE from 'three'
import type { WallDynamicMesh } from './index'
import { MATERIAL_CONFIG_ID_KEY } from './material'
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

export type WallCornerModelRule = {
  bodyAssetId: string | null
  headAssetId: string | null
  footAssetId: string | null
  angle: number
  tolerance: number

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

export type WallForwardAxis = '+x' | '-x' | '+z' | '-z'

export type WallModelOrientation = {
  forwardAxis: WallForwardAxis
  yawDeg: number
}

export type WallUvAxis = 'auto' | 'u' | 'v'
type WallResolvedUvAxis = 'u' | 'v'

export type WallRenderOptions = {
  smoothing?: number
  materialConfigId?: string | null
  cornerModels?: WallCornerModelRule[]

  // Per-part UV repeat axis for stretched wall tiling.
  bodyUvAxis?: WallUvAxis
  headUvAxis?: WallUvAxis
  footUvAxis?: WallUvAxis

  /** Joint trim strategy used to avoid overlaps between body tiles and corner models. */
  jointTrimMode?: 'auto' | 'manual'
  /** Manual trim distances (used when jointTrimMode === 'manual'). */
  jointTrimManual?: { start: number; end: number }

  // Part orientations.
  bodyOrientation?: WallModelOrientation
  headOrientation?: WallModelOrientation
  footOrientation?: WallModelOrientation
  bodyEndCapOrientation?: WallModelOrientation
  headEndCapOrientation?: WallModelOrientation
  footEndCapOrientation?: WallModelOrientation
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
const WALL_INSTANCING_DIR_EPSILON = 1e-6
const WALL_INSTANCING_JOINT_ANGLE_EPSILON = 1e-3
const WALL_SKIP_DISPOSE_USERDATA_KEY = '__harmonySkipDispose'
const WALL_UV_SCALE_U_ATTRIBUTE = 'harmonyWallUvScale'
const wallUvScaleShaderPatchedMaterials = new WeakSet<THREE.Material>()
const WALL_REPEAT_U_TEXTURE_SLOTS = [
  'map',
  'alphaMap',
  'lightMap',
  'aoMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'metalnessMap',
  'roughnessMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmissionMap',
  'thicknessMap',
  'anisotropyMap',
] as const

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
    if (userData[WALL_SKIP_DISPOSE_USERDATA_KEY]) {
      return
    }

    if (mesh.geometry) {
      mesh.geometry.dispose()
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

/**
 * Clone a material and scale the repeat of all texture maps by `stretchFactor`
 * along U (the wall-length direction).  This makes the texture tile proportionally
 * when the model geometry is stretched.
 */
function sanitizeWallUvScaleU(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

/**
 * Clone wall material, clone texture slots used by UV-mapped channels, force RepeatWrapping
 * on U, and install shader patch for per-instance U scaling.
 */
function createWallInstancedMaterial(original: THREE.Material, uvAxis: WallResolvedUvAxis = 'u'): THREE.Material {
  const cloned = original.clone() as THREE.Material & Record<string, unknown>
  let changed = false
  for (const slot of WALL_REPEAT_U_TEXTURE_SLOTS) {
    const texture = cloned[slot] as THREE.Texture | null | undefined
    if (!texture) {
      continue
    }
    const clonedTexture = texture.clone()
    clonedTexture.wrapS = THREE.RepeatWrapping
    clonedTexture.needsUpdate = true
    cloned[slot] = clonedTexture
    changed = true
  }
  installWallUvScaleShaderPatch(cloned, uvAxis)
  if (changed) {
    cloned.needsUpdate = true
  }
  return cloned
}

function installWallUvScaleShaderPatch(material: THREE.Material, uvAxis: WallResolvedUvAxis = 'u'): void {
  const candidate = material as THREE.Material & {
    isMeshStandardMaterial?: boolean
    isMeshPhysicalMaterial?: boolean
    isMeshBasicMaterial?: boolean
    isMeshLambertMaterial?: boolean
    isMeshPhongMaterial?: boolean
    isMeshToonMaterial?: boolean
    isMeshMatcapMaterial?: boolean
    onBeforeCompile?: (shader: any, renderer: any) => void
    customProgramCacheKey?: () => string
    needsUpdate?: boolean
  }
  const isSupported = Boolean(
    candidate?.isMeshStandardMaterial
      || candidate?.isMeshPhysicalMaterial
      || candidate?.isMeshBasicMaterial
      || candidate?.isMeshLambertMaterial
      || candidate?.isMeshPhongMaterial
      || candidate?.isMeshToonMaterial
      || candidate?.isMeshMatcapMaterial,
  )
  if (!isSupported || wallUvScaleShaderPatchedMaterials.has(material)) {
    return
  }

  const previousOnBeforeCompile = candidate.onBeforeCompile?.bind(candidate)
  const previousCacheKey = candidate.customProgramCacheKey?.bind(candidate)
  const uvComponent = uvAxis === 'v' ? 'y' : 'x'
  candidate.customProgramCacheKey = () => {
    const previous = previousCacheKey ? previousCacheKey() : ''
    return `${previous}|harmony-wall-uvscale-v2-${uvAxis}`
  }

  candidate.onBeforeCompile = (shader: { vertexShader?: string }, renderer: unknown) => {
    previousOnBeforeCompile?.(shader as any, renderer as any)

    if (typeof shader?.vertexShader !== 'string') {
      return
    }
    if (shader.vertexShader.includes(WALL_UV_SCALE_U_ATTRIBUTE)) {
      return
    }
    
    console.log('Installing wall UV scale shader patch on material', material)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <uv_pars_vertex>',
        [
          '#include <uv_pars_vertex>',
          '#ifdef USE_INSTANCING',
          `attribute float ${WALL_UV_SCALE_U_ATTRIBUTE};`,
          '#endif',
        ].join('\n'),
      )
      .replace(
        '#include <uv_vertex>',
        [
          '#include <uv_vertex>',
          '#ifdef USE_UV',
          '#ifdef USE_INSTANCING',
          `  float harmonyWallUvScaleU = max(${WALL_UV_SCALE_U_ATTRIBUTE}, 0.000001);`,
          '#ifdef USE_MAP',
          `  vMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_ALPHAMAP',
          `  vAlphaMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_LIGHTMAP',
          `  vLightMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_AOMAP',
          `  vAoMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_BUMPMAP',
          `  vBumpMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_NORMALMAP',
          `  vNormalMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_DISPLACEMENTMAP',
          `  vDisplacementMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_EMISSIVEMAP',
          `  vEmissiveMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_METALNESSMAP',
          `  vMetalnessMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_ROUGHNESSMAP',
          `  vRoughnessMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_CLEARCOATMAP',
          `  vClearcoatMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_CLEARCOAT_NORMALMAP',
          `  vClearcoatNormalMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_CLEARCOAT_ROUGHNESSMAP',
          `  vClearcoatRoughnessMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_IRIDESCENCEMAP',
          `  vIridescenceMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_IRIDESCENCE_THICKNESSMAP',
          `  vIridescenceThicknessMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_SHEEN_COLORMAP',
          `  vSheenColorMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_SHEEN_ROUGHNESSMAP',
          `  vSheenRoughnessMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_SPECULARMAP',
          `  vSpecularMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_SPECULAR_COLORMAP',
          `  vSpecularColorMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_SPECULAR_INTENSITYMAP',
          `  vSpecularIntensityMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_TRANSMISSIONMAP',
          `  vTransmissionMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_THICKNESSMAP',
          `  vThicknessMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#ifdef USE_ANISOTROPYMAP',
          `  vAnisotropyMapUv.${uvComponent} *= harmonyWallUvScaleU;`,
          '#endif',
          '#endif',
          '#endif',
        ].join('\n'),
      )
  }

  wallUvScaleShaderPatchedMaterials.add(material)
  candidate.needsUpdate = true
}

type StretchedWallInstances = {
  matrices: THREE.Matrix4[]
  uvScaleU: number[]
}

/**
 * Build stretched transforms for each render segment in `segs`.
 * UV tiling is provided by per-instance `harmonyWallUvScale`.
 */
function buildStretchedWallInstancesForSegs(
  segs: WallRenderSeg[],
  template: InstancedAssetTemplate,
  mode: 'body' | 'head' | 'foot',
  orientation: WallModelOrientation,
): StretchedWallInstances {
  const matrices: THREE.Matrix4[] = []
  const uvScaleU: number[] = []

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

  for (const seg of segs) {
    start.set(seg.start.x, seg.start.y, seg.start.z)
    end.set(seg.end.x, seg.end.y, seg.end.z)
    dir.subVectors(end, start)
    dir.y = 0
    const length = dir.length()
    if (length <= WALL_INSTANCING_DIR_EPSILON) continue

    const bodyHeight = resolveWallBodyHeight(seg)
    const scaleY = mode === 'body' ? bodyHeight / templateHeight : 1
    // Stretch factor along the template's forward axis.
    const stretchFactor = length / Math.max(WALL_INSTANCING_MIN_TILE_LENGTH, tileLengthLocal)

    unitDir.copy(dir).multiplyScalar(1 / length)
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

    matrices.push(new THREE.Matrix4().copy(localMatrix))
    uvScaleU.push(sanitizeWallUvScaleU(stretchFactor))
  }
  return { matrices, uvScaleU }
}

function createWallInstancedMesh(
  name: string,
  template: InstancedAssetTemplate,
  matrices: THREE.Matrix4[],
  uvScaleU: number[],
  uvAxis: WallResolvedUvAxis = 'u',
): THREE.InstancedMesh | null {
  if (!matrices.length) {
    return null
  }

  const geometry = template.geometry.clone()
  geometry.setAttribute(
    WALL_UV_SCALE_U_ATTRIBUTE,
    new THREE.InstancedBufferAttribute(new Float32Array(uvScaleU), 1),
  )

  const material = Array.isArray(template.material)
    ? template.material.map((entry) => createWallInstancedMaterial(entry, uvAxis))
    : createWallInstancedMaterial(template.material, uvAxis)

  const instanced = new THREE.InstancedMesh(geometry, material, matrices.length)
  instanced.name = name
  instanced.userData.dynamicMeshType = 'WallAsset'
  instanced.castShadow = true
  instanced.receiveShadow = true
  instanced.frustumCulled = false
  for (let i = 0; i < matrices.length; i += 1) {
    instanced.setMatrixAt(i, matrices[i]!)
  }
  instanced.instanceMatrix.needsUpdate = true
  return instanced
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
    const rawAsset = mode === 'body' ? rule?.bodyAssetId : rule?.headAssetId
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
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  const localMatrix = new THREE.Matrix4()

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
    const indices: number[] = []

    const center = new THREE.Vector3()
    const tangent = new THREE.Vector3()
    const lateral = new THREE.Vector3()
    const prevLateral = new THREE.Vector3()
    const hasPrevLateral = { value: false }
    const leftPos = new THREE.Vector3()
    const rightPos = new THREE.Vector3()

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
      const baseY = center.y
      const topY = baseY + heightValue

      // Vertex order per sample: lb, rb, lt, rt (interleaved).
      positions.push(leftPos.x, baseY, leftPos.z)
      positions.push(rightPos.x, baseY, rightPos.z)
      positions.push(leftPos.x, topY, leftPos.z)
      positions.push(rightPos.x, topY, rightPos.z)

      uvs.push(
        0, 0,
        1, 0,
        0, 1,
        1, 1,
      )
  }

    const loopCount = closed ? sampleCount : sampleCount - 1
    for (let i = 0; i < loopCount; i += 1) {
      const next = (i + 1) % sampleCount

      const base = i * 4
      const baseNext = next * 4

      const lb = base
      const rb = base + 1
      const lt = base + 2
      const rt = base + 3

      const lbNext = baseNext
      const rbNext = baseNext + 1
      const ltNext = baseNext + 2
      const rtNext = baseNext + 3

      // Left side
      indices.push(lb, lbNext, lt)
      indices.push(lt, lbNext, ltNext)

      // Right side
      indices.push(rb, rt, rbNext)
      indices.push(rt, rtNext, rbNext)

      // Top face
      indices.push(lt, ltNext, rt)
      indices.push(rt, ltNext, rtNext)

      // Bottom face
      indices.push(rb, rbNext, lb)
      indices.push(lb, rbNext, lbNext)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setIndex(indices)
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

  const chainDefinitions = buildWallChainDefinitions(definition)
  if (!chainDefinitions.length) {
    return
  }

  const { width: _dimWidth, height: _dimHeight } = resolveWallDimensionsFromDefinition(definition)
  const width = Math.max(WALL_MIN_WIDTH, _dimWidth)
  const bodyHeight = Math.max(WALL_MIN_HEIGHT, _dimHeight)

  const bodyTemplate = assets.bodyObject ? extractInstancedAssetTemplate(assets.bodyObject) : null
  const modelModeEnabled = !!bodyTemplate
  const headTemplate = modelModeEnabled && assets.headObject ? extractInstancedAssetTemplate(assets.headObject) : null
  const footTemplate = modelModeEnabled && assets.footObject ? extractInstancedAssetTemplate(assets.footObject) : null
  const bodyEndCapTemplate = modelModeEnabled && assets.bodyEndCapObject
    ? extractInstancedAssetTemplate(assets.bodyEndCapObject)
    : null
  const headEndCapTemplate = bodyEndCapTemplate && assets.headEndCapObject
    ? extractInstancedAssetTemplate(assets.headEndCapObject)
    : null
  const footEndCapTemplate = bodyEndCapTemplate && assets.footEndCapObject
    ? extractInstancedAssetTemplate(assets.footEndCapObject)
    : null

  const headHeightExtra = headTemplate ? Math.max(0, headTemplate.baseSize.y) : 0
  const totalHeight = bodyHeight + headHeightExtra

  const smoothing = normalizeWallSmoothing(options.smoothing)
  const bodyUvAxis = normalizeWallUvAxis(options.bodyUvAxis, 'auto')
  const headUvAxis = normalizeWallUvAxis(options.headUvAxis, bodyUvAxis)
  const footUvAxis = normalizeWallUvAxis(options.footUvAxis, bodyUvAxis)
  const rawMaterialId = typeof options.materialConfigId === 'string' ? options.materialConfigId.trim() : ''

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

    const geometry = buildWallGeometryFromPoints(centers, width, totalHeight, path.closed)
    if (!geometry) {
      continue
    }

    const mesh = new THREE.Mesh(geometry, createWallMaterial())
    mesh.name = chainDefinitions.length > 1 ? `WallMesh:${chainIndex}` : 'WallMesh'
    mesh.userData.dynamicMeshType = 'Wall'
    mesh.userData[MATERIAL_CONFIG_ID_KEY] = rawMaterialId || null
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.visible = !modelModeEnabled
    group.add(mesh)
  }

  const rawBodyCornerMap = assets.bodyCornerObjectsByAssetId ?? null
  const bodyCornerObjectsByAssetId = rawBodyCornerMap && typeof rawBodyCornerMap === 'object' ? rawBodyCornerMap : null
  const bodyCornerTemplatesByAssetId = new Map<string, InstancedAssetTemplate>()
  if (modelModeEnabled && bodyCornerObjectsByAssetId) {
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
  if (modelModeEnabled && headCornerObjectsByAssetId) {
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
  if (modelModeEnabled && footCornerObjectsByAssetId) {
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
    const matrices: THREE.Matrix4[] = []
    const uvScaleU: number[] = []
    for (const chainDef of chainDefinitions) {
      const local = buildStretchedWallInstancesForSegs(chainDef.segs, bodyTemplate, 'body', bodyOrientation)
      matrices.push(...local.matrices)
      uvScaleU.push(...local.uvScaleU)
    }
    const instanced = createWallInstancedMesh('WallBodyInstances', bodyTemplate, matrices, uvScaleU, resolvedBodyUvAxis)
    if (instanced) {
      group.add(instanced)
    }
  }

  if (bodyTemplate && headTemplate) {
    const headOrientation = requireWallOrientation(options.headOrientation, 'headOrientation')
    const resolvedHeadUvAxis = resolveWallUvAxisForTemplate(headTemplate, headOrientation, headUvAxis)
    const matrices: THREE.Matrix4[] = []
    const uvScaleU: number[] = []
    for (const chainDef of chainDefinitions) {
      const local = buildStretchedWallInstancesForSegs(chainDef.segs, headTemplate, 'head', headOrientation)
      matrices.push(...local.matrices)
      uvScaleU.push(...local.uvScaleU)
    }
    const instanced = createWallInstancedMesh('WallHeadInstances', headTemplate, matrices, uvScaleU, resolvedHeadUvAxis)
    if (instanced) {
      group.add(instanced)
    }
  }

  if (bodyTemplate && footTemplate) {
    const footOrientation = requireWallOrientation(options.footOrientation, 'footOrientation')
    const resolvedFootUvAxis = resolveWallUvAxisForTemplate(footTemplate, footOrientation, footUvAxis)
    const matrices: THREE.Matrix4[] = []
    const uvScaleU: number[] = []
    for (const chainDef of chainDefinitions) {
      const local = buildStretchedWallInstancesForSegs(chainDef.segs, footTemplate, 'foot', footOrientation)
      matrices.push(...local.matrices)
      uvScaleU.push(...local.uvScaleU)
    }
    const instanced = createWallInstancedMesh('WallFootInstances', footTemplate, matrices, uvScaleU, resolvedFootUvAxis)
    if (instanced) {
      group.add(instanced)
    }
  }

  if (bodyTemplate && bodyEndCapTemplate) {
    const bodyEndCapOrientation = requireWallOrientation(options.bodyEndCapOrientation, 'bodyEndCapOrientation')
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallEndCapInstanceMatrices(entry.segs, entry.closed, bodyEndCapTemplate, 'body', bodyEndCapOrientation))
    if (localMatrices.length > 0) {
      const instanced = new THREE.InstancedMesh(bodyEndCapTemplate.geometry, bodyEndCapTemplate.material, localMatrices.length)
      instanced.name = 'WallBodyEndCapInstances'
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      instanced.castShadow = true
      instanced.receiveShadow = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
  }

  if (bodyTemplate && bodyEndCapTemplate && headEndCapTemplate) {
    const headEndCapOrientation = requireWallOrientation(options.headEndCapOrientation, 'headEndCapOrientation')
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallEndCapInstanceMatrices(entry.segs, entry.closed, headEndCapTemplate, 'head', headEndCapOrientation))
    if (localMatrices.length > 0) {
      const instanced = new THREE.InstancedMesh(headEndCapTemplate.geometry, headEndCapTemplate.material, localMatrices.length)
      instanced.name = 'WallHeadEndCapInstances'
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      instanced.castShadow = true
      instanced.receiveShadow = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
  }

  if (bodyTemplate && bodyEndCapTemplate && footEndCapTemplate) {
    const footEndCapOrientation = requireWallOrientation(options.footEndCapOrientation, 'footEndCapOrientation')
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallEndCapInstanceMatrices(entry.segs, entry.closed, footEndCapTemplate, 'foot', footEndCapOrientation))
    if (localMatrices.length > 0) {
      const instanced = new THREE.InstancedMesh(footEndCapTemplate.geometry, footEndCapTemplate.material, localMatrices.length)
      instanced.name = 'WallFootEndCapInstances'
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      instanced.castShadow = true
      instanced.receiveShadow = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
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

  if (bodyTemplate && Array.isArray(cornerRules) && cornerRules.length && bodyCornerTemplatesByAssetId.size) {
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
      const instanced = new THREE.InstancedMesh(template.geometry, template.material, localMatrices.length)
      instanced.name = `WallCornerInstances:${assetId}`
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      instanced.castShadow = true
      instanced.receiveShadow = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
  }

  if (bodyTemplate && Array.isArray(cornerRules) && cornerRules.length && headCornerTemplatesByAssetId.size) {
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
      const instanced = new THREE.InstancedMesh(template.geometry, template.material, localMatrices.length)
      instanced.name = `WallHeadCornerInstances:${assetId}`
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      instanced.castShadow = true
      instanced.receiveShadow = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
  }

  if (bodyTemplate && Array.isArray(cornerRules) && cornerRules.length && footCornerTemplatesByAssetId.size) {
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
      const instanced = new THREE.InstancedMesh(template.geometry, template.material, localMatrices.length)
      instanced.name = `WallFootCornerInstances:${assetId}`
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      instanced.castShadow = true
      instanced.receiveShadow = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
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
