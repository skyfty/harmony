import * as THREE from 'three'
import type { RoadTraceNode } from './roadTrace'
import type { RoadDistanceSource } from './roadProximity'
import { clamp, clamp01 } from './noise'

/**
 * Road proximity / profile field.
 *
 * slowroads stores `roadProximity` + a flattened road height as vertex
 * attributes. A GLB terrain cannot cheaply grow extra vertex attributes, so the
 * same information is baked into a small runtime DataTexture covering the
 * terrain AABB instead:
 *
 *   R   = distance to the road centerline (0..range meters, 255 = "far")
 *   G,B = 16 bit normalized road surface height
 *   A   = reserved
 */
export interface RoadFieldData extends RoadDistanceSource {
  width: number
  height: number
  minX: number
  minZ: number
  sizeX: number
  sizeZ: number
  /** Distance encoded at full scale (equals maxInfluence). */
  range: number
  minY: number
  maxY: number
  distance: Float32Array
  roadHeight: Float32Array
  memoryBytes: number
  distanceAt(x: number, z: number): number
  heightAt(x: number, z: number): number | null
}

/** 单个追踪节点的左右缘地形高度（横坡贴合模式）。 */
export interface RoadEdgeHeights {
  left: number
  right: number
}

/**
 * 计算每个追踪节点的左右缘地形高度（横坡贴合用，纯函数）。
 *
 * 左右方向与 `createRoadBand` 的顶点排布一致：left = 中心 − perp × halfWidth，
 * right = 中心 + perp × halfWidth，其中 perp = (−sin(heading), cos(heading))。
 * 采样失败回退中线高度；单侧与中线的偏差不超过 `maxLateralDrop`（传
 * Infinity 表示不限制），防止粗网格地形上的局部坑洼造成夸张倾角。
 */
export function computeRoadEdgeHeights(
  nodes: ReadonlyArray<RoadTraceNode>,
  terrainHeightAt: (x: number, z: number) => number | null,
  halfWidth: number,
  maxLateralDrop: number,
): RoadEdgeHeights[] {
  const limit = Number.isFinite(maxLateralDrop) ? Math.max(0, maxLateralDrop) : Number.POSITIVE_INFINITY
  const out: RoadEdgeHeights[] = []
  for (const node of nodes) {
    const perpX = -Math.sin(node.heading)
    const perpZ = Math.cos(node.heading)
    const left = terrainHeightAt(node.x - perpX * halfWidth, node.z - perpZ * halfWidth)
    const right = terrainHeightAt(node.x + perpX * halfWidth, node.z + perpZ * halfWidth)
    const clampSide = (value: number | null): number => (
      value == null ? node.y : clamp(value, node.y - limit, node.y + limit)
    )
    out.push({ left: clampSide(left), right: clampSide(right) })
  }
  return out
}

export interface BuildRoadFieldOptions {
  minX: number
  minZ: number
  sizeX: number
  sizeZ: number
  minY: number
  maxY: number
  maxInfluence: number
  maxResolution?: number
  /**
   * 与 `path` 对齐的左右缘地形高度。提供时烘焙的 roadHeight 为“贴合高度”：
   * 路内（|横向偏移| ≤ halfWidth）在中线到对应边缘之间线性插值，路外取最近
   * 一侧边缘高度作为平台延展（回落由着色器 inner→outer 权重完成）。不提供时
   * 保持现有中线高度行为。
   */
  edgeHeights?: readonly RoadEdgeHeights[] | null
  /** 未提供 edgeHeights 时，可用本回调 + halfWidth 现场计算边缘高度。 */
  terrainHeightAt?: ((x: number, z: number) => number | null) | null
  /** 与 `path` 对齐的中线贴合高度（真实渲染面采样）；缺省回退追踪节点高度。 */
  centerHeights?: readonly number[] | null
  /** 路面半宽（米），贴合高度模式的横向插值基准。 */
  halfWidth?: number | null
  /** 现场计算边缘高度时单侧允许的最大高差（米）；缺省不限制。 */
  maxLateralDrop?: number | null
}

export function encodeRoadDistance(distance: number, range: number): number {
  if (!Number.isFinite(distance) || range <= 0) {
    return 255
  }
  return Math.round(clamp01(distance / range) * 255)
}

export function decodeRoadDistance(byte: number, range: number): number {
  return (clamp(byte, 0, 255) / 255) * range
}

export function encodeRoadHeight(height: number, minY: number, maxY: number): number {
  const span = Math.max(1e-6, maxY - minY)
  return Math.round(clamp01((height - minY) / span) * 65535)
}

export function decodeRoadHeight(value: number, minY: number, maxY: number): number {
  const span = Math.max(1e-6, maxY - minY)
  return minY + (clamp(value, 0, 65535) / 65535) * span
}

