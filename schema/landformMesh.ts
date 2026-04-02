import * as THREE from 'three'
import type { LandformDynamicMesh, Vector2Like, Vector3Like } from './index'
import { MATERIAL_CONFIG_ID_KEY, MATERIAL_TEXTURE_REPEAT_INFO_KEY } from './material'
import {
  LANDFORM_SURFACE_POLYGON_OFFSET_FACTOR,
  LANDFORM_SURFACE_POLYGON_OFFSET_UNITS,
  LANDFORM_SURFACE_WORLD_OFFSET,
  LAND_TERRAIN_SURFACE_RENDER_ORDER,
} from './terrainSurfaceLayering'

const LANDFORM_DEFAULT_COLOR = 0xffffff
const LANDFORM_SURFACE_Y_OFFSET = LANDFORM_SURFACE_WORLD_OFFSET
const LANDFORM_RENDER_ORDER = LAND_TERRAIN_SURFACE_RENDER_ORDER
const LANDFORM_CONTENT_GROUP = '__LandformContent'
const LANDFORM_MESH_NAME = '__LandformSurface'
const LANDFORM_FEATHER_PATCHED_FLAG = '__landformFeatherPatched'
const LANDFORM_EDGE_ALPHA_FLOOR = 0.12
const LANDFORM_FEATHER_SHADER_HOOK_INSTALLED = '__landformFeatherShaderHookInstalled'
const LANDFORM_FEATHER_ORIGINAL_ON_BEFORE_COMPILE = '__landformFeatherOriginalOnBeforeCompile'
const LANDFORM_FEATHER_ORIGINAL_PROGRAM_CACHE_KEY = '__landformFeatherOriginalProgramCacheKey'

type LandformGeometryData = {
  positions: Float32Array
  indices: Uint16Array | Uint32Array
  uvs: Float32Array
  feather: Float32Array
}

function enforceLandformFeatherState(material: THREE.MeshStandardMaterial): boolean {
  let changed = false

  if (!material.transparent) {
    material.transparent = true
    changed = true
  }
  if (material.depthWrite) {
    material.depthWrite = false
    changed = true
  }
  if (!material.polygonOffset) {
    material.polygonOffset = true
    changed = true
  }
  if (material.polygonOffsetFactor !== LANDFORM_SURFACE_POLYGON_OFFSET_FACTOR) {
    material.polygonOffsetFactor = LANDFORM_SURFACE_POLYGON_OFFSET_FACTOR
    changed = true
  }
  if (material.polygonOffsetUnits !== LANDFORM_SURFACE_POLYGON_OFFSET_UNITS) {
    material.polygonOffsetUnits = LANDFORM_SURFACE_POLYGON_OFFSET_UNITS
    changed = true
  }

  const minAlphaTest = 0.001
  const normalizedAlphaTest = Math.max(material.alphaTest ?? 0, minAlphaTest)
  if (material.alphaTest !== normalizedAlphaTest) {
    material.alphaTest = normalizedAlphaTest
    changed = true
  }

  if (changed) {
    material.needsUpdate = true
  }

  return changed
}

function ensureLandformFeatherShaderHooks(material: THREE.MeshStandardMaterial): boolean {
  const typed = material as THREE.MeshStandardMaterial & Record<string, unknown>
  if (typed[LANDFORM_FEATHER_SHADER_HOOK_INSTALLED] === true) {
    return false
  }

  const originalOnBeforeCompile = material.onBeforeCompile
  const originalCustomProgramCacheKey = material.customProgramCacheKey
  typed[LANDFORM_FEATHER_ORIGINAL_ON_BEFORE_COMPILE] = originalOnBeforeCompile
  typed[LANDFORM_FEATHER_ORIGINAL_PROGRAM_CACHE_KEY] = originalCustomProgramCacheKey

  material.onBeforeCompile = (shader, renderer) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float landformFeather;\nvarying float vLandformFeather;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandformFeather = landformFeather;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLandformFeather;')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float landformFeatherAlpha = mix(${LANDFORM_EDGE_ALPHA_FLOOR.toFixed(2)}, 1.0, clamp(vLandformFeather, 0.0, 1.0));\nvec4 diffuseColor = vec4( diffuse, opacity * landformFeatherAlpha );`,
      )
    originalOnBeforeCompile?.(shader, renderer)
  }

  material.customProgramCacheKey = () => {
    const originalKey = typeof originalCustomProgramCacheKey === 'function'
      ? originalCustomProgramCacheKey.call(material)
      : 'landform'
    return `${originalKey}|landform-feather-v1`
  }

  typed[LANDFORM_FEATHER_SHADER_HOOK_INSTALLED] = true
  material.needsUpdate = true
  return true
}

function normalizeMaterialConfigId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.length ? raw : null
}

