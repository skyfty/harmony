import * as THREE from 'three'
import type { WallDynamicMesh } from '@harmony/schema'
import { MATERIAL_CONFIG_ID_KEY } from './material'

export type WallRenderAssetObjects = {
  /** Lower wall body model root (instanced along segments). */
  bodyObject?: THREE.Object3D | null
  /** Upper wall head model root (instanced along segments). Only used when bodyObject is present. */
  headObject?: THREE.Object3D | null

  /** Lower wall end-cap model root. Only used when bodyObject is present and wall is not a closed loop. */
  bodyEndCapObject?: THREE.Object3D | null
  /** Upper wall head end-cap model root. Only used when bodyEndCapObject is present and wall is not a closed loop. */
  headEndCapObject?: THREE.Object3D | null
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
}

export type WallCornerModelRule = {
  bodyAssetId: string | null
  headAssetId: string | null
  angle: number
  tolerance: number
}

export type WallRenderOptions = {
  smoothing?: number
  materialConfigId?: string | null
  cornerModels?: WallCornerModelRule[]
}

const WALL_DEFAULT_COLOR = 0xcfd2d6
const WALL_MIN_HEIGHT = 0.5
const WALL_MIN_WIDTH = 0.1
const WALL_DEFAULT_HEIGHT = 3
const WALL_DEFAULT_WIDTH = 0.2
const WALL_EPSILON = 1e-6
const WALL_MAX_ADAPTIVE_DEPTH = 10
const WALL_MAX_SAMPLE_POINTS = 512

const WALL_INSTANCING_MIN_TILE_LENGTH = 1e-4
const WALL_INSTANCING_DIR_EPSILON = 1e-6
const WALL_INSTANCING_JOINT_ANGLE_EPSILON = 1e-3
const WALL_SKIP_DISPOSE_USERDATA_KEY = '__harmonySkipDispose'

type WallSegment = WallDynamicMesh['segments'] extends Array<infer T> ? T : never

function wallDistanceSqXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

function wallSegmentLengthXZ(segment: WallSegment): number {
  const dx = Number((segment as any).end?.x) - Number((segment as any).start?.x)
  const dz = Number((segment as any).end?.z) - Number((segment as any).start?.z)
  const len = Math.sqrt(dx * dx + dz * dz)
  return Number.isFinite(len) ? len : 0
}

function buildWallChainDefinitions(definition: WallDynamicMesh): WallDynamicMesh[] {
  const rawSegments = Array.isArray(definition.segments) ? (definition.segments as WallSegment[]) : []
  if (!rawSegments.length) {
    return []
  }

  // NOTE: Walls are allowed to be discontinuous. Split the polyline into open chains
  // whenever the previous end does not connect to the next start.
  const chains: WallSegment[][] = []
  let current: WallSegment[] = []
  for (const seg of rawSegments) {
    const len = wallSegmentLengthXZ(seg)
    if (len <= WALL_EPSILON) {
      continue
    }
    const prev = current[current.length - 1]
    if (prev && wallDistanceSqXZ(prev.end as any, seg.start as any) > WALL_EPSILON) {
      if (current.length) {
        chains.push(current)
      }
      current = []
    }
    current.push(seg)
  }
  if (current.length) {
    chains.push(current)
  }

  return chains.map((segments) => ({ ...(definition as any), segments } as WallDynamicMesh))
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

function resolveWallBodyHeight(segment: (WallDynamicMesh['segments'] extends Array<infer T> ? T : never) | null | undefined): number {
  const raw = (segment as any)?.height
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) {
    return WALL_DEFAULT_HEIGHT
  }
  return Math.max(WALL_MIN_HEIGHT, value)
}

