import * as THREE from 'three'
import type { FloorDynamicMesh } from '@harmony/schema'
import { MATERIAL_CONFIG_ID_KEY } from './material'

export type FloorRenderAssetObjects = {
  bodyObject?: THREE.Object3D | null
}

const DEFAULT_COLOR = 0x4b4f55

// Lift the floor surface slightly above the ground plane to avoid z-fighting.
const FLOOR_SURFACE_Y_OFFSET = 0.01

const FLOOR_EPSILON = 1e-6
const FLOOR_CORNER_EPSILON = 1e-8

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

function createFloorMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR,
    metalness: 0,
    roughness: 0.92,
  })
  material.name = 'FloorMaterial'
  material.side = THREE.DoubleSide
  return material
}

function ensureFloorContentGroup(root: THREE.Group): THREE.Group {
  const existing = root.getObjectByName('__FloorContent')
  if (existing && (existing as THREE.Group).isGroup) {
    return existing as THREE.Group
  }

  const content = new THREE.Group()
  content.name = '__FloorContent'
  content.position.y = FLOOR_SURFACE_Y_OFFSET
  root.add(content)
  return content
}

function sanitizeVertices(vertices: unknown): Array<[number, number]> {
  if (!Array.isArray(vertices)) {
    return []
  }
  const out: Array<[number, number]> = []
  for (const entry of vertices) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue
    }
    const x = Number(entry[0])
    const z = Number(entry[1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    const prev = out[out.length - 1]
    if (prev) {
      const dx = x - prev[0]
      const dz = z - prev[1]
      if (dx * dx + dz * dz <= FLOOR_EPSILON) {
        continue
      }
    }
    out.push([x, z])
  }

  // Drop a closing vertex if user duplicated the first point.
  if (out.length >= 3) {
    const first = out[0]!
    const last = out[out.length - 1]!
    const dx = first[0] - last[0]
    const dz = first[1] - last[1]
    if (dx * dx + dz * dz <= FLOOR_EPSILON) {
      out.pop()
    }
  }

  return out
}

function clampFloorSmooth(value: unknown): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (raw <= 0) {
    return 0
  }
  if (raw >= 1) {
    return 1
  }
  return raw
}

function createFloorShapeFromPolygon(points: THREE.Vector2[], smooth: number): THREE.Shape {
  const shape = new THREE.Shape()
  if (!points.length) {
    return shape
  }

  if (smooth <= Number.EPSILON) {
    shape.moveTo(points[0]!.x, points[0]!.y)
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i]!.x, points[i]!.y)
    }
    shape.closePath()
    return shape
  }

  type CornerInfo = {
    vertex: THREE.Vector2
    enter: THREE.Vector2
    exit: THREE.Vector2
  }

  const cornerInfos: CornerInfo[] = points.map((vertex, index) => {
    const prev = points[(index - 1 + points.length) % points.length]!
    const next = points[(index + 1) % points.length]!
    const directionToPrev = prev.clone().sub(vertex)
    const directionToNext = next.clone().sub(vertex)
    const lenPrev = directionToPrev.length()
    const lenNext = directionToNext.length()

    if (lenPrev <= FLOOR_EPSILON || lenNext <= FLOOR_EPSILON) {
      return {
        vertex: vertex.clone(),
        enter: vertex.clone(),
        exit: vertex.clone(),
      }
    }

    const maxOffset = Math.min(lenPrev, lenNext) * 0.5
    const radius = smooth * maxOffset
    if (radius <= FLOOR_EPSILON) {
      return {
        vertex: vertex.clone(),
        enter: vertex.clone(),
        exit: vertex.clone(),
      }
    }

    const enter = vertex.clone()
      .add(directionToPrev.clone().normalize().multiplyScalar(radius))
    const exit = vertex.clone()
      .add(directionToNext.clone().normalize().multiplyScalar(radius))

    return {
      vertex: vertex.clone(),
      enter,
      exit,
    }
  })

  shape.moveTo(cornerInfos[0]!.enter.x, cornerInfos[0]!.enter.y)
  for (let i = 0; i < cornerInfos.length; i += 1) {
    const current = cornerInfos[i]!
    const next = cornerInfos[(i + 1) % cornerInfos.length]!
    shape.quadraticCurveTo(current.vertex.x, current.vertex.y, current.exit.x, current.exit.y)
    if (current.exit.distanceToSquared(next.enter) > FLOOR_CORNER_EPSILON) {
      shape.lineTo(next.enter.x, next.enter.y)
    }
  }
  shape.closePath()
  return shape
}

function isPolygonAreaPositive(vertices: Array<[number, number]>): boolean {
  // Signed area (shoelace). Positive => CCW.
  let sum = 0
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i]!
    const b = vertices[(i + 1) % vertices.length]!
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum >= 0
}

