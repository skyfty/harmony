import * as THREE from 'three'

export const COMPILED_STATIC_MESH_USERDATA_KEY = '__compiledStaticMesh'
export const COMPILED_STATIC_MESH_VERSION = 3

export type CompiledStaticMeshGroup = {
  start: number
  count: number
  materialIndex: number
}

export interface CompiledStaticMeshMetadata {
  version: number
  name?: string
  vertices: number[]
  indices: number[]
  uvs?: number[]
  groups?: CompiledStaticMeshGroup[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function toNumberArray(source: unknown, options: { integer?: boolean; stride?: number; minLength?: number }): number[] {
  const { integer = false, stride, minLength } = options
  if (!Array.isArray(source) && !ArrayBuffer.isView(source)) {
    throw new Error('Compiled static mesh arrays must be numeric arrays.')
  }

  const values = Array.from(source as ArrayLike<number>)
  if (minLength !== undefined && values.length < minLength) {
    throw new Error(`Compiled static mesh array must contain at least ${minLength} numbers.`)
  }
  if (stride && values.length % stride !== 0) {
    throw new Error(`Compiled static mesh array length must be divisible by ${stride}.`)
  }

  return values.map((entry) => {
    const numeric = typeof entry === 'number' ? entry : Number(entry)
    if (!Number.isFinite(numeric)) {
      throw new Error('Compiled static mesh array contains a non-finite number.')
    }
    return integer ? Math.trunc(numeric) : numeric
  })
}

export function normalizeCompiledStaticMeshMetadata(input: {
  version?: unknown
  name?: unknown
  vertices: unknown
  indices: unknown
  uvs?: unknown
  groups?: unknown
}): CompiledStaticMeshMetadata {
  const versionRaw = typeof input.version === 'number' ? input.version : Number(input.version)
  const version = Number.isFinite(versionRaw) ? versionRaw : COMPILED_STATIC_MESH_VERSION
  const vertices = toNumberArray(input.vertices, { stride: 3, minLength: 9 })
  const indices = toNumberArray(input.indices, { stride: 3, minLength: 3, integer: true })
  const name = typeof input.name === 'string' && input.name.trim().length ? input.name.trim() : undefined
  const vertexCount = vertices.length / 3
  indices.forEach((index) => {
    if (index < 0 || index >= vertexCount) {
      throw new Error('Compiled static mesh index is out of range.')
    }
  })
  const uvs = input.uvs !== undefined ? toNumberArray(input.uvs, { stride: 2, minLength: vertexCount * 2 }) : undefined
  if (uvs && uvs.length !== vertexCount * 2) {
    throw new Error('Compiled static mesh UV array length must match the vertex count.')
  }
  const groups = Array.isArray(input.groups)
    ? input.groups.map((entry) => {
        const record = entry as { start?: unknown; count?: unknown; materialIndex?: unknown }
        const start = Math.trunc(Number(record.start))
        const count = Math.trunc(Number(record.count))
        const materialIndex = Math.trunc(Number(record.materialIndex))
        if (!Number.isFinite(start) || !Number.isFinite(count) || !Number.isFinite(materialIndex) || start < 0 || count <= 0 || materialIndex < 0) {
          throw new Error('Compiled static mesh group is invalid.')
        }
        return { start, count, materialIndex }
      })
    : undefined
  return {
    version,
    name,
    vertices,
    indices,
    uvs,
    groups,
  }
}

export function extractCompiledStaticMeshMetadataFromUserData(userData: unknown): CompiledStaticMeshMetadata | null {
  if (!isPlainObject(userData)) {
    return null
  }
  const raw = userData[COMPILED_STATIC_MESH_USERDATA_KEY]
  if (!isPlainObject(raw)) {
    return null
  }
  try {
    return normalizeCompiledStaticMeshMetadata({
      version: raw.version,
      name: raw.name,
      vertices: raw.vertices,
      indices: raw.indices,
      uvs: raw.uvs,
      groups: raw.groups,
    })
  } catch (_error) {
    return null
  }
}

export function createCompiledStaticMeshMetadataFromGeometry(
  geometry: THREE.BufferGeometry,
  name?: string,
): CompiledStaticMeshMetadata {
  const position = geometry.getAttribute('position')
  if (!position || position.itemSize < 3 || position.count < 3) {
    throw new Error('Compiled static mesh geometry requires a position attribute.')
  }

  const vertices = Array.from(position.array as ArrayLike<number>)
  const indices = geometry.index
    ? Array.from(geometry.index.array as ArrayLike<number>)
    : Array.from({ length: position.count }, (_value, index) => index)
  const uv = geometry.getAttribute('uv')
  const uvs = uv && uv.itemSize >= 2 && uv.count >= position.count
    ? Array.from(uv.array as ArrayLike<number>).slice(0, position.count * 2)
    : undefined
  const groups = geometry.groups.length
    ? geometry.groups.map((group) => ({
        start: Math.trunc(group.start),
        count: Math.trunc(group.count),
        materialIndex: Math.trunc(Number(group.materialIndex ?? 0)),
      }))
    : undefined

  return normalizeCompiledStaticMeshMetadata({
    version: COMPILED_STATIC_MESH_VERSION,
    name,
    vertices,
    indices,
    uvs,
    groups,
  })
}

export function createCompiledStaticMeshRuntimeMesh(
  metadata: CompiledStaticMeshMetadata,
  options: {
    material?: THREE.Material | THREE.Material[] | null
    name?: string | null
  } = {},
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(metadata.vertices), 3))
  if (Array.isArray(metadata.uvs) && metadata.uvs.length >= 2) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(metadata.uvs), 2))
  }
  const maxIndex = metadata.indices.reduce((max, current) => (current > max ? current : max), 0)
  const indexArray = maxIndex > 65535 ? new Uint32Array(metadata.indices) : new Uint16Array(metadata.indices)
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
  if (Array.isArray(metadata.groups) && metadata.groups.length) {
    geometry.clearGroups()
    metadata.groups.forEach((group) => {
      geometry.addGroup(group.start, group.count, group.materialIndex)
    })
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const material = options.material ?? new THREE.MeshStandardMaterial({
    color: '#666666',
    roughness: 0.9,
    metalness: 0.05,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = options.name?.trim() || metadata.name || 'Compiled Static Mesh'
  return mesh
}
