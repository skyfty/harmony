import * as THREE from 'three'

export const WATER_SURFACE_MESH_USERDATA_KEY = '__harmonyWaterSurfaceMesh'
export const WATER_SURFACE_MESH_VERSION = 1

export interface WaterSurfaceMeshMetadata {
  version: number
  contour: number[]
}

export type WaterSurfaceMeshInput = {
  contour: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function toNumberArray(
  source: unknown,
  options: { label: string; stride?: number; minLength?: number },
): number[] {
  const { label, stride, minLength } = options
  if (!Array.isArray(source) && !ArrayBuffer.isView(source)) {
    throw new Error(`${label}必须是数字数组。`)
  }

  const values = Array.from(source as ArrayLike<number>)
  if (minLength !== undefined && values.length < minLength) {
    throw new Error(`${label}长度至少需要${minLength}个数字。`)
  }
  if (stride && values.length % stride !== 0) {
    throw new Error(`${label}长度必须是${stride}的整数倍。`)
  }

  return values.map((entry, index) => {
    const numeric = typeof entry === 'number' ? entry : Number(entry)
    if (!Number.isFinite(numeric)) {
      throw new Error(`${label}在索引${index}处包含非有限数字。`)
    }
    return numeric
  })
}

function pointsEqual(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) <= 1e-6 && Math.abs(ay - by) <= 1e-6
}

function computeSignedArea(contour: number[]): number {
  let area = 0
  for (let index = 0; index < contour.length; index += 2) {
    const nextIndex = (index + 2) % contour.length
    const x0 = contour[index]!
    const y0 = contour[index + 1]!
    const x1 = contour[nextIndex]!
    const y1 = contour[nextIndex + 1]!
    area += x0 * y1 - x1 * y0
  }
  return area * 0.5
}

function normalizeContour(contour: number[]): number[] {
  const cleaned: number[] = []

  for (let index = 0; index < contour.length; index += 2) {
    const x = contour[index]!
    const y = contour[index + 1]!
    const previousX = cleaned[cleaned.length - 2]
    const previousY = cleaned[cleaned.length - 1]

    if (
      typeof previousX === 'number'
      && typeof previousY === 'number'
      && pointsEqual(previousX, previousY, x, y)
    ) {
      continue
    }

    cleaned.push(x, y)
  }

  if (cleaned.length >= 4) {
    const firstX = cleaned[0]!
    const firstY = cleaned[1]!
    const lastX = cleaned[cleaned.length - 2]!
    const lastY = cleaned[cleaned.length - 1]!
    if (pointsEqual(firstX, firstY, lastX, lastY)) {
      cleaned.splice(cleaned.length - 2, 2)
    }
  }

  if (cleaned.length < 6) {
    throw new Error('水面轮廓至少需要3个顶点。')
  }

  const area = computeSignedArea(cleaned)
  if (!Number.isFinite(area) || Math.abs(area) <= 1e-8) {
    throw new Error('水面轮廓面积过小或无效。')
  }

  if (area < 0) {
    const reversed: number[] = []
    for (let index = cleaned.length - 2; index >= 0; index -= 2) {
      reversed.push(cleaned[index]!, cleaned[index + 1]!)
    }
    return reversed
  }

  return cleaned
}

export function normalizeWaterSurfaceMeshInput(input: WaterSurfaceMeshInput): WaterSurfaceMeshMetadata {
  const contour = normalizeContour(
    toNumberArray(input.contour, {
      label: '水面轮廓',
      stride: 2,
      minLength: 6,
    }),
  )

  return {
    version: WATER_SURFACE_MESH_VERSION,
    contour,
  }
}

export function cloneWaterSurfaceMeshMetadata(metadata: WaterSurfaceMeshMetadata): WaterSurfaceMeshMetadata {
  return {
    version: metadata.version,
    contour: [...metadata.contour],
  }
}

export function extractWaterSurfaceMeshMetadataFromUserData(userData: unknown): WaterSurfaceMeshMetadata | null {
  if (!isPlainObject(userData)) {
    return null
  }

  const raw = userData[WATER_SURFACE_MESH_USERDATA_KEY]
  if (!isPlainObject(raw)) {
    return null
  }

  const versionRaw = (raw as { version?: unknown }).version
  const version = typeof versionRaw === 'number' ? versionRaw : Number(versionRaw)
  if (!Number.isFinite(version) || version !== WATER_SURFACE_MESH_VERSION) {
    return null
  }

  try {
    return normalizeWaterSurfaceMeshInput({
      contour: (raw as { contour?: unknown }).contour,
    })
  } catch {
    return null
  }
}

export function createWaterSurfaceBufferGeometryFromMetadata(
  metadata: WaterSurfaceMeshMetadata,
): THREE.ShapeGeometry {
  const points: THREE.Vector2[] = []
  for (let index = 0; index < metadata.contour.length; index += 2) {
    points.push(new THREE.Vector2(metadata.contour[index]!, metadata.contour[index + 1]!))
  }

  const shape = new THREE.Shape(points)
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function createWaterSurfaceRuntimeMesh(
  metadata: WaterSurfaceMeshMetadata,
  options: {
    material?: THREE.Material | THREE.Material[]
    name?: string
  } = {},
): THREE.Mesh {
  const geometry = createWaterSurfaceBufferGeometryFromMetadata(metadata)
  const material = options.material ?? new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.15,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = options.name ?? 'Water Surface'
  mesh.userData = {
    ...(mesh.userData ?? {}),
    dynamicMeshType: 'WaterSurface',
    [WATER_SURFACE_MESH_USERDATA_KEY]: {
      version: WATER_SURFACE_MESH_VERSION,
      contour: [...metadata.contour],
    },
  }
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}
