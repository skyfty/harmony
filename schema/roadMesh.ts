import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MATERIAL_CONFIG_ID_KEY } from './material'

export type RoadRenderAssetObjects = {
  bodyObject?: THREE.Object3D | null
}

export type RoadJunctionSmoothingOptions = {
  junctionSmoothing?: number
  /** Optional node material selector id (editor-defined). */
  materialConfigId?: string | null
}

const DEFAULT_COLOR = 0x4b4f55

// Lift the road surface slightly above the ground plane to avoid z-fighting.
const ROAD_SURFACE_Y_OFFSET = 0.01

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      const geometry = mesh.geometry
      if (geometry) {
        geometry.dispose()
      }
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry: THREE.Material) => entry.dispose())
      } else if (material) {
        material.dispose()
      }
    }
  })
}

function createSegmentMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR,
    metalness: 0,
    roughness: 0.92,
  })
  material.name = 'RoadMaterial'
  material.side = THREE.DoubleSide
  return material
}

type RoadVertexJunctionInfo = {
  neighbors: Set<number>
}

function clampJunctionSmoothing(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    return 0
  }
  return Math.min(1, Math.max(0, num))
}

function buildRoundedPolygonShape(points: THREE.Vector3[], cornerRadius: number): THREE.Shape | null {
  if (!Array.isArray(points) || points.length < 3) {
    return null
  }

  const pts = points.map((p) => new THREE.Vector2(Number(p.x), Number(p.z)))
  const n = pts.length
  if (n < 3) {
    return null
  }

  const radius = Number.isFinite(cornerRadius) ? Math.max(0, cornerRadius) : 0

  if (radius <= 1e-6) {
    const shape = new THREE.Shape()
    shape.moveTo(pts[0]!.x, pts[0]!.y)
    for (let i = 1; i < n; i += 1) {
      shape.lineTo(pts[i]!.x, pts[i]!.y)
    }
    shape.closePath()
    return shape
  }

  type Corner = { corner: THREE.Vector2; inPt: THREE.Vector2; outPt: THREE.Vector2 }
  const corners: Corner[] = []
  const tmpA = new THREE.Vector2()
  const tmpB = new THREE.Vector2()

  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - 1 + n) % n]!
    const curr = pts[i]!
    const next = pts[(i + 1) % n]!

    tmpA.copy(prev).sub(curr)
    tmpB.copy(next).sub(curr)
    const lenA = tmpA.length()
    const lenB = tmpB.length()
    if (lenA <= 1e-6 || lenB <= 1e-6) {
      corners.push({ corner: curr, inPt: curr, outPt: curr })
      continue
    }

    tmpA.multiplyScalar(1 / lenA)
    tmpB.multiplyScalar(1 / lenB)
    const d = Math.min(radius, lenA * 0.45, lenB * 0.45)
    const inPt = curr.clone().add(tmpA.clone().multiplyScalar(d))
    const outPt = curr.clone().add(tmpB.clone().multiplyScalar(d))
    corners.push({ corner: curr, inPt, outPt })
  }

  const shape = new THREE.Shape()
  shape.moveTo(corners[0]!.outPt.x, corners[0]!.outPt.y)

  for (let i = 1; i <= n; i += 1) {
    const corner = corners[i % n]!
    shape.lineTo(corner.inPt.x, corner.inPt.y)
    shape.quadraticCurveTo(corner.corner.x, corner.corner.y, corner.outPt.x, corner.outPt.y)
  }

  shape.closePath()
  return shape
}

function collectRoadJunctionInfo(definition: RoadDynamicMesh): Map<number, RoadVertexJunctionInfo> {
  const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
  const segments = Array.isArray(definition.segments) ? definition.segments : []

  const junctions = new Map<number, RoadVertexJunctionInfo>()

  const record = (index: number, neighbor: number) => {
    if (!Number.isFinite(index) || index < 0 || index >= vertices.length) {
      return
    }
    if (!Number.isFinite(neighbor) || neighbor < 0 || neighbor >= vertices.length) {
      return
    }
    const existing = junctions.get(index)
    const info = existing ?? { neighbors: new Set<number>() }
    info.neighbors.add(neighbor)
    if (!existing) {
      junctions.set(index, info)
    }
  }

  segments.forEach((segment) => {
    const a = Math.trunc(Number(segment?.a))
    const b = Math.trunc(Number(segment?.b))
    if (a === b) {
      return
    }
    record(a, b)
    record(b, a)
  })

  return junctions
}

