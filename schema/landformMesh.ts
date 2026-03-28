import * as THREE from 'three'
import type { LandformDynamicMesh, Vector2Like, Vector3Like } from './index'
import { MATERIAL_CONFIG_ID_KEY } from './material'

const LANDFORM_DEFAULT_COLOR = 0xffffff
const LANDFORM_SURFACE_Y_OFFSET = 0.1
const LANDFORM_RENDER_ORDER = 8
const LANDFORM_CONTENT_GROUP = '__LandformContent'
const LANDFORM_MESH_NAME = '__LandformSurface'

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
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  material.name = 'LandformMaterial'
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
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index]!
    uvs[index * 2] = vertex.x / uvScale.x
    uvs[index * 2 + 1] = vertex.z / uvScale.y
  }
  return uvs
}

function buildLandformGeometry(definition: LandformDynamicMesh): THREE.BufferGeometry | null {
  const vertices = Array.isArray(definition.surfaceVertices)
    ? definition.surfaceVertices.map((entry) => toFiniteVector3(entry)).filter((entry): entry is THREE.Vector3 => Boolean(entry))
    : []
  const indices = Array.isArray(definition.surfaceIndices)
    ? definition.surfaceIndices.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry >= 0)
    : []

  if (vertices.length < 3 || indices.length < 3) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(vertices.length * 3)
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index]!
    const offset = index * 3
    positions[offset] = vertex.x
    positions[offset + 1] = vertex.y
    positions[offset + 2] = vertex.z
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const typedIndices = vertices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)
  geometry.setIndex(new THREE.BufferAttribute(typedIndices, 1))

  const uvScale = resolveUvScale(definition.uvScale)
  const providedUvs = Array.isArray(definition.surfaceUvs)
    ? definition.surfaceUvs.map((entry) => toFiniteVector2(entry)).filter((entry): entry is THREE.Vector2 => Boolean(entry))
    : []
  if (providedUvs.length === vertices.length) {
    const uvs = new Float32Array(vertices.length * 2)
    for (let index = 0; index < providedUvs.length; index += 1) {
      const uv = providedUvs[index]!
      uvs[index * 2] = uv.x
      uvs[index * 2 + 1] = uv.y
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  } else {
    geometry.setAttribute('uv', new THREE.BufferAttribute(buildFallbackUvs(vertices, uvScale), 2))
  }

  const providedFeather = Array.isArray(definition.surfaceFeather) ? definition.surfaceFeather : []
  const feather = new Float32Array(vertices.length)
  for (let index = 0; index < vertices.length; index += 1) {
    const value = Number(providedFeather[index])
    feather[index] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
  }
  geometry.setAttribute('landformFeather', new THREE.BufferAttribute(feather, 1))

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function rebuildLandformGroup(group: THREE.Group, definition: LandformDynamicMesh, materialTemplate: THREE.MeshStandardMaterial): boolean {
  const content = ensureLandformContentGroup(group)
  const previousChildren = [...content.children]
  previousChildren.forEach((child) => child.removeFromParent())
  previousChildren.forEach((child) => disposeObject3D(child))

  const geometry = buildLandformGeometry(definition)
  if (!geometry) {
    return false
  }

  const mesh = new THREE.Mesh(geometry, materialTemplate.clone())
  mesh.name = LANDFORM_MESH_NAME
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.renderOrder = LANDFORM_RENDER_ORDER
  mesh.userData = {
    ...(mesh.userData ?? {}),
    [MATERIAL_CONFIG_ID_KEY]: normalizeMaterialConfigId(definition.materialConfigId),
    landformSurface: true,
  }
  content.add(mesh)
  return true
}

export function createLandformRenderGroup(definition: LandformDynamicMesh): THREE.Group {
  const root = new THREE.Group()
  root.name = 'Landform'
  rebuildLandformGroup(root, definition, createLandformMaterial())
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
  return rebuildLandformGroup(group, definition, createLandformMaterial())
}

export function applyLandformFeatherMaterial(material: THREE.Material | null | undefined): THREE.Material | null {
  if (!material || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    return material ?? null
  }
  const clone = (material as THREE.MeshStandardMaterial).clone()
  clone.transparent = true
  clone.depthWrite = false
  clone.polygonOffset = true
  clone.polygonOffsetFactor = -2
  clone.polygonOffsetUnits = -2
  clone.alphaTest = Math.max(clone.alphaTest ?? 0, 0.001)
  const originalOnBeforeCompile = clone.onBeforeCompile
  clone.onBeforeCompile = (shader, renderer) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float landformFeather;\nvarying float vLandformFeather;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandformFeather = landformFeather;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLandformFeather;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * clamp(vLandformFeather, 0.0, 1.0) );')
    originalOnBeforeCompile?.(shader, renderer)
  }
  const originalKey = clone.customProgramCacheKey?.bind(clone)
  clone.customProgramCacheKey = () => `${originalKey ? originalKey() : 'landform'}|landform-feather-v1`
  clone.needsUpdate = true
  return clone
}