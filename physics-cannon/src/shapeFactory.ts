import * as CANNON from 'cannon-es'

export type CannonShapeScaleLike = { x?: number; y?: number; z?: number } | null | undefined

export type CannonShapeDefinition =
  | {
      kind: 'box'
      halfExtents: [number, number, number]
      applyScale?: boolean
    }
  | {
      kind: 'convex'
      vertices: Array<[number, number, number]>
      faces?: number[][]
      applyScale?: boolean
    }
  | {
      kind: 'heightfield'
      matrix: number[][]
      elementSize: number
      applyScale?: boolean
    }
  | {
      kind: 'sphere'
      radius: number
      applyScale?: boolean
    }
  | {
      kind: 'cylinder'
      radiusTop: number
      radiusBottom: number
      height: number
      segments?: number
      applyScale?: boolean
    }

type SanitizedFaces = { faces: number[][]; invalidCount: number }
type LoggerTag = string | undefined
export type CannonConvexPolyhedronData = {
  vertices: CANNON.Vec3[]
  faces: number[][]
}

const cylinderShapeOffsetHelper = new CANNON.Vec3()
const cylinderShapeRotationHelper = new CANNON.Quaternion()
cylinderShapeRotationHelper.setFromEuler(Math.PI / 2, 0, 0, 'XYZ')

export function normalizeCannonShapeScale(
  scaleLike: CannonShapeScaleLike,
): { x: number; y: number; z: number } {
  const sx = typeof scaleLike?.x === 'number' && Number.isFinite(scaleLike.x) ? Math.abs(scaleLike.x) : 1
  const sy = typeof scaleLike?.y === 'number' && Number.isFinite(scaleLike.y) ? Math.abs(scaleLike.y) : 1
  const sz = typeof scaleLike?.z === 'number' && Number.isFinite(scaleLike.z) ? Math.abs(scaleLike.z) : 1
  return {
    x: sx > 0 ? sx : 1,
    y: sy > 0 ? sy : 1,
    z: sz > 0 ? sz : 1,
  }
}

export function createCannonShape(
  definition: CannonShapeDefinition,
  loggerTag?: LoggerTag,
  scale: CannonShapeScaleLike = { x: 1, y: 1, z: 1 },
): CANNON.Shape | null {
  const safeScale = normalizeCannonShapeScale(scale)
  const applyScale = definition.applyScale === true
  const scaleX = applyScale ? safeScale.x : 1
  const scaleY = applyScale ? safeScale.y : 1
  const scaleZ = applyScale ? safeScale.z : 1

  if (definition.kind === 'box') {
    const [x, y, z] = definition.halfExtents
    if (![x, y, z].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      return null
    }
    return new CANNON.Box(new CANNON.Vec3(x * scaleX, y * scaleY, z * scaleZ))
  }

  if (definition.kind === 'convex') {
    const polyhedron = createCannonConvexPolyhedron(definition.vertices, definition.faces, {
      scale: { x: scaleX, y: scaleY, z: scaleZ },
      loggerTag,
    })
    if (!polyhedron) {
      return null
    }
    return polyhedron
  }

  if (definition.kind === 'heightfield') {
    const matrix = normalizeHeightfieldMatrix(definition.matrix)
    const elementSize = typeof definition.elementSize === 'number' && Number.isFinite(definition.elementSize)
      ? definition.elementSize
      : null
    if (!matrix || !elementSize || elementSize <= 0) {
      return null
    }
    return new CANNON.Heightfield(matrix, { elementSize })
  }

  if (definition.kind === 'sphere') {
    const radius = Number(definition.radius)
    if (!Number.isFinite(radius) || radius <= 0) {
      return null
    }
    const scaleFactor = Math.max(scaleX, scaleY, scaleZ)
    return new CANNON.Sphere(radius * scaleFactor)
  }

  if (definition.kind === 'cylinder') {
    const radiusTop = Number(definition.radiusTop)
    const radiusBottom = Number(definition.radiusBottom)
    const height = Number(definition.height)
    if (![radiusTop, radiusBottom, height].every((value) => Number.isFinite(value) && value > 0)) {
      return null
    }
    const segmentCount = Number.isFinite(definition.segments)
      ? Math.max(3, Math.min(48, Math.trunc(definition.segments ?? 16)))
      : 16
    const radiusScale = Math.max(scaleX, scaleZ)
    const heightScale = scaleY
    const cylinder = new CANNON.Cylinder(
      radiusTop * radiusScale,
      radiusBottom * radiusScale,
      height * heightScale,
      segmentCount,
    )
    cylinder.transformAllPoints(cylinderShapeOffsetHelper.set(0, 0, 0), cylinderShapeRotationHelper)
    return cylinder
  }

  return null
}