function ensureLandformContentGroup(root: THREE.Group): THREE.Group {
  const existing = root.getObjectByName(LANDFORM_CONTENT_GROUP)
  if (existing && (existing as THREE.Group).isGroup) {
    return existing as THREE.Group
  }
  const content = new THREE.Group()
  content.name = LANDFORM_CONTENT_GROUP
  content.position.y = LANDFORM_SURFACE_Y_OFFSET
  root.add(content)
  return content
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    mesh.geometry?.dispose?.()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

function createLandformMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: LANDFORM_DEFAULT_COLOR,
    metalness: 0,
    roughness: 1.0,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: LANDFORM_SURFACE_POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: LANDFORM_SURFACE_POLYGON_OFFSET_UNITS,
  })
  material.name = 'LandformMaterial'
  material.shadowSide = THREE.FrontSide
  return material
}

function toFiniteVector3(value: Vector3Like | null | undefined): THREE.Vector3 | null {
  if (!value) {
    return null
  }
  const x = Number(value.x)
  const y = Number(value.y)
  const z = Number(value.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null
  }
  return new THREE.Vector3(x, y, z)
}

function toFiniteVector2(value: Vector2Like | null | undefined): THREE.Vector2 | null {
  if (!value) {
    return null
  }
  const x = Number(value.x)
  const y = Number(value.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }
  return new THREE.Vector2(x, y)
}

function resolveUvScale(value: unknown): { x: number; y: number } {
  const source = value as Vector2Like | null | undefined
  const x = typeof source?.x === 'number' && Number.isFinite(source.x) ? Math.max(1e-3, source.x) : 1
  const y = typeof source?.y === 'number' && Number.isFinite(source.y) ? Math.max(1e-3, source.y) : 1
  return { x, y }
}

function buildFallbackUvs(vertices: THREE.Vector3[], uvScale: { x: number; y: number }): Float32Array {
  const uvs = new Float32Array(vertices.length * 2)
  if (vertices.length === 0) {
    return uvs
  }

  // Match the editor-authored UVs: local-space X/Z divided by the configured UV scale.
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index]!
    const u = vertex.x / uvScale.x
    const v = vertex.z / uvScale.y
    uvs[index * 2] = u
    uvs[index * 2 + 1] = v
  }
  return uvs
}

function buildLandformGeometryData(definition: LandformDynamicMesh): LandformGeometryData | null {
  const vertices = Array.isArray(definition.surfaceVertices)
    ? definition.surfaceVertices.map((entry) => toFiniteVector3(entry)).filter((entry): entry is THREE.Vector3 => Boolean(entry))
    : []
  const indices = Array.isArray(definition.surfaceIndices)
    ? definition.surfaceIndices.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry >= 0)
    : []

  if (vertices.length < 3 || indices.length < 3) {
    return null
  }

  const positions = new Float32Array(vertices.length * 3)
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index]!
    const offset = index * 3
    positions[offset] = vertex.x
    positions[offset + 1] = vertex.y
    positions[offset + 2] = vertex.z
  }

  const typedIndices = vertices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)

  const uvScale = resolveUvScale(definition.uvScale)
  const providedUvs = Array.isArray(definition.surfaceUvs)
    ? definition.surfaceUvs.map((entry) => toFiniteVector2(entry)).filter((entry): entry is THREE.Vector2 => Boolean(entry))
    : []
  let uvs: Float32Array
  if (providedUvs.length === vertices.length) {
    uvs = new Float32Array(vertices.length * 2)
    for (let index = 0; index < providedUvs.length; index += 1) {
      const uv = providedUvs[index]!
      uvs[index * 2] = uv.x
      uvs[index * 2 + 1] = uv.y
    }
  } else {
    uvs = buildFallbackUvs(vertices, uvScale)
  }

  const providedFeather = Array.isArray(definition.surfaceFeather) ? definition.surfaceFeather : []
  const feather = new Float32Array(vertices.length)
  for (let index = 0; index < vertices.length; index += 1) {
    const value = Number(providedFeather[index])
    feather[index] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
  }

  return { positions, indices: typedIndices, uvs, feather }
}

