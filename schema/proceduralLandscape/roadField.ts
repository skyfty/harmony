import * as THREE from 'three'
import type { RoadTraceNode } from './roadTrace'
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
export interface RoadFieldData {
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

export interface BuildRoadFieldOptions {
  minX: number
  minZ: number
  sizeX: number
  sizeZ: number
  minY: number
  maxY: number
  maxInfluence: number
  maxResolution?: number
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
          distance[index] = d
          roadHeight[index] = ay + (by - ay) * t
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
