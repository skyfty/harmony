import * as THREE from 'three'

/**
 * Geometry merging for captured 3D Tiles terrain leaves.
 *
 * The captured leaves are transformed into the same local frame (their world
 * matrices are baked into the geometry before this module sees them), but tile
 * borders keep duplicated vertices and each tile computes its own normals.
 * That produces the visible seams / cracks / ridges the export is meant to
 * remove. This module welds vertices within each material domain, strips
 * terrain skirts, smooths normals across material boundaries and assembles a
 * single indexed mesh with one group per material.
 */

export interface TerrainMergeSource {
  /** Geometry in the export-local frame (world matrix already baked). */
  geometry: THREE.BufferGeometry
  /** Index into the material list the resulting groups will reference. */
  materialIndex: number
  /** Optional world matrix applied to a clone before merging (kept for standalone use). */
  matrixWorld?: THREE.Matrix4
}

export interface TerrainMergeOptions {
  /** Vertices closer than this are welded together (meters). */
  weldEpsilon?: number
  /** Position grid snap step used to remove float noise (meters). */
  quantizeStep?: number
  /** Remove near-vertical sliver triangles (terrain skirts). */
  stripSkirts?: boolean
  /** Average face normals across material boundaries for seamless shading. */
  smoothNormals?: boolean
  /** A near-vertical triangle is a skirt when height / horizontalExtent exceeds this. */
  skirtAspectRatio?: number
  /** A near-vertical triangle below this height (m) is never treated as a skirt. */
  skirtMinHeight?: number
}

export interface TerrainMergeStats {
  sourceVertexCount: number
  sourceTriangleCount: number
  weldedVertexCount: number
  outputVertexCount: number
  outputTriangleCount: number
  degenerateTrianglesRemoved: number
  skirtTrianglesRemoved: number
  droppedAttributes: string[]
}

export interface TerrainMergeResult {
  geometry: THREE.BufferGeometry
  /** Non-empty groups; each group references one material index. */
  groups: Array<{ start: number; count: number; materialIndex: number }>
  stats: TerrainMergeStats
}

const DEFAULT_WELD_EPSILON = 0.05
const DEFAULT_QUANTIZE_STEP = 0.01
const DEFAULT_SKIRT_ASPECT_RATIO = 8
const DEFAULT_SKIRT_MIN_HEIGHT = 2
const SKIRT_NORMAL_Y_THRESHOLD = Math.sin((10 * Math.PI) / 180)

type PreparedItem = {
  positions: Float32Array
  normals: Float32Array | null
  uvs: Float32Array
  indices: number[]
  materialIndex: number
  vertexKeys: string[]
}

function clampPositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function makePositionKey(x: number, y: number, z: number, step: number): string {
  // Round-trip through string keys keeps the hash exact on every JS engine.
  return `${Math.round(x / step)},${Math.round(y / step)},${Math.round(z / step)}`
}

function makeCellKey(qx: number, qy: number, qz: number): string {
  return `${qx},${qy},${qz}`
}

function snapCoordinate(value: number, step: number): number {
  return Math.round(value / step) * step
}

function isDegenerateTriangle(i0: number, i1: number, i2: number): boolean {
  return i0 === i1 || i1 === i2 || i2 === i0
}

function validateOptions(options: TerrainMergeOptions): Required<
  Pick<TerrainMergeOptions, 'weldEpsilon' | 'quantizeStep' | 'stripSkirts' | 'smoothNormals' | 'skirtAspectRatio' | 'skirtMinHeight'>
> {
  const weldEpsilon = clampPositive(options.weldEpsilon, DEFAULT_WELD_EPSILON)
  const quantizeStep = clampPositive(options.quantizeStep, DEFAULT_QUANTIZE_STEP)
  return {
    weldEpsilon,
    quantizeStep,
    stripSkirts: options.stripSkirts !== false,
    smoothNormals: options.smoothNormals !== false,
    skirtAspectRatio: clampPositive(options.skirtAspectRatio, DEFAULT_SKIRT_ASPECT_RATIO),
    skirtMinHeight: clampPositive(options.skirtMinHeight, DEFAULT_SKIRT_MIN_HEIGHT),
  }
}

