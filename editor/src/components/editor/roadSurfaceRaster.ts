import {
  collectRoadSurfaceChunkKeysForStrip,
  normalizeRoadSurfaceChunkAssetMap,
  parseRoadSurfaceChunkKey,
  resolveRoadSurfaceChunkBounds,
  type RoadDynamicMesh,
} from '@schema'

const DEFAULT_SURFACE_CHUNK_RESOLUTION = 64

function decodeBase64ToBytes(base64: string): Uint8Array | null {
  const normalized = base64.trim()
  if (!normalized.length) {
    return null
  }
  try {
    const binary = atob(normalized)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i)
    }
    return out
  } catch (_error) {
    return null
  }
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function expectedCoverageByteLength(resolution: number): number {
  const cellCount = Math.max(1, Math.trunc(resolution)) ** 2
  return Math.ceil(cellCount / 8)
}

function decodeCoverageBits(base64: string | null | undefined, resolution: number): Uint8Array {
  const expected = expectedCoverageByteLength(resolution)
  const decoded = typeof base64 === 'string' ? decodeBase64ToBytes(base64) : null
  if (!decoded || decoded.length !== expected) {
    return new Uint8Array(expected)
  }
  return decoded.slice()
}

function getCoverageBit(bits: Uint8Array, index: number): 0 | 1 {
  const byteIndex = index >> 3
  const bitMask = 1 << (index & 7)
  return (bits[byteIndex]! & bitMask) !== 0 ? 1 : 0
}

function setCoverageBit(bits: Uint8Array, index: number, value: 0 | 1): void {
  const byteIndex = index >> 3
  const bitMask = 1 << (index & 7)
  if (value) {
    bits[byteIndex] = bits[byteIndex]! | bitMask
  } else {
    bits[byteIndex] = bits[byteIndex]! & ~bitMask
  }
}

function pointToSegmentDistanceSquared(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax
  const abz = bz - az
  const apx = px - ax
  const apz = pz - az
  const len2 = abx * abx + abz * abz
  if (len2 <= 1e-12) {
    return apx * apx + apz * apz
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / len2))
  const qx = ax + abx * t
  const qz = az + abz * t
  const dx = px - qx
  const dz = pz - qz
  return dx * dx + dz * dz
}

function isPointInsideStroke(
  x: number,
  z: number,
  polyline: Array<{ x: number; z: number }>,
  radius: number,
): boolean {
  if (!polyline.length) {
    return false
  }
  const r2 = radius * radius
  if (polyline.length === 1) {
    const dx = x - polyline[0]!.x
    const dz = z - polyline[0]!.z
    return dx * dx + dz * dz <= r2
  }
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = polyline[i]!
    const b = polyline[i + 1]!
    if (pointToSegmentDistanceSquared(x, z, a.x, a.z, b.x, b.z) <= r2) {
      return true
    }
  }
  return false
}

export function applyRoadSurfaceStrokeToChunks(params: {
  mesh: RoadDynamicMesh
  localPolyline: Array<{ x: number; z: number }>
  strokeWidth: number
  erase?: boolean
}): RoadDynamicMesh['roadSurfaceChunks'] | null {
  const { mesh, localPolyline } = params
  const erase = Boolean(params.erase)
  if (!Array.isArray(localPolyline) || localPolyline.length === 0) {
    const existing = normalizeRoadSurfaceChunkAssetMap(mesh.roadSurfaceChunks)
    return Object.keys(existing).length ? existing : null
  }

  const normalizedWidth = Number.isFinite(params.strokeWidth) ? Math.max(0.1, params.strokeWidth) : Math.max(0.1, mesh.width)
  const brushFalloff = typeof mesh.brushFalloff === 'number' ? mesh.brushFalloff : 0
  const falloff = Number.isFinite(brushFalloff) ? Math.max(0, brushFalloff) : 0
  const radius = normalizedWidth * 0.5 + falloff

  const existing = normalizeRoadSurfaceChunkAssetMap(mesh.roadSurfaceChunks)
  const chunkKeys = collectRoadSurfaceChunkKeysForStrip(mesh, localPolyline, normalizedWidth)
  const next = { ...existing }

  for (const chunkKey of chunkKeys) {
    const parts = parseRoadSurfaceChunkKey(chunkKey)
    if (!parts) {
      continue
    }
    const prev = next[chunkKey]
    const resolution = Math.max(1, Math.trunc(prev?.resolution ?? DEFAULT_SURFACE_CHUNK_RESOLUTION))
    const bits = decodeCoverageBits(prev?.coverageData, resolution)
    const bounds = resolveRoadSurfaceChunkBounds(mesh, parts.chunkRow, parts.chunkColumn)
    const cellSizeX = bounds.width / resolution
    const cellSizeZ = bounds.depth / resolution

    let changed = false
    for (let row = 0; row < resolution; row += 1) {
      const cz = bounds.minZ + (row + 0.5) * cellSizeZ
      for (let col = 0; col < resolution; col += 1) {
        const cx = bounds.minX + (col + 0.5) * cellSizeX
        if (!isPointInsideStroke(cx, cz, localPolyline, radius)) {
          continue
        }
        const index = row * resolution + col
        const current = getCoverageBit(bits, index)
        const target: 0 | 1 = erase ? 0 : 1
        if (current !== target) {
          setCoverageBit(bits, index, target)
          changed = true
        }
      }
    }

    if (!changed) {
      continue
    }

    const hasAnyCoverage = bits.some((byte) => byte !== 0)
    if (!hasAnyCoverage) {
      delete next[chunkKey]
      continue
    }

    next[chunkKey] = {
      revision: Math.max(0, Math.trunc(prev?.revision ?? 0)) + 1,
      resolution,
      coverageAssetId: null,
      heightAssetId: null,
      coverageData: encodeBytesToBase64(bits),
      heightData: prev?.heightData ?? null,
    }
  }

  return Object.keys(next).length ? next : null
}