function buildRoadTransitionGeometries(
  definition: RoadDynamicMesh,
  options: RoadJunctionSmoothingOptions = {},
): THREE.BufferGeometry[] {
  const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
  const junctions = collectRoadJunctionInfo(definition)
  if (!junctions.size) {
    return []
  }

  const width = Number.isFinite(definition.width) ? Math.max(1e-3, definition.width) : 2
  const halfWidth = width * 0.5
  const junctionSmoothing = clampJunctionSmoothing(options.junctionSmoothing)
  const cornerRadius = halfWidth * junctionSmoothing

  const geometries: THREE.BufferGeometry[] = []

  junctions.forEach((info, vertexIndex) => {
    if (!info || info.neighbors.size < 2) {
      return
    }
    const vertex = vertices[vertexIndex]
    if (!vertex || vertex.length < 2) {
      return
    }
    const center = new THREE.Vector3(Number(vertex[0]), 0, Number(vertex[1]))

    type OffsetEntry = { left: THREE.Vector3; right: THREE.Vector3; angle: number }
    const offsetEntries: OffsetEntry[] = []
    info.neighbors.forEach((neighborIndex) => {
      const neighbor = vertices[neighborIndex]
      if (!neighbor || neighbor.length < 2) {
        return
      }
      const direction = new THREE.Vector3(neighbor[0] - vertex[0], 0, neighbor[1] - vertex[1])
      const length = direction.length()
      if (length <= ROAD_EPSILON) {
        return
      }
      direction.normalize()
      const perp = new THREE.Vector3(-direction.z, 0, direction.x)
      const left = center.clone().add(perp.clone().multiplyScalar(halfWidth))
      const right = center.clone().sub(perp.clone().multiplyScalar(halfWidth))
      const angle = Math.atan2(perp.z, perp.x)
      offsetEntries.push({ left, right, angle })
    })

    if (offsetEntries.length < 2) {
      return
    }

    const orderedLeft = [...offsetEntries].sort((a, b) => a.angle - b.angle).map((entry) => entry.left)
    const orderedRight = [...offsetEntries].sort((a, b) => a.angle - b.angle).reverse().map((entry) => entry.right)
    const loop = [...orderedLeft, ...orderedRight]
    const cleaned: THREE.Vector3[] = []
    loop.forEach((point) => {
      if (!point) {
        return
      }
      const last = cleaned[cleaned.length - 1]
      if (last && last.distanceToSquared(point) <= 1e-6) {
        return
      }
      cleaned.push(point)
    })
    if (cleaned.length < 3) {
      return
    }

    const shape = buildRoundedPolygonShape(cleaned, cornerRadius)
    if (!shape) {
      return
    }

    const geometry = new THREE.ShapeGeometry(shape)
    geometry.rotateX(Math.PI / 2)
    geometries.push(geometry)
  })

  return geometries
}

function buildRoadSegmentGeometries(definition: RoadDynamicMesh): THREE.BufferGeometry[] {
  const geometries: THREE.BufferGeometry[] = []
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)

  forEachRoadSegment(definition, ({ start, end, width }) => {
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length <= ROAD_EPSILON) {
      return
    }

    const geometry = new THREE.PlaneGeometry(length, width)
    geometry.rotateX(-Math.PI / 2)

    position.copy(start).add(end).multiplyScalar(0.5)
    quaternion.copy(directionToQuaternionFromXAxis(new THREE.Vector3(direction.x, 0, direction.z)))

    const matrix = new THREE.Matrix4().compose(position, quaternion, scale)
    geometry.applyMatrix4(matrix)
    geometries.push(geometry)
  })

  return geometries
}