function prepareItem(source: TerrainMergeSource, stats: TerrainMergeStats): PreparedItem | null {
  const geometry = source.geometry.clone()
  if (source.matrixWorld) {
    geometry.applyMatrix4(source.matrixWorld)
  }

  const position = geometry.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined
  if (!position || position.count < 3) {
    return null
  }

  const sourceNormals = geometry.getAttribute('normal')
  const sourceUv = geometry.getAttribute('uv')
  const knownAttributes = new Set(['position', 'normal', 'uv'])
  for (const name of Object.keys(geometry.attributes)) {
    if (!knownAttributes.has(name) && !stats.droppedAttributes.includes(name)) {
      stats.droppedAttributes.push(name)
    }
  }

  const indexAttribute = geometry.getIndex()
  const triangleCount = indexAttribute
    ? Math.floor(indexAttribute.count / 3)
    : Math.floor(position.count / 3)
  if (triangleCount <= 0) {
    return null
  }

  stats.sourceVertexCount += position.count
  stats.sourceTriangleCount += triangleCount

  const positions = new Float32Array(position.count * 3)
  const normals = sourceNormals && sourceNormals.count === position.count && sourceNormals.itemSize >= 3
    ? new Float32Array(position.count * 3)
    : null
  const uvs = sourceUv && sourceUv.count === position.count && sourceUv.itemSize >= 2
    ? new Float32Array(position.count * 2)
    : new Float32Array(position.count * 2)

  for (let i = 0; i < position.count; i += 1) {
    positions[i * 3 + 0] = position.getX(i)
    positions[i * 3 + 1] = position.getY(i)
    positions[i * 3 + 2] = position.getZ(i)
    if (normals) {
      normals[i * 3 + 0] = (sourceNormals as THREE.BufferAttribute).getX(i)
      normals[i * 3 + 1] = (sourceNormals as THREE.BufferAttribute).getY(i)
      normals[i * 3 + 2] = (sourceNormals as THREE.BufferAttribute).getZ(i)
    }
    if (sourceUv && sourceUv.count === position.count && sourceUv.itemSize >= 2) {
      uvs[i * 2 + 0] = (sourceUv as THREE.BufferAttribute).getX(i)
      uvs[i * 2 + 1] = (sourceUv as THREE.BufferAttribute).getY(i)
    }
  }

  const indices: number[] = []
  for (let t = 0; t < triangleCount; t += 1) {
    const i0 = indexAttribute ? indexAttribute.getX(t * 3) : t * 3
    const i1 = indexAttribute ? indexAttribute.getX(t * 3 + 1) : t * 3 + 1
    const i2 = indexAttribute ? indexAttribute.getX(t * 3 + 2) : t * 3 + 2
    if (isDegenerateTriangle(i0, i1, i2)) {
      stats.degenerateTrianglesRemoved += 1
      continue
    }
    indices.push(i0, i1, i2)
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    materialIndex: source.materialIndex,
    vertexKeys: [],
  }
}