export function buildRoadFieldData(
  path: RoadTraceNode[],
  options: BuildRoadFieldOptions,
): RoadFieldData | null {
  if (!Array.isArray(path) || path.length < 2) {
    return null
  }
  const maxResolution = Math.max(64, Math.min(2048, Math.round(options.maxResolution ?? 1024)))
  const sizeX = Math.max(1e-3, options.sizeX)
  const sizeZ = Math.max(1e-3, options.sizeZ)
  const maxAxis = Math.max(sizeX, sizeZ)
  const texel = maxAxis / (maxResolution - 1)
  const width = Math.max(2, Math.min(maxResolution, Math.round(sizeX / texel) + 1))
  const height = Math.max(2, Math.min(maxResolution, Math.round(sizeZ / texel) + 1))
  const cellX = sizeX / (width - 1)
  const cellZ = sizeZ / (height - 1)
  const influence = Math.max(1, options.maxInfluence)
  const sampledHalfWidth = Number.isFinite(options.halfWidth) ? (options.halfWidth ?? 0) : 0
  const edgeHeights = options.edgeHeights ?? (
    typeof options.terrainHeightAt === 'function' && sampledHalfWidth > 0
      ? computeRoadEdgeHeights(
          path,
          options.terrainHeightAt,
          sampledHalfWidth,
          Number.isFinite(options.maxLateralDrop) ? (options.maxLateralDrop ?? 0) : Number.POSITIVE_INFINITY,
        )
      : null
  )
  const draped = edgeHeights !== null && edgeHeights.length >= path.length && sampledHalfWidth > 0
  const centerHeights = draped && options.centerHeights && options.centerHeights.length >= path.length
    ? options.centerHeights
    : null

  const distance = new Float32Array(width * height)
  distance.fill(Number.POSITIVE_INFINITY)
  const roadHeight = new Float32Array(width * height)
  roadHeight.fill(Number.NaN)

  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i]!
    const to = path[i + 1]!
    const ax = from.x
    const az = from.z
    const ay = from.y
    const bx = to.x
    const bz = to.z
    const by = to.y
    const segX = bx - ax
    const segZ = bz - az
    const segLengthSq = segX * segX + segZ * segZ
    if (segLengthSq <= 1e-9) {
      continue
    }
    const segLength = Math.sqrt(segLengthSq)
    // leftDir = (−perp) = (segZ, −segX) / |seg|：正号表示在 left（uv 0）一侧。
    const leftDirX = segZ / segLength
    const leftDirZ = -segX / segLength
    const drapedFrom = draped ? edgeHeights[i]! : null
    const drapedTo = draped ? edgeHeights[i + 1]! : null
    const minSegX = Math.min(ax, bx) - influence
    const maxSegX = Math.max(ax, bx) + influence
    const minSegZ = Math.min(az, bz) - influence
    const maxSegZ = Math.max(az, bz) + influence
    const colStart = Math.max(0, Math.floor((minSegX - options.minX) / cellX))
    const colEnd = Math.min(width - 1, Math.ceil((maxSegX - options.minX) / cellX))
    const rowStart = Math.max(0, Math.floor((minSegZ - options.minZ) / cellZ))
    const rowEnd = Math.min(height - 1, Math.ceil((maxSegZ - options.minZ) / cellZ))
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const pz = options.minZ + row * cellZ
      for (let col = colStart; col <= colEnd; col += 1) {
        const px = options.minX + col * cellX
        const t = clamp(((px - ax) * segX + (pz - az) * segZ) / segLengthSq, 0, 1)
        const closestX = ax + segX * t
        const closestZ = az + segZ * t
        const dx = px - closestX
        const dz = pz - closestZ
        const d = Math.sqrt(dx * dx + dz * dz)
        const index = row * width + col
        if (d <= influence && d < distance[index]!) {
          const centerY = centerHeights
            ? centerHeights[i]! + (centerHeights[i + 1]! - centerHeights[i]!) * t
            : ay + (by - ay) * t
          let targetHeight = centerY
          if (drapedFrom && drapedTo) {
            const leftY = drapedFrom.left + (drapedTo.left - drapedFrom.left) * t
            const rightY = drapedFrom.right + (drapedTo.right - drapedFrom.right) * t
            const signed = (px - ax) * leftDirX + (pz - az) * leftDirZ
            const edgeY = signed >= 0 ? leftY : rightY
            const fraction = Math.min(1, Math.abs(signed) / sampledHalfWidth)
            targetHeight = centerY + (edgeY - centerY) * fraction
          }
          distance[index] = d
          roadHeight[index] = targetHeight
        }
      }
    }
  }

  const field: RoadFieldData = {
    width,
    height,
    minX: options.minX,
    minZ: options.minZ,
    sizeX,
    sizeZ,
    range: influence,
    minY: options.minY,
    maxY: options.maxY,
    distance,
    roadHeight,
    memoryBytes: distance.byteLength + roadHeight.byteLength,
    distanceAt(x: number, z: number): number {
      const fx = clamp01((x - options.minX) / sizeX)
      const fz = clamp01((z - options.minZ) / sizeZ)
      const col = Math.min(width - 1, Math.max(0, Math.round(fx * (width - 1))))
      const row = Math.min(height - 1, Math.max(0, Math.round(fz * (height - 1))))
      const value = distance[row * width + col]!
      return Number.isFinite(value) ? value : influence
    },
    heightAt(x: number, z: number): number | null {
      const fx = clamp01((x - options.minX) / sizeX)
      const fz = clamp01((z - options.minZ) / sizeZ)
      const col = Math.min(width - 1, Math.max(0, Math.round(fx * (width - 1))))
      const row = Math.min(height - 1, Math.max(0, Math.round(fz * (height - 1))))
      const value = roadHeight[row * width + col]!
      return Number.isFinite(value) ? value : null
    },
  }
  return field
}

export function createRoadFieldTexture(field: RoadFieldData): THREE.DataTexture {
  const rgba = new Uint8Array(field.width * field.height * 4)
  for (let i = 0; i < field.width * field.height; i += 1) {
    const distance = field.distance[i]!
    const height = field.roadHeight[i]!
    const distanceByte = encodeRoadDistance(distance, field.range)
    let heightValue = 0
    if (Number.isFinite(height)) {
      heightValue = encodeRoadHeight(height, field.minY, field.maxY)
    }
    rgba[i * 4] = distanceByte
    rgba[i * 4 + 1] = (heightValue >> 8) & 0xff
    rgba[i * 4 + 2] = heightValue & 0xff
    rgba[i * 4 + 3] = 255
  }
  const texture = new THREE.DataTexture(rgba, field.width, field.height, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}