function buildFloorGeometry(definition: FloorDynamicMesh): THREE.BufferGeometry | null {
  const vertices = sanitizeVertices(definition.vertices)
  if (vertices.length < 3) {
    return null
  }

  // THREE.Shape expects a non-self-intersecting contour.
  const points = vertices.map(([x, z]) => new THREE.Vector2(x, z))

  // Ensure consistent winding (CCW) so normals face +Y after rotation.
  if (!isPolygonAreaPositive(vertices)) {
    points.reverse()
  }

  const shape = createFloorShapeFromPolygon(points, clampFloorSmooth(definition.smooth))
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function rebuildFloorGroup(group: THREE.Group, definition: FloorDynamicMesh, materialTemplate: THREE.MeshStandardMaterial) {
  disposeObject3D(group)
  group.clear()

  const geometry = buildFloorGeometry(definition)
  if (!geometry) {
    return
  }

  const mesh = new THREE.Mesh(geometry, materialTemplate.clone())
  mesh.name = 'FloorMesh'
  mesh.castShadow = false
  mesh.receiveShadow = true

  const rawMaterialId = typeof definition.materialId === 'string' ? definition.materialId.trim() : ''
  const materialId = rawMaterialId || null
  mesh.userData[MATERIAL_CONFIG_ID_KEY] = materialId

  group.add(mesh)
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
    for (let i = 0; i < instanceMatrices.length; i += 1) {
      instanced.setMatrixAt(i, instanceMatrices[i]!)
    }
    instanced.instanceMatrix.needsUpdate = true
    group.add(instanced)
  })

  return group
}

function computeFloorBodyInstanceMatrices(definition: FloorDynamicMesh, templateObject: THREE.Object3D): THREE.Matrix4[] {
  // For now, a floor is a single polygon; if an asset body is supplied, we just place 1 instance at origin.
  // This keeps parity with createRoadRenderGroup signature without adding new UX.
  const geometry = buildFloorGeometry(definition)
  if (!geometry) {
    return []
  }
  geometry.computeBoundingBox()
  const bounds = computeObjectBounds(templateObject)
  const baseSizeX = Math.max(Math.abs(bounds.max.x - bounds.min.x), 1e-3)
  const baseSizeZ = Math.max(Math.abs(bounds.max.z - bounds.min.z), 1e-3)

  const geomBox = geometry.boundingBox
  geometry.dispose()

  if (!geomBox) {
    return []
  }
  const sizeX = Math.max(Math.abs(geomBox.max.x - geomBox.min.x), 1e-3)
  const sizeZ = Math.max(Math.abs(geomBox.max.z - geomBox.min.z), 1e-3)

  const scale = new THREE.Vector3(sizeX / baseSizeX, 1, sizeZ / baseSizeZ)
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), scale)
  return [matrix]
}

export function createFloorRenderGroup(definition: FloorDynamicMesh, assets: FloorRenderAssetObjects = {}): THREE.Group {
  const group = new THREE.Group()
  group.name = 'FloorGroup'
  group.userData.dynamicMeshType = 'Floor'

  const content = ensureFloorContentGroup(group)

  let hasInstances = false
  if (assets.bodyObject) {
    const matrices = computeFloorBodyInstanceMatrices(definition, assets.bodyObject)
    const instancedGroup = buildInstancedMeshesFromTemplate(assets.bodyObject, matrices, { namePrefix: 'FloorBody' })
    if (instancedGroup) {
      hasInstances = true
      content.add(instancedGroup)
    }
  }

  if (!hasInstances) {
    rebuildFloorGroup(content, definition, createFloorMaterial())
  } else {
    // Tag instances for material selection (apply on traversal in sceneGraph).
    content.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh & { isMesh?: boolean }
      if (!mesh?.isMesh) {
        return
      }
      const rawMaterialId = typeof definition.materialId === 'string' ? definition.materialId.trim() : ''
      const materialId = rawMaterialId || null
      mesh.userData[MATERIAL_CONFIG_ID_KEY] = materialId
    })
  }

  return group
}

export function createFloorGroup(definition: FloorDynamicMesh): THREE.Group {
  const group = new THREE.Group()
  group.name = 'FloorGroup'
  group.userData.dynamicMeshType = 'Floor'
  const content = ensureFloorContentGroup(group)
  rebuildFloorGroup(content, definition, createFloorMaterial())
  return group
}

export function updateFloorGroup(object: THREE.Object3D, definition: FloorDynamicMesh): boolean {
  const group = object as THREE.Group
  if (!group || !group.isGroup) {
    return false
  }

  const content = ensureFloorContentGroup(group)
  rebuildFloorGroup(content, definition, createFloorMaterial())
  return true
}