export function createCannonConvexPolyhedron(
  sourceVertices: Array<[number, number, number]>,
  sourceFaces?: number[][],
  options: {
    scale?: CannonShapeScaleLike
    loggerTag?: LoggerTag
  } = {},
): CANNON.ConvexPolyhedron | null {
  const normalized = normalizeCannonConvexHullData(sourceVertices, sourceFaces, options)
  if (!normalized) {
    return null
  }
  return new CANNON.ConvexPolyhedron(normalized)
}

export function normalizeCannonConvexHullData(
  sourceVertices: Array<[number, number, number]>,
  sourceFaces?: number[][],
  options: {
    scale?: CannonShapeScaleLike
    loggerTag?: LoggerTag
  } = {},
): CannonConvexPolyhedronData | null {
  if (!Array.isArray(sourceVertices) || sourceVertices.length < 4) {
    return null
  }
  const safeScale = normalizeCannonShapeScale(options.scale)
  const vertices: CANNON.Vec3[] = []
  const vertexMap = new Map<string, number>()
  const indexMap = new Map<number, number>()
  for (let i = 0; i < sourceVertices.length; i += 1) {
    const tuple = sourceVertices[i]
    const vx = Number(tuple?.[0])
    const vy = Number(tuple?.[1])
    const vz = Number(tuple?.[2])
    if (![vx, vy, vz].every((value) => Number.isFinite(value))) {
      return null
    }
    const scaledX = vx * safeScale.x
    const scaledY = vy * safeScale.y
    const scaledZ = vz * safeScale.z
    const key = `${scaledX.toFixed(4)},${scaledY.toFixed(4)},${scaledZ.toFixed(4)}`
    if (vertexMap.has(key)) {
      indexMap.set(i, vertexMap.get(key)!)
    } else {
      const newIndex = vertices.length
      vertices.push(new CANNON.Vec3(scaledX, scaledY, scaledZ))
      vertexMap.set(key, newIndex)
      indexMap.set(i, newIndex)
    }
  }
  const remappedFaces = remapConvexFaces(sourceFaces, indexMap)
  const faces = remappedFaces.length ? remappedFaces : inferConvexHullFaces(vertices.length)
  const { faces: sanitizedFaces, invalidCount } = sanitizeConvexFaces(faces, vertices.length)
  if (!sanitizedFaces.length) {
    return null
  }
  if (invalidCount) {
    warn(options.loggerTag, 'Convex collider faces contain invalid vertex indices; skipped %d face(s).', invalidCount)
  }
  const orientedFaces = orientConvexFaces(sanitizedFaces, vertices)
  return { vertices, faces: orientedFaces }
}

function warn(loggerTag: LoggerTag, message: string, ...args: unknown[]): void {
  const prefix = loggerTag ?? '[PhysicsCannon]'
  console.warn(`${prefix} ${message}`, ...args)
}