function buildLandformGeometry(definition: LandformDynamicMesh): THREE.BufferGeometry | null {
  const geometryData = buildLandformGeometryData(definition)
  if (!geometryData) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(geometryData.positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(geometryData.indices, 1))
  geometry.setAttribute('uv', new THREE.BufferAttribute(geometryData.uvs, 2))
  geometry.setAttribute('landformFeather', new THREE.BufferAttribute(geometryData.feather, 1))

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function updateArrayAttribute(attribute: THREE.BufferAttribute, data: Float32Array | Uint16Array | Uint32Array): boolean {
  if (attribute.array.length !== data.length) {
    return false
  }
  attribute.array.set(data)
  attribute.needsUpdate = true
  return true
}

function canReuseLandformGeometry(geometry: THREE.BufferGeometry, geometryData: LandformGeometryData): boolean {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  const feather = geometry.getAttribute('landformFeather') as THREE.BufferAttribute | undefined
  const index = geometry.getIndex()
  if (!position || !uv || !feather || !index) {
    return false
  }
  if (!(position.array instanceof Float32Array) || !(uv.array instanceof Float32Array) || !(feather.array instanceof Float32Array)) {
    return false
  }
  return position.array.length === geometryData.positions.length
    && uv.array.length === geometryData.uvs.length
    && feather.array.length === geometryData.feather.length
    && index.array.length === geometryData.indices.length
    && index.array.constructor === geometryData.indices.constructor
}

function updateLandformGeometry(geometry: THREE.BufferGeometry, definition: LandformDynamicMesh): boolean {
  const geometryData = buildLandformGeometryData(definition)
  if (!geometryData || !canReuseLandformGeometry(geometry, geometryData)) {
    return false
  }

  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  const feather = geometry.getAttribute('landformFeather') as THREE.BufferAttribute
  const index = geometry.getIndex()!

  updateArrayAttribute(position, geometryData.positions)
  updateArrayAttribute(uv, geometryData.uvs)
  updateArrayAttribute(feather, geometryData.feather)
  updateArrayAttribute(index, geometryData.indices)

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return true
}

function findLandformSurfaceMesh(root: THREE.Group): THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> | null {
  const candidate = root.getObjectByName(LANDFORM_MESH_NAME)
  const mesh = candidate as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> | null
  if (mesh?.isMesh && mesh.geometry) {
    return mesh
  }
  return null
}

function applyLandformMeshState(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
  definition: LandformDynamicMesh,
): void {
  mesh.userData = {
    ...(mesh.userData ?? {}),
    [MATERIAL_CONFIG_ID_KEY]: normalizeMaterialConfigId(definition.materialConfigId),
    [MATERIAL_TEXTURE_REPEAT_INFO_KEY]: {
      uvMetersPerUnit: { x: 1, y: 1 },
      repeatScale: { x: 1, y: 1 },
    },
    landformSurface: true,
  }
}

function configureLandformMesh(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
  definition: LandformDynamicMesh,
): void {
  mesh.name = LANDFORM_MESH_NAME
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.renderOrder = LANDFORM_RENDER_ORDER
  applyLandformMeshState(mesh, definition)
  mesh.onBeforeRender = () => {
    const currentMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(currentMaterial)) {
      mesh.material = currentMaterial.map((entry) => applyLandformFeatherMaterial(entry) ?? entry)
      return
    }
    mesh.material = applyLandformFeatherMaterial(currentMaterial ?? null) ?? (currentMaterial as THREE.Material)
  }
}

function rebuildLandformGroup(group: THREE.Group, definition: LandformDynamicMesh): boolean {
  const content = ensureLandformContentGroup(group)
  const existingMesh = findLandformSurfaceMesh(content)
  if (existingMesh && updateLandformGeometry(existingMesh.geometry, definition)) {
    applyLandformMeshState(existingMesh, definition)
    return true
  }

  const previousChildren = [...content.children]
  previousChildren.forEach((child) => child.removeFromParent())
  previousChildren.forEach((child) => disposeObject3D(child))

  const geometry = buildLandformGeometry(definition)
  if (!geometry) {
    return false
  }

  const baseMaterial = createLandformMaterial()
  const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(
    geometry,
    (applyLandformFeatherMaterial(baseMaterial) ?? baseMaterial) as THREE.Material,
  )
  configureLandformMesh(mesh, definition)
  content.add(mesh)
  return true
}

export function createLandformRenderGroup(definition: LandformDynamicMesh): THREE.Group {
  const root = new THREE.Group()
  root.name = 'Landform'
  rebuildLandformGroup(root, definition)
  return root
}

export function createLandformGroup(definition: LandformDynamicMesh): THREE.Group {
  return createLandformRenderGroup(definition)
}

export function updateLandformGroup(object: THREE.Object3D, definition: LandformDynamicMesh): boolean {
  if (!(object as THREE.Group).isGroup) {
    return false
  }
  const group = object as THREE.Group
  return rebuildLandformGroup(group, definition)
}

export function applyLandformFeatherMaterial(material: THREE.Material | null | undefined): THREE.Material | null {
  if (!material || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    return material ?? null
  }
  if ((material as THREE.Material).userData?.[LANDFORM_FEATHER_PATCHED_FLAG] === true) {
    const patched = material as THREE.MeshStandardMaterial
    enforceLandformFeatherState(patched)
    ensureLandformFeatherShaderHooks(patched)
    return material
  }
  const clone = (material as THREE.MeshStandardMaterial).clone()
  clone.userData = {
    ...(clone.userData ?? {}),
    [LANDFORM_FEATHER_PATCHED_FLAG]: true,
  }
  enforceLandformFeatherState(clone)
  ensureLandformFeatherShaderHooks(clone)
  return clone
}