function computeWallAlongAxisInstanceMatrices(
  definition: WallDynamicMesh,
  template: InstancedAssetTemplate,
  mode: 'body' | 'head',
): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []

  // Convention: model local +Z is the along-wall axis.
  const tileLengthLocal = Math.max(WALL_INSTANCING_MIN_TILE_LENGTH, Math.abs(template.baseSize.z))
  const minAlongAxis = template.bounds.min.z
  const maxAlongAxis = template.bounds.max.z

  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const unitDir = new THREE.Vector3()
  const minPoint = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)
  const localMatrix = new THREE.Matrix4()

  const templateHeight = Math.max(WALL_EPSILON, Math.abs(template.baseSize.y))
  const templateMinY = template.bounds.min.y

  for (const segment of definition.segments ?? []) {
    start.set(segment.start.x, segment.start.y, segment.start.z)
    end.set(segment.end.x, segment.end.y, segment.end.z)

    const bodyHeight = resolveWallBodyHeight(segment as any)
    const baselineY = start.y
    const scaleY = mode === 'body' ? bodyHeight / templateHeight : 1
    const anchoredY = mode === 'body'
      ? baselineY - scaleY * templateMinY
      : baselineY + bodyHeight - templateMinY
    scale.set(1, scaleY, 1)

    dir.subVectors(end, start)
    dir.y = 0
    const lengthLocal = dir.length()
    if (lengthLocal <= WALL_INSTANCING_DIR_EPSILON) {
      continue
    }

    if (tileLengthLocal <= WALL_INSTANCING_DIR_EPSILON) {
      continue
    }

    unitDir.copy(dir).multiplyScalar(1 / lengthLocal)

    // Do not place tiles for segments shorter than a single tile (avoids overshoot).
    if (lengthLocal < tileLengthLocal - WALL_INSTANCING_DIR_EPSILON) {
      continue
    }

    // Strict endpoint coverage without scaling: last tile aligns its max-face to the segment end.
    const instanceCount = Math.max(1, Math.ceil(lengthLocal / tileLengthLocal - 1e-9))

    quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), unitDir)

    for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
      if (instanceIndex === instanceCount - 1) {
        // Last tile: align max face to segment end.
        offset.set(0, 0, maxAlongAxis)
        offset.applyQuaternion(quat)
        pos.copy(end).sub(offset)
      } else {
        const along = instanceIndex * tileLengthLocal
        minPoint.copy(start).addScaledVector(unitDir, along)

        // Align the template's local min face (bounds.min.z) to the desired min point.
        offset.set(0, 0, minAlongAxis)
        offset.applyQuaternion(quat)
        pos.copy(minPoint).sub(offset)
      }

      // Vertical split: lower body scales with wall height (minY anchored);
      // upper head stays fixed height and sits on top of the scaled body.
      pos.y = anchoredY

      localMatrix.compose(pos, quat, scale)
      localMatrix.multiply(template.meshToRoot)
      matrices.push(new THREE.Matrix4().copy(localMatrix))
    }
  }

  return matrices
}

type WallCornerPickRule = {
  assetId: string | null
  angle: number
  tolerance: number
}

function pickWallCornerAsset(
  angleRadians: number,
  rules: WallCornerPickRule[],
): { assetId: string | null; extraYawRadians: number } {
  if (!Number.isFinite(angleRadians)) {
    return { assetId: null, extraYawRadians: 0 }
  }

  const angleDeg = Math.max(0, Math.min(180, THREE.MathUtils.radToDeg(angleRadians)))
  // Special-case straight joints (interior angle ≈ 180°): if a 180° rule exists,
  // always use it and ignore tolerance. Use the radian epsilon constant defined above.
  if (Math.abs(angleRadians - Math.PI) < WALL_INSTANCING_JOINT_ANGLE_EPSILON) {
    for (const rule of rules) {
      const assetId = typeof rule?.assetId === 'string' && rule.assetId.trim().length ? rule.assetId.trim() : null
      if (!assetId) {
        continue
      }
      const rawAngle = typeof rule.angle === 'number' ? rule.angle : Number((rule as any).angle)
      const ruleAngle = Number.isFinite(rawAngle) ? Math.max(0, Math.min(180, rawAngle)) : 90
      if (ruleAngle >= 180 - 1e-6) {
        return { assetId, extraYawRadians: 0 }
      }
    }
  }

  let best:
    | { assetId: string; diff: number; ruleAngle: number }
    | null = null

  for (const rule of rules) {
    const assetId = typeof rule?.assetId === 'string' && rule.assetId.trim().length ? rule.assetId.trim() : null
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
      best = { assetId, diff, ruleAngle }
      continue
    }

    if (diff + 1e-6 < best.diff) {
      best = { assetId, diff, ruleAngle }
      continue
    }

    // Tie-breaker: lower target angle for determinism.
    if (Math.abs(diff - best.diff) <= 1e-6 && ruleAngle + 1e-6 < best.ruleAngle) {
      best = { assetId, diff, ruleAngle }
    }
  }

  if (best) {
    return { assetId: best.assetId, extraYawRadians: 0 }
  }
  return { assetId: null, extraYawRadians: 0 }
}

