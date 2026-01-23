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

function normalizeMaterialConfigId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.length ? raw : null
}

function resolveFloorMaterialConfigIds(definition: FloorDynamicMesh): { topBottom: string | null; side: string | null } {
  const topBottom = normalizeMaterialConfigId(definition.topBottomMaterialConfigId)
  const side = normalizeMaterialConfigId(definition.sideMaterialConfigId) ?? topBottom
  return { topBottom, side }
}

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

function clampFloorThickness(value: unknown): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (raw <= 0) {
    return 0
  }
  // Keep parity with editor-side constraints (0–10m).
  return Math.min(10, raw)
}

function resolveSideUvScale(value: unknown): { u: number; v: number } {
  const source = value as { x?: unknown; y?: unknown } | null | undefined
  const rawU = typeof source?.x === 'number' && Number.isFinite(source.x) ? Number(source.x) : 1
  const rawV = typeof source?.y === 'number' && Number.isFinite(source.y) ? Number(source.y) : 1
  return {
    u: Math.max(0, rawU),
    v: Math.max(0, rawV),
  }
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

function buildFloorShape(definition: FloorDynamicMesh): { shape: THREE.Shape; points: THREE.Vector2[] } | null {
  const vertices = sanitizeVertices(definition.vertices)
  if (vertices.length < 3) {
    return null
  }

  // THREE.Shape expects a non-self-intersecting contour.
  // Build the shape in XY, but map world (x,z) -> shape (x,-z) so that after
  // rotateX(-PI/2) the geometry ends up on XZ with the original +Z direction.
  const points = vertices.map(([x, z]) => new THREE.Vector2(x, -z))

  const shape = createFloorShapeFromPolygon(points, clampFloorSmooth(definition.smooth))
  return { shape, points }
}

function buildPlanarUvAttribute(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position || position.count <= 0) {
    return
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }

  const sizeX = Math.max(maxX - minX, FLOOR_EPSILON)
  const sizeZ = Math.max(maxZ - minZ, FLOOR_EPSILON)
  const uvs = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    uvs[i * 2] = (x - minX) / sizeX
    uvs[i * 2 + 1] = (z - minZ) / sizeZ
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
}

function buildFlatNormalAttribute(count: number, y: number): THREE.BufferAttribute {
  const normals = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    normals[i * 3] = 0
    normals[i * 3 + 1] = y
    normals[i * 3 + 2] = 0
  }
  return new THREE.BufferAttribute(normals, 3)
}

function mergeNonIndexedGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const valid = geometries.filter((g) => {
    const position = g.getAttribute('position') as THREE.BufferAttribute | undefined
    return !!position && position.count > 0
  })
  if (!valid.length) {
    return new THREE.BufferGeometry()
  }

  const attributes = ['position', 'normal', 'uv'] as const
  const totals: Record<(typeof attributes)[number], number> = { position: 0, normal: 0, uv: 0 }

  valid.forEach((g) => {
    attributes.forEach((name) => {
      const attr = g.getAttribute(name) as THREE.BufferAttribute | undefined
      if (!attr) {
        return
      }
      totals[name] = (totals[name] ?? 0) + attr.array.length
    })
  })

  const merged = new THREE.BufferGeometry()
  attributes.forEach((name) => {
    const total = totals[name]
    if (!total) {
      return
    }
    const firstAttr = valid.find((g) => !!g.getAttribute(name))!.getAttribute(name) as THREE.BufferAttribute
    const array = new Float32Array(total)
    let offset = 0
    valid.forEach((g) => {
      const attr = g.getAttribute(name) as THREE.BufferAttribute | undefined
      if (!attr) {
        return
      }
      array.set(attr.array as Float32Array, offset)
      offset += attr.array.length
    })
    merged.setAttribute(name, new THREE.BufferAttribute(array, firstAttr.itemSize))
  })

  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function buildFloorTopBottomGeometry(definition: FloorDynamicMesh, shape: THREE.Shape): THREE.BufferGeometry | null {
  const thickness = clampFloorThickness((definition as any).thickness)

  // Flat floors: single surface mesh.
  if (thickness <= FLOOR_EPSILON) {
    const geometry = new THREE.ShapeGeometry(shape).toNonIndexed()
    geometry.rotateX(-Math.PI / 2)
    buildPlanarUvAttribute(geometry)

    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    geometry.setAttribute('normal', buildFlatNormalAttribute(position.count, 1))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }

  // Thickness > 0: top + bottom faces.
  const base = new THREE.ShapeGeometry(shape).toNonIndexed()
  base.rotateX(-Math.PI / 2)
  buildPlanarUvAttribute(base)
  const basePos = base.getAttribute('position') as THREE.BufferAttribute
  // Bottom face at y=0 (points down).
  base.setAttribute('normal', buildFlatNormalAttribute(basePos.count, -1))

  const top = base.clone()
  top.translate(0, thickness, 0)
  const topPos = top.getAttribute('position') as THREE.BufferAttribute
  top.setAttribute('normal', buildFlatNormalAttribute(topPos.count, 1))

  const merged = mergeNonIndexedGeometries([base, top])
  base.dispose()
  top.dispose()
  return merged
}

