import * as THREE from 'three'

export const COMPILED_STATIC_MESH_USERDATA_KEY = '__compiledStaticMesh'
export const COMPILED_STATIC_MESH_VERSION = 1

export interface CompiledStaticMeshMetadata {
  version: number
  name?: string
  vertices: number[]
  indices: number[]
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
  return {
    version,
    name,
    vertices,
    indices,
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

  return normalizeCompiledStaticMeshMetadata({
    version: COMPILED_STATIC_MESH_VERSION,
    name,
    vertices,
    indices,
  })
}

export function createCompiledStaticMeshRuntimeMesh(
  metadata: CompiledStaticMeshMetadata,
  options: {
    material?: THREE.Material | null
    name?: string | null
  } = {},
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(metadata.vertices), 3))
  const maxIndex = metadata.indices.reduce((max, current) => (current > max ? current : max), 0)
  const indexArray = maxIndex > 65535 ? new Uint32Array(metadata.indices) : new Uint16Array(metadata.indices)
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
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