function buildMergedRoadSurfaceGeometry(
  definition: RoadDynamicMesh,
  options: RoadJunctionSmoothingOptions = {},
): THREE.BufferGeometry | null {
  const segmentGeometries = buildRoadSegmentGeometries(definition)
  const transitionGeometries = buildRoadTransitionGeometries(definition, options)
  const all = [...segmentGeometries, ...transitionGeometries]
  if (!all.length) {
    return null
  }

  const merged = mergeGeometries(all, false)
  all.forEach((g) => g.dispose())
  if (!merged) {
    return null
  }
  merged.computeVertexNormals()
  return merged
}

const ROAD_EPSILON = 1e-6

function directionToQuaternionFromXAxis(direction: THREE.Vector3): THREE.Quaternion {
  const base = new THREE.Vector3(1, 0, 0)
  const target = direction.clone().normalize()
  if (target.lengthSq() < ROAD_EPSILON) {
    return new THREE.Quaternion()
  }
  return new THREE.Quaternion().setFromUnitVectors(base, target)
}

function forEachRoadSegment(
  definition: RoadDynamicMesh,
  visit: (
    segment: { start: THREE.Vector3; end: THREE.Vector3; width: number },
    index: number,
  ) => void,
): void {
  const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
  const segments = Array.isArray(definition.segments) ? definition.segments : []
  const width = Number.isFinite(definition.width) ? Math.max(1e-3, definition.width) : 2

  segments.forEach((segment, index) => {
    const a = vertices[segment.a]
    const b = vertices[segment.b]
    if (!a || !b || a.length < 2 || b.length < 2) {
      return
    }
    const start = new THREE.Vector3(a[0] ?? 0, 0, a[1] ?? 0)
    const end = new THREE.Vector3(b[0] ?? 0, 0, b[1] ?? 0)
    if (start.distanceToSquared(end) <= ROAD_EPSILON) {
      return
    }
    visit({ start, end, width }, index)
  })
}

function rebuildRoadGroup(group: THREE.Group, definition: RoadDynamicMesh, options: RoadJunctionSmoothingOptions = {}) {
  disposeObject3D(group)
  group.clear()

  const geometry = buildMergedRoadSurfaceGeometry(definition, options)
  if (!geometry) {
    return
  }

  const material = createSegmentMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'RoadSurface'
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.userData[MATERIAL_CONFIG_ID_KEY] = typeof options.materialConfigId === 'string' && options.materialConfigId.trim().length
    ? options.materialConfigId
    : null
  group.add(mesh)
}

function ensureRoadContentGroup(root: THREE.Group): THREE.Group {
  const existing = root.getObjectByName('__RoadContent')
  if (existing && (existing as THREE.Group).isGroup) {
    return existing as THREE.Group
  }

  const content = new THREE.Group()
  content.name = '__RoadContent'
  content.position.y = ROAD_SURFACE_Y_OFFSET
  root.add(content)
  return content
}

function collectInstancableMeshes(object: THREE.Object3D): Array<THREE.Mesh> {
  const meshes: Array<THREE.Mesh> = []
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh || !(mesh as unknown as { isMesh?: boolean }).isMesh) {
      return
    }
    if (!mesh.geometry || !mesh.material) {
      return
    }
    meshes.push(mesh)
  })
  return meshes
}

function computeObjectBounds(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  box.setFromObject(object)
  return box
}

