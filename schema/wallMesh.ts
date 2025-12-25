import * as THREE from 'three'
import type { WallDynamicMesh } from '@harmony/schema'
import { MATERIAL_CONFIG_ID_KEY } from './material'

export type WallRenderAssetObjects = {
  bodyObject?: THREE.Object3D | null
  jointObject?: THREE.Object3D | null
}

export type WallRenderOptions = {
  smoothing?: number
  materialConfigId?: string | null
}

const WALL_DEFAULT_COLOR = 0xcfd2d6
const WALL_MIN_HEIGHT = 0.5
const WALL_MIN_WIDTH = 0.1
const WALL_DEFAULT_HEIGHT = 3
const WALL_DEFAULT_WIDTH = 0.2
const WALL_MIN_DIVISIONS = 4
const WALL_MAX_DIVISIONS = 256
const WALL_DIVISION_DENSITY = 8
const WALL_EPSILON = 1e-6

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
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
    const child = group.children.pop()
    if (child) {
      disposeObject3D(child)
    }
  }
}

function createWallMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: WALL_DEFAULT_COLOR,
    metalness: 0.05,
    roughness: 0.85,
  })
  material.name = 'WallMaterial'
  material.side = THREE.DoubleSide
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
    if (!points.length || points[points.length - 1].distanceToSquared(start) > WALL_EPSILON) {
      points.push(start)
    }
    if (!points.length || points[points.length - 1].distanceToSquared(end) > WALL_EPSILON) {
      points.push(end)
    }
  }
  if (points.length < 2) {
    return null
  }
  const closed = points[0].distanceToSquared(points[points.length - 1]) <= WALL_EPSILON
  if (closed && points.length > 1) {
    points.pop()
  }
  if (points.length < 2) {
    return null
  }
  return { points, closed }
}

function createWallCurve(points: THREE.Vector3[], closed: boolean, tension: number): THREE.Curve<THREE.Vector3> {
  if (points.length === 2) {
    return new THREE.LineCurve3(points[0], points[1])
  }
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom')
  curve.tension = Math.max(0, Math.min(1, tension))
  return curve
}

function buildWallGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  width: number,
  height: number,
  closed: boolean,
): THREE.BufferGeometry | null {
  const length = curve.getLength()
  if (length <= WALL_EPSILON) {
    return null
  }
  const divisions = Math.max(
    WALL_MIN_DIVISIONS,
    Math.min(WALL_MAX_DIVISIONS, Math.ceil(length * WALL_DIVISION_DENSITY)),
  )
  const sampleCount = divisions + 1
  if (sampleCount < 2) {
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

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / divisions
    center.copy(curve.getPoint(t))
    tangent.copy(curve.getTangent(t))
    tangent.y = 0
    if (tangent.lengthSq() <= WALL_EPSILON) {
      tangent.set(1, 0, 0)
    } else {
      tangent.normalize()
    }
    lateral.set(-tangent.z, 0, tangent.x)
    lateral.normalize()

    const left = center.clone().addScaledVector(lateral, halfWidth)
    const right = center.clone().addScaledVector(lateral, -halfWidth)
    const baseY = center.y
    const topY = baseY + heightValue

    positions.push(left.x, baseY, left.z)
    positions.push(right.x, baseY, right.z)
    positions.push(left.x, topY, left.z)
    positions.push(right.x, topY, right.z)

    uvs.push(0, 0, 1, 0, 0, 1, 1, 1)
  }

  const stride = sampleCount
  const loopCount = closed ? sampleCount : sampleCount - 1
  for (let i = 0; i < loopCount; i += 1) {
    const next = (i + 1) % sampleCount
    const lb = i
    const rb = stride + i
    const lt = stride * 2 + i
    const rt = stride * 3 + i

    const lbNext = next
    const rbNext = stride + next
    const ltNext = stride * 2 + next
    const rtNext = stride * 3 + next

    indices.push(lb, lbNext, lt)
    indices.push(lt, lbNext, ltNext)

    indices.push(rbNext, rb, rt)
    indices.push(rt, rb, rtNext)

    indices.push(lt, ltNext, rt)
    indices.push(rt, ltNext, rtNext)

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

function rebuildWallGroup(group: THREE.Group, definition: WallDynamicMesh, options: WallRenderOptions = {}) {
  clearGroupContent(group)

  const path = collectWallPath(definition)
  if (!path) {
    return
  }

  const firstSegment = Array.isArray(definition.segments) ? definition.segments[0] : null
  const width = Math.max(
    WALL_MIN_WIDTH,
    Number.isFinite(firstSegment?.width ?? Number.NaN)
      ? firstSegment!.width ?? WALL_DEFAULT_WIDTH
      : WALL_DEFAULT_WIDTH,
  )
  const height = Math.max(
    WALL_MIN_HEIGHT,
    Number.isFinite(firstSegment?.height ?? Number.NaN)
      ? firstSegment!.height ?? WALL_DEFAULT_HEIGHT
      : WALL_DEFAULT_HEIGHT,
  )

  const smoothing = normalizeWallSmoothing(options.smoothing)
  const tension = Math.max(0, Math.min(1, 1 - smoothing))
  const curve = createWallCurve(path.points, path.closed, tension)
  const geometry = buildWallGeometry(curve, width, height, path.closed)
  if (!geometry) {
    return
  }

  const mesh = new THREE.Mesh(geometry, createWallMaterial())
  mesh.name = 'WallMesh'
  mesh.userData.dynamicMeshType = 'Wall'
  const rawMaterialId = typeof options.materialConfigId === 'string' ? options.materialConfigId.trim() : ''
  mesh.userData[MATERIAL_CONFIG_ID_KEY] = rawMaterialId || null
  group.add(mesh)
}

export function createWallRenderGroup(
  definition: WallDynamicMesh,
  _assets: WallRenderAssetObjects = {},
  options: WallRenderOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'WallGroup'
  group.userData.dynamicMeshType = 'Wall'

  rebuildWallGroup(group, definition, options)
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
  rebuildWallGroup(group, definition, options)
  return true
}