function computeWallCornerInstanceMatricesByAsset(
  definition: WallDynamicMesh,
  templatesByAssetId: Map<string, InstancedAssetTemplate>,
  rules: WallCornerPickRule[],
  mode: 'body' | 'head',
): Map<string, THREE.Matrix4[]> {
  const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
  const segments = definition.segments ?? []
  if (segments.length < 2) {
    return matricesByAssetId
  }

  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const incoming = new THREE.Vector3()
  const outgoing = new THREE.Vector3()
  const bisector = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const yawQuat = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  const localMatrix = new THREE.Matrix4()

  const push = (assetId: string, matrix: THREE.Matrix4) => {
    const bucket = matricesByAssetId.get(assetId) ?? []
    if (!matricesByAssetId.has(assetId)) {
      matricesByAssetId.set(assetId, bucket)
    }
    bucket.push(matrix)
  }

  const buildCorner = (
    current: (typeof segments)[number],
    next: (typeof segments)[number],
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

    const selection = pickWallCornerAsset(angle, rules)
    if (!selection.assetId) {
      return
    }
    const template = templatesByAssetId.get(selection.assetId)
    if (!template) {
      return
    }

    const bodyHeight = resolveWallBodyHeight(current as any)
    const templateHeight = Math.max(WALL_EPSILON, Math.abs(template.baseSize.y))
    const templateMinY = template.bounds.min.y
    const scaleY = mode === 'body' ? bodyHeight / templateHeight : 1
    const anchoredY = mode === 'body'
      ? cornerY - scaleY * templateMinY
      : cornerY + bodyHeight - templateMinY
    scale.set(1, scaleY, 1)

    bisector.copy(incoming).multiplyScalar(-1).add(outgoing)
    if (bisector.lengthSq() < WALL_INSTANCING_DIR_EPSILON) {
      bisector.copy(outgoing)
    }

    quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), bisector.normalize())
    if (selection.extraYawRadians) {
      yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), selection.extraYawRadians)
      quat.multiply(yawQuat)
    }

    pos.set(cornerX, anchoredY, cornerZ)
    localMatrix.compose(pos, quat, scale)
    localMatrix.multiply(template.meshToRoot)
    push(selection.assetId, new THREE.Matrix4().copy(localMatrix))
  }

  for (let i = 0; i < segments.length - 1; i += 1) {
    const current = segments[i]!
    const next = segments[i + 1]!
    buildCorner(current, next, current.end.x, current.end.y, current.end.z)
  }

  // Closed loop: add corner for last -> first.
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
  definition: WallDynamicMesh,
  template: InstancedAssetTemplate,
  mode: 'body' | 'head',
): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []
  const segments = definition.segments ?? []
  if (!segments.length) {
    return matrices
  }

  const firstSeg = segments[0]!
  const lastSeg = segments[segments.length - 1]!
  const dx = firstSeg.start.x - lastSeg.end.x
  const dz = firstSeg.start.z - lastSeg.end.z
  const closed = dx * dx + dz * dz <= WALL_EPSILON
  if (closed) {
    return matrices
  }

  const minAlongAxis = template.bounds.min.z
  const templateHeight = Math.max(WALL_EPSILON, Math.abs(template.baseSize.y))
  const templateMinY = template.bounds.min.y

  const dir = new THREE.Vector3()
  const unitDir = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const offset = new THREE.Vector3()
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  const localMatrix = new THREE.Matrix4()

  const pushCap = (point: { x: number; y: number; z: number }, outwardDir: THREE.Vector3, bodyHeight: number) => {
    if (outwardDir.lengthSq() <= WALL_INSTANCING_DIR_EPSILON) {
      return
    }
    quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outwardDir)
    offset.set(0, 0, minAlongAxis)
    offset.applyQuaternion(quat)
    pos.set(point.x, point.y, point.z)
    pos.sub(offset)

    const scaleY = mode === 'body' ? bodyHeight / templateHeight : 1
    const anchoredY = mode === 'body'
      ? point.y - scaleY * templateMinY
      : point.y + bodyHeight - templateMinY
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