function normalizeHeightfieldMatrix(source: unknown): number[][] | null {
  if (!Array.isArray(source) || source.length < 2) {
    return null
  }
  let maxRows = 0
  const normalizedColumns = source.map((column) => {
    if (!Array.isArray(column)) {
      return []
    }
    const normalized = column.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0))
    if (normalized.length > maxRows) {
      maxRows = normalized.length
    }
    return normalized
  })
  if (normalizedColumns.length < 2 || maxRows < 2) {
    return null
  }
  const paddedColumns = normalizedColumns.map((column) => {
    if (column.length === maxRows) {
      return column
    }
    const padValue = column.length ? column[column.length - 1]! : 0
    while (column.length < maxRows) {
      column.push(padValue)
    }
    return column
  })
  return paddedColumns as number[][]
}

function sanitizeConvexFaces(source: unknown, vertexCount: number): SanitizedFaces {
  const result: SanitizedFaces = { faces: [], invalidCount: 0 }
  if (!Array.isArray(source) || vertexCount < 4) {
    return result
  }
  source.forEach((face) => {
    if (!Array.isArray(face) || face.length < 3) {
      result.invalidCount += 1
      return
    }
    const normalized: number[] = []
    let invalid = false
    for (let i = 0; i < face.length; i += 1) {
      const raw = face[i]
      const numeric = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(numeric)) {
        invalid = true
        break
      }
      const index = Math.trunc(numeric)
      if (index < 0 || index >= vertexCount) {
        invalid = true
        break
      }
      if (!normalized.length || normalized[normalized.length - 1] !== index) {
        normalized.push(index)
      }
    }
    if (invalid) {
      result.invalidCount += 1
      return
    }
    const deduped = normalized.filter((value, index, array) => array.indexOf(value) === index)
    if (deduped.length < 3) {
      result.invalidCount += 1
      return
    }
    result.faces.push(deduped)
  })
  return result
}

function remapConvexFaces(sourceFaces: number[][] | undefined, indexMap: Map<number, number>): number[][] {
  if (!Array.isArray(sourceFaces) || !sourceFaces.length) {
    return []
  }
  const remappedFaces: number[][] = []
  sourceFaces.forEach((face) => {
    if (!Array.isArray(face)) {
      return
    }
    const newFace: number[] = []
    face.forEach((idx) => {
      const numeric = typeof idx === 'number' ? idx : Number(idx)
      if (Number.isFinite(numeric)) {
        const originalIndex = Math.trunc(numeric)
        if (indexMap.has(originalIndex)) {
          newFace.push(indexMap.get(originalIndex)!)
        }
      }
    })
    if (newFace.length >= 3) {
      remappedFaces.push(newFace)
    }
  })
  return remappedFaces
}

function inferConvexHullFaces(vertexCount: number): number[][] {
  if (vertexCount === 8) {
    return [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [0, 4, 5, 1],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 4, 0],
    ]
  }
  return []
}

function orientConvexFaces(faces: number[][], vertices: CANNON.Vec3[]): number[][] {
  if (!faces.length || !vertices.length) {
    return faces
  }
  const centroid = new CANNON.Vec3()
  vertices.forEach((vertex) => {
    centroid.vadd(vertex, centroid)
  })
  centroid.scale(1 / vertices.length, centroid)
  const ab = new CANNON.Vec3()
  const ac = new CANNON.Vec3()
  const normal = new CANNON.Vec3()
  const toCentroid = new CANNON.Vec3()
  return faces.map((face) => {
    if (face.length < 3) {
      return face
    }
    const [i0, i1, i2] = face
    if (i0 === undefined || i1 === undefined || i2 === undefined) {
      return face
    }
    const a = vertices[i0]
    const b = vertices[i1]
    const c = vertices[i2]
    if (!a || !b || !c) {
      return face
    }
    ab.set(b.x, b.y, b.z).vsub(a, ab)
    ac.set(c.x, c.y, c.z).vsub(a, ac)
    ab.cross(ac, normal)
    if (normal.lengthSquared() < 1e-12) {
      return face
    }
    toCentroid.set(a.x, a.y, a.z).vsub(centroid, toCentroid)
    return normal.dot(toCentroid) >= 0 ? face : [...face].reverse()
  })
}