function buildInstancedMeshesFromTemplate(
  templateObject: THREE.Object3D,
  instanceMatrices: THREE.Matrix4[],
  options: { namePrefix: string },
): THREE.Group | null {
  const templates = collectInstancableMeshes(templateObject)
  if (!templates.length || !instanceMatrices.length) {
    return null
  }

  const group = new THREE.Group()
  group.name = options.namePrefix

  templates.forEach((template, index) => {
    const instanced = new THREE.InstancedMesh(template.geometry, template.material as any, instanceMatrices.length)
    instanced.name = `${options.namePrefix}_${index + 1}`
    instanced.castShadow = template.castShadow
    instanced.receiveShadow = template.receiveShadow
    // For road bodies, instanceId aligns with segment index.
    instanced.userData.roadSegmentIndexMode = 'instanceId'
    for (let i = 0; i < instanceMatrices.length; i += 1) {
      instanced.setMatrixAt(i, instanceMatrices[i]!)
    }
    instanced.instanceMatrix.needsUpdate = true
    group.add(instanced)
  })

  return group
}

function computeRoadBodyInstanceMatrices(definition: RoadDynamicMesh, templateObject: THREE.Object3D): THREE.Matrix4[] {
  const bounds = computeObjectBounds(templateObject)
  const baseLength = Math.max(Math.abs(bounds.max.x - bounds.min.x), 1e-3)
  const baseWidth = Math.max(
    Math.max(Math.abs(bounds.max.z - bounds.min.z), Math.abs(bounds.max.y - bounds.min.y)),
    1e-3,
  )

  const matrices: THREE.Matrix4[] = []
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()

  forEachRoadSegment(definition, ({ start, end, width }) => {
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length <= ROAD_EPSILON) {
      return
    }

    const quaternion = directionToQuaternionFromXAxis(new THREE.Vector3(direction.x, 0, direction.z))
    position.copy(start).add(end).multiplyScalar(0.5)
    scale.set(length / baseLength, 1, width / baseWidth)

    const matrix = new THREE.Matrix4().compose(position, quaternion, scale)
    matrices.push(matrix)
  })

  return matrices
}

export function createRoadRenderGroup(
  definition: RoadDynamicMesh,
  assets: RoadRenderAssetObjects = {},
  options: RoadJunctionSmoothingOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'RoadGroup'
  group.userData.dynamicMeshType = 'Road'

  const content = ensureRoadContentGroup(group)

  let hasInstances = false
  if (assets.bodyObject) {
    const matrices = computeRoadBodyInstanceMatrices(definition, assets.bodyObject)
    const instancedGroup = buildInstancedMeshesFromTemplate(assets.bodyObject, matrices, { namePrefix: 'RoadBody' })
    if (instancedGroup) {
      hasInstances = true
      content.add(instancedGroup)
    }
  }

  if (!hasInstances) {
    rebuildRoadGroup(content, definition, options)
  } else {
    // Even when using asset instances, add a merged transition mesh so gaps at junctions are filled.
    const transitionGeometries = buildRoadTransitionGeometries(definition, options)
    if (transitionGeometries.length) {
      const merged = mergeGeometries(transitionGeometries, false)
      transitionGeometries.forEach((g) => g.dispose())
      if (merged) {
        merged.computeVertexNormals()
        const material = createSegmentMaterial()
        const mesh = new THREE.Mesh(merged, material)
        mesh.name = 'RoadTransitions'
        mesh.castShadow = false
        mesh.receiveShadow = true
        mesh.userData[MATERIAL_CONFIG_ID_KEY] = typeof options.materialConfigId === 'string' && options.materialConfigId.trim().length
          ? options.materialConfigId
          : null
        content.add(mesh)
      }
    }
  }

  return group
}

export function createRoadGroup(definition: RoadDynamicMesh, options: RoadJunctionSmoothingOptions = {}): THREE.Group {
  const group = new THREE.Group()
  group.name = 'RoadGroup'
  group.userData.dynamicMeshType = 'Road'
  const content = ensureRoadContentGroup(group)
  rebuildRoadGroup(content, definition, options)
  return group
}

export function updateRoadGroup(
  object: THREE.Object3D,
  definition: RoadDynamicMesh,
  options: RoadJunctionSmoothingOptions = {},
): boolean {
  const group = object as THREE.Group
  if (!group || !group.isGroup) {
    return false
  }

  const content = ensureRoadContentGroup(group)
  rebuildRoadGroup(content, definition, options)
  return true
}