function weldPreparedDomain(
  domain: PreparedItem[],
  options: Required<Pick<TerrainMergeOptions, 'weldEpsilon' | 'quantizeStep'>>,
  stats: TerrainMergeStats,
): PreparedItem | null {
  const hashStep = Math.max(options.quantizeStep, options.weldEpsilon)
  const vertexMap = new Map<string, number[]>()
  const newIndices: number[] = []
  const newPositions: number[] = []
  const newUvs: number[] = []
  const newKeys: string[] = []
  const sourceToTargetByItem = domain.map(() => new Map<number, number>())

  const weldDistanceSq = options.weldEpsilon * options.weldEpsilon

  for (let itemIndex = 0; itemIndex < domain.length; itemIndex += 1) {
    const item = domain[itemIndex]
    const sourceToTarget = sourceToTargetByItem[itemIndex]
    for (let t = 0; t < item.indices.length; t += 3) {
      const triangle = [item.indices[t], item.indices[t + 1], item.indices[t + 2]]
      if (triangle.some((vertexIndex) => vertexIndex === undefined)) {
        continue
      }
      let containsBadVertex = false
      for (const sourceIndex of triangle) {
        const x = item.positions[sourceIndex! * 3]
        const y = item.positions[sourceIndex! * 3 + 1]
        const z = item.positions[sourceIndex! * 3 + 2]
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          containsBadVertex = true
          break
        }
      }
      if (containsBadVertex) {
        stats.degenerateTrianglesRemoved += 1
        continue
      }

      for (const sourceIndex of triangle) {
        const alreadyMapped = sourceToTarget.get(sourceIndex!)
        if (alreadyMapped !== undefined) {
          newIndices.push(alreadyMapped)
          continue
        }
        const x = item.positions[sourceIndex! * 3]
        const y = item.positions[sourceIndex! * 3 + 1]
        const z = item.positions[sourceIndex! * 3 + 2]
        let target = -1
        const qx = Math.round(x / hashStep)
        const qy = Math.round(y / hashStep)
        const qz = Math.round(z / hashStep)
        // Two vertices within the weld distance can land one cell apart per
        // axis, so the lookup covers the 3x3x3 neighbourhood of the query cell.
        outer: for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            for (let oz = -1; oz <= 1; oz += 1) {
              const bucket = vertexMap.get(makeCellKey(qx + ox, qy + oy, qz + oz))
              if (!bucket) {
                continue
              }
              for (const candidate of bucket) {
                const dx = x - newPositions[candidate * 3]
                const dy = y - newPositions[candidate * 3 + 1]
                const dz = z - newPositions[candidate * 3 + 2]
                if (dx * dx + dy * dy + dz * dz <= weldDistanceSq) {
                  target = candidate
                  break outer
                }
              }
            }
          }
        }
        if (target < 0) {
          target = newKeys.length
          const key = makePositionKey(x, y, z, hashStep)
          const bucket = vertexMap.get(key) ?? []
          bucket.push(target)
          vertexMap.set(key, bucket)
          newKeys.push(key)
          newPositions.push(
            snapCoordinate(x, options.quantizeStep),
            snapCoordinate(y, options.quantizeStep),
            snapCoordinate(z, options.quantizeStep),
          )
          newUvs.push(item.uvs[sourceIndex! * 2], item.uvs[sourceIndex! * 2 + 1])
        } else {
          stats.weldedVertexCount += 1
        }
        sourceToTarget.set(sourceIndex!, target)
        newIndices.push(target)
      }
    }
  }

  if (newIndices.length < 3) {
    return null
  }

  // Welding is driven by the triangle list, so the output never contains loose
  // vertices. Source normals are dropped here: the caller recomputes normals
  // either smoothly across domains or flat per domain.
  return {
    positions: new Float32Array(newPositions),
    normals: null,
    uvs: new Float32Array(newUvs),
    indices: newIndices,
    materialIndex: domain[0]?.materialIndex ?? 0,
    vertexKeys: newKeys,
  }
}

function stripSkirtsForItem(
  item: PreparedItem,
  options: Required<Pick<TerrainMergeOptions, 'stripSkirts' | 'skirtAspectRatio' | 'skirtMinHeight'>>,
  stats: TerrainMergeStats,
): void {
  if (!options.stripSkirts) {
    return
  }
  const kept: number[] = []
  for (let t = 0; t < item.indices.length; t += 3) {
    const i0 = item.indices[t]
    const i1 = item.indices[t + 1]
    const i2 = item.indices[t + 2]
    if (i0 === undefined || i1 === undefined || i2 === undefined) {
      continue
    }
    const ax = item.positions[i0 * 3]
    const ay = item.positions[i0 * 3 + 1]
    const az = item.positions[i0 * 3 + 2]
    const bx = item.positions[i1 * 3]
    const by = item.positions[i1 * 3 + 1]
    const bz = item.positions[i1 * 3 + 2]
    const cx = item.positions[i2 * 3]
    const cy = item.positions[i2 * 3 + 1]
    const cz = item.positions[i2 * 3 + 2]

    const ex = bx - ax
    const ey = by - ay
    const ez = bz - az
    const fx = cx - ax
    const fy = cy - ay
    const fz = cz - az
    const nx = ey * fz - ez * fy
    const ny = ez * fx - ex * fz
    const nz = ex * fy - ey * fx
    const length = Math.hypot(nx, ny, nz)
    if (length <= 1e-12) {
      stats.degenerateTrianglesRemoved += 1
      continue
    }
    const normalizedY = ny / length
    if (Math.abs(normalizedY) < SKIRT_NORMAL_Y_THRESHOLD) {
      const verticalExtent = Math.max(ay, by, cy) - Math.min(ay, by, cy)
      // Horizontal footprint: the longest edge of the triangle's XZ projection.
      // Both skirts and cliff faces project to (near) line segments, so area is
      // useless here; the skirt signature is an extremely tall, thin sliver.
      const edgeXZ = Math.max(
        Math.hypot(bx - ax, bz - az),
        Math.hypot(cx - bx, cz - bz),
        Math.hypot(ax - cx, az - cz),
      )
      const horizontalExtent = Math.max(edgeXZ, 1e-4)
      if (
        verticalExtent > options.skirtMinHeight
        && verticalExtent > horizontalExtent * options.skirtAspectRatio
      ) {
        stats.skirtTrianglesRemoved += 1
        continue
      }
    }
    kept.push(i0, i1, i2)
  }
  item.indices = kept
}