function collectWallPath(definition: WallDynamicMesh): WallPath | null {
  const rawSegments = Array.isArray(definition.segments) ? definition.segments : []
  const points: THREE.Vector3[] = []
  for (const segment of rawSegments) {
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

  const firstSegment = Array.isArray(definition.segments) ? definition.segments[0] : null
  const width = Math.max(
    WALL_MIN_WIDTH,
    Number.isFinite(firstSegment?.width ?? Number.NaN)
      ? firstSegment!.width ?? WALL_DEFAULT_WIDTH
      : WALL_DEFAULT_WIDTH,
  )
  const bodyHeight = Math.max(
    WALL_MIN_HEIGHT,
    Number.isFinite(firstSegment?.height ?? Number.NaN)
      ? firstSegment!.height ?? WALL_DEFAULT_HEIGHT
      : WALL_DEFAULT_HEIGHT,
  )

  const bodyTemplate = assets.bodyObject ? extractInstancedAssetTemplate(assets.bodyObject) : null
  const modelModeEnabled = !!bodyTemplate
  const headTemplate = modelModeEnabled && assets.headObject ? extractInstancedAssetTemplate(assets.headObject) : null
  const bodyEndCapTemplate = modelModeEnabled && assets.bodyEndCapObject
    ? extractInstancedAssetTemplate(assets.bodyEndCapObject)
    : null
  const headEndCapTemplate = bodyEndCapTemplate && assets.headEndCapObject
    ? extractInstancedAssetTemplate(assets.headEndCapObject)
    : null

  const headHeightExtra = headTemplate ? Math.max(0, headTemplate.baseSize.y) : 0
  const totalHeight = bodyHeight + headHeightExtra

  const smoothing = normalizeWallSmoothing(options.smoothing)
  const rawMaterialId = typeof options.materialConfigId === 'string' ? options.materialConfigId.trim() : ''

  for (let chainIndex = 0; chainIndex < chainDefinitions.length; chainIndex += 1) {
    const chainDef = chainDefinitions[chainIndex]!
    const path = collectWallPath(chainDef)
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

  if (bodyTemplate) {
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallAlongAxisInstanceMatrices(entry, bodyTemplate, 'body'))
    if (localMatrices.length > 0) {
      const instanced = new THREE.InstancedMesh(bodyTemplate.geometry, bodyTemplate.material, localMatrices.length)
      instanced.name = 'WallBodyInstances'
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
  }

  if (bodyTemplate && headTemplate) {
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallAlongAxisInstanceMatrices(entry, headTemplate, 'head'))
    if (localMatrices.length > 0) {
      const instanced = new THREE.InstancedMesh(headTemplate.geometry, headTemplate.material, localMatrices.length)
      instanced.name = 'WallHeadInstances'
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
  }

  if (bodyTemplate && bodyEndCapTemplate) {
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallEndCapInstanceMatrices(entry, bodyEndCapTemplate, 'body'))
    if (localMatrices.length > 0) {
      const instanced = new THREE.InstancedMesh(bodyEndCapTemplate.geometry, bodyEndCapTemplate.material, localMatrices.length)
      instanced.name = 'WallBodyEndCapInstances'
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
  }

  if (bodyTemplate && bodyEndCapTemplate && headEndCapTemplate) {
    const localMatrices = chainDefinitions.flatMap((entry) => computeWallEndCapInstanceMatrices(entry, headEndCapTemplate, 'head'))
    if (localMatrices.length > 0) {
      const instanced = new THREE.InstancedMesh(headEndCapTemplate.geometry, headEndCapTemplate.material, localMatrices.length)
      instanced.name = 'WallHeadEndCapInstances'
      instanced.userData.dynamicMeshType = 'WallAsset'
      instanced.userData[WALL_SKIP_DISPOSE_USERDATA_KEY] = true
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
  }

  const cornerRules = options.cornerModels
  if (bodyTemplate && Array.isArray(cornerRules) && cornerRules.length && bodyCornerTemplatesByAssetId.size) {
    const pickRules: WallCornerPickRule[] = cornerRules.map((rule) => ({
      assetId: rule.bodyAssetId,
      angle: rule.angle,
      tolerance: rule.tolerance,
    }))

    const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
    for (const chainDef of chainDefinitions) {
      const local = computeWallCornerInstanceMatricesByAsset(chainDef, bodyCornerTemplatesByAssetId, pickRules, 'body')
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
      for (let i = 0; i < localMatrices.length; i += 1) {
        instanced.setMatrixAt(i, localMatrices[i]!)
      }
      instanced.instanceMatrix.needsUpdate = true
      group.add(instanced)
    }
  }

  if (bodyTemplate && Array.isArray(cornerRules) && cornerRules.length && headCornerTemplatesByAssetId.size) {
    const pickRules: WallCornerPickRule[] = cornerRules.map((rule) => ({
      assetId: rule.headAssetId,
      angle: rule.angle,
      tolerance: rule.tolerance,
    }))

    const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
    for (const chainDef of chainDefinitions) {
      const local = computeWallCornerInstanceMatricesByAsset(chainDef, headCornerTemplatesByAssetId, pickRules, 'head')
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
  group.userData.dynamicMeshType = 'Wall'

  // Store asset references so updateWallGroup can rebuild consistently.
  group.userData.wallRenderAssets = assets
  rebuildWallGroup(group, definition, assets, options)
  return group
}

export function createWallGroup(definition: WallDynamicMesh, options: WallRenderOptions = {}) {
  return createWallRenderGroup(definition, {}, options)
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
  const assets = (group.userData?.wallRenderAssets ?? {}) as WallRenderAssetObjects
  rebuildWallGroup(group, definition, assets, options)
  return true
}
