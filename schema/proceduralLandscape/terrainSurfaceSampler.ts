import * as THREE from 'three'
import type { TerrainMeshSource } from './terrainSampler'

/**
 * 面向“真实渲染面”的地形表面采样器。
 *
 * 运行时高度场（22m 栅格、双线性插值）是对源网格的低通近似：在折坡、山脊、
 * 台地等地貌上，平滑后的高度场与玩家实际看到的三角面可以差出几十厘米到几米，
 * 这正是路面被地形压住 / 悬空的根源。本采样器改为对**三角形**做精确点定位 +
 * 重心插值，取覆盖该 XZ 的最高面（与渲染可见面一致）。
 *
 * 只索引与给定走廊 AABB 相交的三角形（公路走廊很小，代价可忽略），对 2D 退化
 * 三角形（网格裙边等竖直面）直接跳过。查询命中多个三角形时取最高值。
 */

export interface TerrainSurfaceBounds {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export interface TerrainSurfaceSampler {
  triangleCount: number
  /** 覆盖该点的最高三角面高度；无覆盖返回 null。 */
  heightAt(x: number, z: number): number | null
}

export interface TerrainSurfaceSamplerOptions {
  /** 空间桶边长（米）。默认 8。 */
  bucketSize?: number
  /** 三角形数量上限（防御异常资产，默认 40 万）。 */
  maxTriangles?: number
}

const DEFAULT_BUCKET_SIZE = 8
const DEFAULT_MAX_TRIANGLES = 400_000
/** 扫描上限（防御无索引巨型缓冲：只统计进入走廊的三角形，仍需限制总扫描量）。 */
const MAX_SCANNED_TRIANGLES = 4_000_000
const DEGENERATE_2D_AREA_EPSILON = 1e-6
const BARYCENTRIC_EPSILON = -1e-5

export function buildTerrainSurfaceSampler(
  sources: ReadonlyArray<TerrainMeshSource>,
  bounds: TerrainSurfaceBounds,
  options: TerrainSurfaceSamplerOptions = {},
): TerrainSurfaceSampler | null {
  const bucketSize = Math.max(1, options.bucketSize ?? DEFAULT_BUCKET_SIZE)
  const maxTriangles = Math.max(1024, Math.round(options.maxTriangles ?? DEFAULT_MAX_TRIANGLES))
  const pad = bucketSize
  const minX = bounds.minX - pad
  const minZ = bounds.minZ - pad
  const sizeX = Math.max(bucketSize, bounds.maxX - bounds.minX + pad * 2)
  const sizeZ = Math.max(bucketSize, bounds.maxZ - bounds.minZ + pad * 2)
  const cols = Math.max(1, Math.ceil(sizeX / bucketSize))
  const rows = Math.max(1, Math.ceil(sizeZ / bucketSize))

  /** 每个三角形 9 个 float：x0,y0,z0, x1,y1,z1, x2,y2,z2（世界空间）。 */
  const triangles: number[] = []
  const buckets = new Map<number, number[]>()
  const bucketKey = (col: number, row: number): number => row * cols + col

  const vertex = new THREE.Vector3()
  const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]

  let triangleCount = 0
  let scannedTriangles = 0
  outer: for (const source of sources) {
    const geometry = source.mesh.geometry
    if (!geometry) {
      continue
    }
    const position = geometry.getAttribute('position')
    if (!position) {
      continue
    }
    const index = geometry.getIndex()
    const count = index ? index.count : position.count
    const matrix = source.matrix
    for (let cursor = 0; cursor + 2 < count; cursor += 3) {
      scannedTriangles += 1
      if (scannedTriangles > MAX_SCANNED_TRIANGLES) {
        break outer
      }
      let minTriangleX = Number.POSITIVE_INFINITY
      let maxTriangleX = Number.NEGATIVE_INFINITY
      let minTriangleZ = Number.POSITIVE_INFINITY
      let maxTriangleZ = Number.NEGATIVE_INFINITY
      for (let k = 0; k < 3; k += 1) {
        const vertexIndex = index ? (index.getX(cursor + k) as number) : cursor + k
        vertex.set(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex))
        vertex.applyMatrix4(matrix)
        corner[k]!.copy(vertex)
        if (vertex.x < minTriangleX) minTriangleX = vertex.x
        if (vertex.x > maxTriangleX) maxTriangleX = vertex.x
        if (vertex.z < minTriangleZ) minTriangleZ = vertex.z
        if (vertex.z > maxTriangleZ) maxTriangleZ = vertex.z
      }
      if (maxTriangleX < minX || minTriangleX > minX + sizeX || maxTriangleZ < minZ || minTriangleZ > minZ + sizeZ) {
        continue
      }
      const a = corner[0]!
      const b = corner[1]!
      const c = corner[2]!
      const area2 = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
      if (Math.abs(area2) < DEGENERATE_2D_AREA_EPSILON) {
        continue
      }
      const triangleIndex = triangleCount
      triangleCount += 1
      triangles.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
      const colStart = Math.max(0, Math.floor((minTriangleX - minX) / bucketSize))
      const colEnd = Math.min(cols - 1, Math.floor((maxTriangleX - minX) / bucketSize))
      const rowStart = Math.max(0, Math.floor((minTriangleZ - minZ) / bucketSize))
      const rowEnd = Math.min(rows - 1, Math.floor((maxTriangleZ - minZ) / bucketSize))
      for (let row = rowStart; row <= rowEnd; row += 1) {
        for (let col = colStart; col <= colEnd; col += 1) {
          const key = bucketKey(col, row)
          const bucket = buckets.get(key)
          if (bucket) {
            bucket.push(triangleIndex)
          } else {
            buckets.set(key, [triangleIndex])
          }
        }
      }
      if (triangleCount >= maxTriangles) {
        break outer
      }
    }
  }

  if (!triangleCount) {
    return null
  }

  function heightAt(x: number, z: number): number | null {
    const col = Math.floor((x - minX) / bucketSize)
    const row = Math.floor((z - minZ) / bucketSize)
    if (col < 0 || col >= cols || row < 0 || row >= rows) {
      return null
    }
    const bucket = buckets.get(bucketKey(col, row))
    if (!bucket) {
      return null
    }
    let best: number | null = null
    for (const triangleIndex of bucket) {
      const base = triangleIndex * 9
      const x0 = triangles[base]!
      const y0 = triangles[base + 1]!
      const z0 = triangles[base + 2]!
      const x1 = triangles[base + 3]!
      const y1 = triangles[base + 4]!
      const z1 = triangles[base + 5]!
      const x2 = triangles[base + 6]!
      const y2 = triangles[base + 7]!
      const z2 = triangles[base + 8]!
      const denominator = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2)
      if (Math.abs(denominator) < DEGENERATE_2D_AREA_EPSILON) {
        continue
      }
      const wa = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / denominator
      if (wa < BARYCENTRIC_EPSILON || wa > 1 - BARYCENTRIC_EPSILON) {
        continue
      }
      const wb = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / denominator
      if (wb < BARYCENTRIC_EPSILON || wb > 1 - BARYCENTRIC_EPSILON) {
        continue
      }
      const wc = 1 - wa - wb
      if (wc < BARYCENTRIC_EPSILON) {
        continue
      }
      const y = wa * y0 + wb * y1 + wc * y2
      if (best == null || y > best) {
        best = y
      }
    }
    return best
  }

  return { triangleCount, heightAt }
}