function smoothNormalsAcrossItems(
  items: PreparedItem[],
  options: Required<Pick<TerrainMergeOptions, 'weldEpsilon' | 'quantizeStep'>>,
): void {
  // Global, area-weighted face-normal accumulation keyed by position so vertex
  // copies on tile / material borders all receive the same continuous normal.
  const hashStep = Math.max(options.quantizeStep, options.weldEpsilon)
  const accumulator = new Map<string, { x: number; y: number; z: number }>()
  const keyForItemVertex = new Map<PreparedItem, string[]>()

  for (const item of items) {
    keyForItemVertex.set(item, item.vertexKeys)
    for (let t = 0; t < item.indices.length; t += 3) {
      const i0 = item.indices[t]
      const i1 = item.indices[t + 1]
      const i2 = item.indices[t + 2]
      if (i0 === undefined || i1 === undefined || i2 === undefined) continue
      const ax = item.positions[i0 * 3]
      const ay = item.positions[i0 * 3 + 1]
      const az = item.positions[i0 * 3 + 2]
      const ex = item.positions[i1 * 3] - ax
      const ey = item.positions[i1 * 3 + 1] - ay
      const ez = item.positions[i1 * 3 + 2] - az
      const fx = item.positions[i2 * 3] - ax
      const fy = item.positions[i2 * 3 + 1] - ay
      const fz = item.positions[i2 * 3 + 2] - az
      const nx = ey * fz - ez * fy
      const ny = ez * fx - ex * fz
      const nz = ex * fy - ey * fx
      for (const vertexIndex of [i0, i1, i2]) {
        const key = item.vertexKeys[vertexIndex]
        if (!key) continue
        const existing = accumulator.get(key)
        if (existing) {
          existing.x += nx
          existing.y += ny
          existing.z += nz
        } else {
          accumulator.set(key, { x: nx, y: ny, z: nz })
        }
      }
    }
  }

  for (const item of items) {
    const keys = keyForItemVertex.get(item) ?? []
    const normals = new Float32Array(item.positions.length)
    for (let v = 0; v < keys.length; v += 1) {
      const key = keys[v]
      const value = key ? accumulator.get(key) : undefined
      if (!value) {
        continue
      }
      const length = Math.hypot(value.x, value.y, value.z)
      if (length <= 1e-12) {
        continue
      }
      normals[v * 3 + 0] = value.x / length
      normals[v * 3 + 1] = value.y / length
      normals[v * 3 + 2] = value.z / length
    }
    item.normals = normals
  }
}