function computePolygonAreaXZ(points: Array<{ x: number; z: number }>): number {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    area += a.x * b.z - b.x * a.z
  }
  return area * 0.5
}

function buildFloorSideGeometry(definition: FloorDynamicMesh, shape: THREE.Shape, fallback: THREE.Vector2[]): THREE.BufferGeometry | null {
  const thickness = clampFloorThickness((definition as any).thickness)
  if (thickness <= FLOOR_EPSILON) {
    return null
  }

  const sideUvScale = resolveSideUvScale((definition as any).sideUvScale)

  const extracted = shape.extractPoints(96)
  const raw = Array.isArray(extracted?.shape) && extracted.shape.length ? extracted.shape : fallback

  // Cleanup & de-duplicate.
  const outline2: THREE.Vector2[] = []
  raw.forEach((p) => {
    if (!p) {
      return
    }
    const x = Number(p.x)
    const y = Number(p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }
    const prev = outline2[outline2.length - 1]
    if (prev && prev.distanceToSquared(p) <= FLOOR_EPSILON) {
      return
    }
    outline2.push(new THREE.Vector2(x, y))
  })
  if (outline2.length >= 2) {
    const first = outline2[0]!
    const last = outline2[outline2.length - 1]!
    if (first.distanceToSquared(last) <= FLOOR_EPSILON) {
      outline2.pop()
    }
  }
  if (outline2.length < 2) {
    return null
  }

  const outlineWorld = outline2.map((p) => ({ x: p.x, z: -p.y }))
  const isCcw = computePolygonAreaXZ(outlineWorld) > 0

  // Build non-indexed side wall triangles.
  const positions: number[] = []
  const uvs: number[] = []

  let s = 0
  for (let i = 0; i < outlineWorld.length; i += 1) {
    const a = outlineWorld[i]!
    const b = outlineWorld[(i + 1) % outlineWorld.length]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const segLen = Math.hypot(dx, dz)
    if (segLen <= FLOOR_EPSILON) {
      continue
    }

    const sA = s
    const sB = s + segLen
    s = sB

    // Quad corners.
    const bottomA = { x: a.x, y: 0, z: a.z }
    const topA = { x: a.x, y: thickness, z: a.z }
    const bottomB = { x: b.x, y: 0, z: b.z }
    const topB = { x: b.x, y: thickness, z: b.z }

    const pushVertex = (v: { x: number; y: number; z: number }, u: number, vv: number) => {
      positions.push(v.x, v.y, v.z)
      uvs.push(u, vv)
    }

    const uA = sA * sideUvScale.u
    const uB = sB * sideUvScale.u
    const v0 = 0 * sideUvScale.v
    const v1 = thickness * sideUvScale.v

    if (isCcw) {
      // Outward normals for CCW contour.
      pushVertex(bottomA, uA, v0)
      pushVertex(topB, uB, v1)
      pushVertex(bottomB, uB, v0)

      pushVertex(bottomA, uA, v0)
      pushVertex(topA, uA, v1)
      pushVertex(topB, uB, v1)
    } else {
      // Outward normals for CW contour.
      pushVertex(bottomA, uA, v0)
      pushVertex(bottomB, uB, v0)
      pushVertex(topB, uB, v1)

      pushVertex(bottomA, uA, v0)
      pushVertex(topB, uB, v1)
      pushVertex(topA, uA, v1)
    }
  }

  if (!positions.length) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function rebuildFloorGroup(group: THREE.Group, definition: FloorDynamicMesh, materialTemplate: THREE.MeshStandardMaterial) {
  disposeObject3D(group)
  group.clear()

  const shapeInfo = buildFloorShape(definition)
  if (!shapeInfo) {
    return
  }

  const { topBottom, side } = resolveFloorMaterialConfigIds(definition)

  const topBottomGeometry = buildFloorTopBottomGeometry(definition, shapeInfo.shape)
  if (!topBottomGeometry) {
    return
  }

  const topBottomMesh = new THREE.Mesh(topBottomGeometry, materialTemplate.clone())
  topBottomMesh.name = 'FloorTopBottomMesh'
  topBottomMesh.castShadow = false
  topBottomMesh.receiveShadow = true
  topBottomMesh.userData[MATERIAL_CONFIG_ID_KEY] = topBottom
  group.add(topBottomMesh)

  const sideGeometry = buildFloorSideGeometry(definition, shapeInfo.shape, shapeInfo.points)
  if (sideGeometry) {
    const sideMesh = new THREE.Mesh(sideGeometry, materialTemplate.clone())
    sideMesh.name = 'FloorSideMesh'
    sideMesh.castShadow = false
    sideMesh.receiveShadow = true
    sideMesh.userData[MATERIAL_CONFIG_ID_KEY] = side
    group.add(sideMesh)
  }
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
  const shapeInfo = buildFloorShape(definition)
  if (!shapeInfo) {
    return []
  }

  const geometry = buildFloorTopBottomGeometry(definition, shapeInfo.shape)
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
      const { topBottom } = resolveFloorMaterialConfigIds(definition)
      mesh.userData[MATERIAL_CONFIG_ID_KEY] = topBottom
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
