import * as THREE from 'three'

export const AI_MODEL_MESH_USERDATA_KEY = '__aiGeneratedMesh'
export const AI_MODEL_MESH_VERSION = 1

export interface AiModelMeshMetadata {
  version: number
  name?: string
  vertices: number[]
  indices: number[]
}

export type AiModelMeshInput = {
  name?: unknown
  vertices: unknown
  indices: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function toNumberArray(source: unknown, options: { label: string; integer?: boolean; stride?: number; minLength?: number }): number[] {
  const { label, integer = false, stride, minLength } = options
  if (Array.isArray(source) || ArrayBuffer.isView(source)) {
    const values = Array.from(source as ArrayLike<number>)
    if (minLength !== undefined && values.length < minLength) {
      throw new Error(`${label}长度需要至少包含${minLength}个数字。`)
    }
    if (stride && values.length % stride !== 0) {
      throw new Error(`${label}的长度必须是${stride}的整数倍。`)
    }
    const result: number[] = []
    values.forEach((entry, index) => {
      const numeric = typeof entry === 'number' ? entry : Number(entry)
      if (!Number.isFinite(numeric)) {
        throw new Error(`${label}在索引${index}处包含非有限数字。`)
      }
      if (integer && !Number.isInteger(numeric)) {
        throw new Error(`${label}在索引${index}处的值必须是整数。`)
      }
      result.push(integer ? Math.trunc(numeric) : numeric)
    })
    return result
  }
  throw new Error(`${label}必须是数字数组。`)
}

function validateIndexRange(indices: number[], vertexCount: number): void {
  const maxAllowed = vertexCount - 1
  indices.forEach((value, index) => {
    if (value < 0 || value > maxAllowed) {
      throw new Error(`索引数组中的第${index + 1}个值超出顶点数量范围。`)
    }
  })
}

export function normalizeAiModelMeshInput(input: AiModelMeshInput): AiModelMeshMetadata {
  const name = typeof input.name === 'string' ? input.name.trim() : undefined
  const vertices = toNumberArray(input.vertices, { label: '顶点数组', stride: 3, minLength: 9 })
  const indices = toNumberArray(input.indices, { label: '索引数组', stride: 3, minLength: 3, integer: true })
  const vertexCount = vertices.length / 3
  validateIndexRange(indices, vertexCount)
  return {
    version: AI_MODEL_MESH_VERSION,
    name: name && name.length ? name : undefined,
    vertices,
    indices,
  }
}

export function extractAiModelMeshMetadataFromUserData(userData: unknown): AiModelMeshMetadata | null {
  if (!isPlainObject(userData)) {
    return null
  }
  const raw = userData[AI_MODEL_MESH_USERDATA_KEY]
  if (!isPlainObject(raw)) {
    return null
  }
  const versionRaw = (raw as { version?: unknown }).version
  const version = typeof versionRaw === 'number' ? versionRaw : Number(versionRaw)
  if (!Number.isFinite(version) || version !== AI_MODEL_MESH_VERSION) {
    return null
  }
  try {
    return normalizeAiModelMeshInput({
      name: (raw as { name?: unknown }).name,
      vertices: (raw as { vertices?: unknown }).vertices,
      indices: (raw as { indices?: unknown }).indices,
    })
  } catch (_error) {
    return null
  }
}

export function createBufferGeometryFromMetadata(metadata: AiModelMeshMetadata): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positionArray = new Float32Array(metadata.vertices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionArray, 3))
  const maxIndex = metadata.indices.reduce((max, current) => (current > max ? current : max), 0)
  const indexArray = maxIndex > 65535 ? new Uint32Array(metadata.indices) : new Uint16Array(metadata.indices)
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