function computeFlatNormalsPerItem(item: PreparedItem): void {
  if (item.normals) {
    return
  }
  const normals = new Float32Array(item.positions.length)
  for (let t = 0; t < item.indices.length; t += 3) {
    const i0 = item.indices[t]
    const i1 = item.indices[t + 1]
    const i2 = item.indices[t + 2]
    if (i0 === undefined || i1 === undefined || i2 === undefined) continue
    const ax = item.positions[i0 * 3]
    const ay = item.positions[i0 * 3 + 1]
    const az = item.positions[i0 * 3 + 2]
    const ex = item.positions[i1 * 3] - ax
    const ey = item.positions[i1 * 3 + 1] - ay
    const ez = item.positions[i1 * 3 + 2] - az
    const fx = item.positions[i2 * 3] - ax
    const fy = item.positions[i2 * 3 + 1] - ay
    const fz = item.positions[i2 * 3 + 2] - az
    const nx = ey * fz - ez * fy
    const ny = ez * fx - ex * fz
    const nz = ex * fy - ey * fx
    const length = Math.hypot(nx, ny, nz)
    if (length <= 1e-12) continue
    for (const vertexIndex of [i0, i1, i2]) {
      normals[vertexIndex * 3 + 0] = nx / length
      normals[vertexIndex * 3 + 1] = ny / length
      normals[vertexIndex * 3 + 2] = nz / length
    }
  }
  item.normals = normals
}

/**
 * Welds, de-skirts and normal-smooths the given terrain sources and returns a
 * single indexed geometry with one group per material index.
 */
export function mergeTerrainGeometries(
  sources: TerrainMergeSource[],
  options: TerrainMergeOptions = {},
): TerrainMergeResult | null {
  const mergedOptions = validateOptions(options)
  const stats: TerrainMergeStats = {
    sourceVertexCount: 0,
    sourceTriangleCount: 0,
    weldedVertexCount: 0,
    outputVertexCount: 0,
    outputTriangleCount: 0,
    degenerateTrianglesRemoved: 0,
    skirtTrianglesRemoved: 0,
    droppedAttributes: [],
  }

  const itemsByMaterial = new Map<number, PreparedItem[]>()
  for (const source of sources) {
    const item = prepareItem(source, stats)
    if (!item) {
      continue
    }
    const domain = itemsByMaterial.get(item.materialIndex) ?? []
    domain.push(item)
    itemsByMaterial.set(item.materialIndex, domain)
  }

  const items: PreparedItem[] = []
  for (const materialIndex of [...itemsByMaterial.keys()].sort((a, b) => a - b)) {
    const domain = itemsByMaterial.get(materialIndex) ?? []
    const welded = weldPreparedDomain(domain, mergedOptions, stats)
    if (!welded) {
      continue
    }
    stripSkirtsForItem(welded, mergedOptions, stats)
    if (welded.indices.length < 3) {
      continue
    }
    items.push(welded)
  }

  if (items.length === 0) {
    return null
  }

  if (mergedOptions.smoothNormals) {
    smoothNormalsAcrossItems(items, mergedOptions)
  } else {
    for (const item of items) {
      computeFlatNormalsPerItem(item)
    }
  }

  let totalVertices = 0
  let totalIndices = 0
  for (const item of items) {
    totalVertices += item.positions.length / 3
    totalIndices += item.indices.length
  }

  const positions = new Float32Array(totalVertices * 3)
  const normals = new Float32Array(totalVertices * 3)
  const uvs = new Float32Array(totalVertices * 2)
  const IndexArrayType = totalVertices > 65535 ? Uint32Array : Uint16Array
  const index = new IndexArrayType(totalIndices)

  const groups: Array<{ start: number; count: number; materialIndex: number }> = []
  let vertexCursor = 0
  let indexCursor = 0

  for (const item of items) {
    const vertexCount = item.positions.length / 3
    positions.set(item.positions, vertexCursor * 3)
    normals.set(item.normals ?? new Float32Array(vertexCount * 3), vertexCursor * 3)
    uvs.set(item.uvs, vertexCursor * 2)
    for (let i = 0; i < item.indices.length; i += 1) {
      index[indexCursor + i] = item.indices[i] + vertexCursor
    }
    const group = {
      start: indexCursor,
      count: item.indices.length,
      materialIndex: item.materialIndex,
    }
    const previous = groups[groups.length - 1]
    if (previous && previous.materialIndex === group.materialIndex && previous.start + previous.count === group.start) {
      previous.count += group.count
    } else {
      groups.push(group)
    }
    vertexCursor += vertexCount
    indexCursor += item.indices.length
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  geometry.groups = []
  for (const group of groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex)
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  stats.outputVertexCount = totalVertices
  stats.outputTriangleCount = Math.floor(totalIndices / 3)

  return { geometry, groups, stats }
}

