import * as THREE from 'three'

export type WallChainRange = { startIndex: number; endIndex: number }

export type WallSegmentDimensions = {
  height: number
  width: number
  thickness: number
}

export function distanceSqXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

export function projectPointToSegmentXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distSq: number; t: number } {
  const abx = bx - ax
  const abz = bz - az
  const apx = px - ax
  const apz = pz - az
  const abLenSq = abx * abx + abz * abz
  if (!Number.isFinite(abLenSq) || abLenSq <= 1e-12) {
    const dx = px - ax
    const dz = pz - az
    return { distSq: dx * dx + dz * dz, t: 0 }
  }
  let t = (apx * abx + apz * abz) / abLenSq
  if (t < 0) t = 0
  if (t > 1) t = 1
  const cx = ax + abx * t
  const cz = az + abz * t
  const dx = px - cx
  const dz = pz - cz
  return { distSq: dx * dx + dz * dz, t }
}

export function projectPointToLineXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distSq: number; t: number } {
  const abx = bx - ax
  const abz = bz - az
  const apx = px - ax
  const apz = pz - az
  const abLenSq = abx * abx + abz * abz
  if (!Number.isFinite(abLenSq) || abLenSq <= 1e-12) {
    const dx = px - ax
    const dz = pz - az
    return { distSq: dx * dx + dz * dz, t: 0 }
  }
  const t = (apx * abx + apz * abz) / abLenSq
  const cx = ax + abx * t
  const cz = az + abz * t
  const dx = px - cx
  const dz = pz - cz
  return { distSq: dx * dx + dz * dz, t }
}

function snapRepairSegmentToExistingEndpoints(
  segments: any[],
  repair: {
    start: { x: number; y: number; z: number }
    end: { x: number; y: number; z: number }
    center: { x: number; y: number; z: number }
  },
  options: { snapTolSq?: number } = {},
): { start: any; end: any } {
  const snapTolSq = Number.isFinite(options.snapTolSq) ? Number(options.snapTolSq) : 1e-4

  const sx = Number(repair.start?.x)
  const sz = Number(repair.start?.z)
  const ex = Number(repair.end?.x)
  const ez = Number(repair.end?.z)
  const cx = Number(repair.center?.x)
  const cz = Number(repair.center?.z)

  if (!Number.isFinite(sx + sz + ex + ez + cx + cz)) {
    return { start: repair.start, end: repair.end }
  }

  const dx = ex - sx
  const dz = ez - sz
  const lenSq = dx * dx + dz * dz
  if (!Number.isFinite(lenSq) || lenSq <= 1e-12) {
    return { start: repair.start, end: repair.end }
  }

  const len = Math.sqrt(lenSq)
  if (!Number.isFinite(len) || len <= 1e-6) {
    return { start: repair.start, end: repair.end }
  }

  const ux = dx / len
  const uz = dz / len
  const half = len * 0.5

  let bestStart: any = null
  let bestEnd: any = null

  const consider = (p: any) => {
    const px = Number(p?.x)
    const pz = Number(p?.z)
    if (!Number.isFinite(px + pz)) {
      return
    }
    const s = (px - cx) * ux + (pz - cz) * uz
    if (s < -half - 1e-3 || s > half + 1e-3) {
      return
    }

    const projX = cx + ux * s
    const projZ = cz + uz * s
    const ddx = px - projX
    const ddz = pz - projZ
    const distSq = ddx * ddx + ddz * ddz
    if (!Number.isFinite(distSq) || distSq > snapTolSq) {
      return
    }

    if (s <= 0) {
      if (!bestStart || s > bestStart.s || (Math.abs(s - bestStart.s) < 1e-9 && distSq < bestStart.distSq)) {
        bestStart = { point: p, s, distSq }
      }
    } else {
      if (!bestEnd || s < bestEnd.s || (Math.abs(s - bestEnd.s) < 1e-9 && distSq < bestEnd.distSq)) {
        bestEnd = { point: p, s, distSq }
      }
    }
  }

  for (const seg of segments) {
    if (!seg) continue
    consider(seg.start)
    consider(seg.end)
  }

  return {
    start: bestStart?.point ?? repair.start,
    end: bestEnd?.point ?? repair.end,
  }
}

function mergeAdjacentWallSegments(segments: any[]): any[] {
  const eps = 1e-6

  const areColinearXZ = (a: any, b: any): boolean => {
    const ax = Number(a?.start?.x)
    const az = Number(a?.start?.z)
    const bx = Number(a?.end?.x)
    const bz = Number(a?.end?.z)
    const cx = Number(b?.start?.x)
    const cz = Number(b?.start?.z)
    const dx = Number(b?.end?.x)
    const dz = Number(b?.end?.z)
    if (!Number.isFinite(ax + az + bx + bz + cx + cz + dx + dz)) {
      return false
    }

    const v0x = bx - ax
    const v0z = bz - az
    const v1x = dx - cx
    const v1z = dz - cz
    const l0 = Math.sqrt(v0x * v0x + v0z * v0z)
    const l1 = Math.sqrt(v1x * v1x + v1z * v1z)
    if (!Number.isFinite(l0) || !Number.isFinite(l1) || l0 <= eps || l1 <= eps) {
      return false
    }
    const dot = (v0x / l0) * (v1x / l1) + (v0z / l0) * (v1z / l1)
    return Number.isFinite(dot) && dot >= 0.9999
  }

  const merged: any[] = []
  for (const seg of segments) {
    const current = seg
    const prev = merged[merged.length - 1]
    if (!prev) {
      merged.push(current)
      continue
    }
    const prevLen = segmentLengthXZ(prev)
    const curLen = segmentLengthXZ(current)
    if (prevLen <= eps) {
      merged.pop()
      merged.push(current)
      continue
    }
    if (curLen <= eps) {
      continue
    }
    const contSq = distanceSqXZ(
      Number(prev?.end?.x),
      Number(prev?.end?.z),
      Number(current?.start?.x),
      Number(current?.start?.z),
    )
    const sameProps =
      Number(prev?.height) === Number(current?.height) &&
      Number(prev?.width) === Number(current?.width) &&
      Number(prev?.thickness) === Number(current?.thickness)
    if (Number.isFinite(contSq) && contSq <= 1e-8 && sameProps && areColinearXZ(prev, current)) {
      merged[merged.length - 1] = { ...prev, end: current.end }
      continue
    }
    merged.push(current)
  }

  return merged
}

export function computeWallRepairUnitSegmentForLocalPoint(
  segments: any[],
  localPoint: THREE.Vector3,
  unitLenM: number,
): {
  bestIndex: number
  distSq: number
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
  center: { x: number; y: number; z: number }
} | null {
  const unit = Math.max(1e-6, Number(unitLenM))
  const half = unit * 0.5

  let bestIndex = -1
  let bestDistSq = Number.POSITIVE_INFINITY
  let bestT = 0

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (!seg) continue
    const ax = Number(seg.start?.x)
    const az = Number(seg.start?.z)
    const bx = Number(seg.end?.x)
    const bz = Number(seg.end?.z)
    if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) {
      continue
    }
    const projected = projectPointToLineXZ(localPoint.x, localPoint.z, ax, az, bx, bz)
    if (projected.distSq < bestDistSq) {
      bestDistSq = projected.distSq
      bestIndex = i
      bestT = projected.t
    }
  }

  if (bestIndex < 0) {
    return null
  }

  const seg = segments[bestIndex]
  const ax = Number(seg.start?.x)
  const az = Number(seg.start?.z)
  const bx = Number(seg.end?.x)
  const bz = Number(seg.end?.z)

  const dx = bx - ax
  const dz = bz - az
  const lenSq = dx * dx + dz * dz
  if (!Number.isFinite(lenSq) || lenSq <= 1e-12) {
    return null
  }
  const len = Math.sqrt(lenSq)
  if (!Number.isFinite(len) || len <= 1e-6) {
    return null
  }

  const ux = dx / len
  const uz = dz / len

  const centerX = ax + dx * bestT
  const centerZ = az + dz * bestT

  // Keep y coherent with the nearest segment by clamping the param.
  const tClamp = Math.max(0, Math.min(1, bestT))
  const centerPoint = interpolatePoint(seg.start, seg.end, tClamp)
  const centerY = Number.isFinite(Number(centerPoint?.y)) ? Number(centerPoint.y) : Number(seg.start?.y)

  const start = { x: centerX - ux * half, y: centerY, z: centerZ - uz * half }
  const end = { x: centerX + ux * half, y: centerY, z: centerZ + uz * half }

  const snapped = snapRepairSegmentToExistingEndpoints(segments, {
    start,
    end,
    center: { x: centerX, y: centerY, z: centerZ },
  })

  return {
    bestIndex,
    distSq: bestDistSq,
    start: snapped.start,
    end: snapped.end,
    center: { x: centerX, y: centerY, z: centerZ },
  }
}

export function insertWallRepairSegmentIntoSegments(
  segments: any[],
  repairSegment: any,
  options: { preferredIndex?: number; snapEpsSq?: number } = {},
): any[] {
  const preferredIndex = Number.isFinite(options.preferredIndex) ? Number(options.preferredIndex) : -1
  const snapEpsSq = Number.isFinite(options.snapEpsSq) ? Number(options.snapEpsSq) : 1e-8
  if (!repairSegment) {
    return segments
  }

  const candidateA = repairSegment
  const candidateB = { ...repairSegment, start: repairSegment.end, end: repairSegment.start }

  const scoreCandidate = (candidate: any) => {
    let afterIndex = -1
    let beforeIndex = -1
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]
      if (!seg) continue
      const afterSq = distanceSqXZ(
        Number(seg?.end?.x),
        Number(seg?.end?.z),
        Number(candidate?.start?.x),
        Number(candidate?.start?.z),
      )
      if (Number.isFinite(afterSq) && afterSq <= snapEpsSq) {
        afterIndex = i
      }
      const beforeSq = distanceSqXZ(
        Number(candidate?.end?.x),
        Number(candidate?.end?.z),
        Number(seg?.start?.x),
        Number(seg?.start?.z),
      )
      if (Number.isFinite(beforeSq) && beforeSq <= snapEpsSq) {
        beforeIndex = i
        break
      }
    }
    const score = (afterIndex >= 0 ? 1 : 0) + (beforeIndex >= 0 ? 1 : 0)
    return { score, afterIndex, beforeIndex }
  }

  const aScore = scoreCandidate(candidateA)
  const bScore = scoreCandidate(candidateB)
  const chosen = bScore.score > aScore.score ? candidateB : candidateA
  const chosenScore = bScore.score > aScore.score ? bScore : aScore

  // Snap endpoints if we have a match so chains remain contiguous.
  if (chosenScore.afterIndex >= 0) {
    const prev = segments[chosenScore.afterIndex]
    if (prev?.end) {
      chosen.start = prev.end
    }
  }
  if (chosenScore.beforeIndex >= 0) {
    const next = segments[chosenScore.beforeIndex]
    if (next?.start) {
      chosen.end = next.start
    }
  }

  const insertAt =
    chosenScore.afterIndex >= 0
      ? chosenScore.afterIndex + 1
      : chosenScore.beforeIndex >= 0
        ? chosenScore.beforeIndex
        : preferredIndex >= 0 && preferredIndex < segments.length
          ? preferredIndex + 1
          : segments.length

  const next = [...segments.slice(0, insertAt), chosen, ...segments.slice(insertAt)]
  return mergeAdjacentWallSegments(next)
}

export function segmentLengthXZ(seg: any): number {
  const ax = Number(seg?.start?.x)
  const az = Number(seg?.start?.z)
  const bx = Number(seg?.end?.x)
  const bz = Number(seg?.end?.z)
  if (!Number.isFinite(ax + az + bx + bz)) {
    return 0
  }
  const dx = bx - ax
  const dz = bz - az
  const len = Math.sqrt(dx * dx + dz * dz)
  return Number.isFinite(len) ? len : 0
}

export function interpolatePoint(a: any, b: any, t: number) {
  return {
    x: Number(a?.x) + (Number(b?.x) - Number(a?.x)) * t,
    y: Number(a?.y) + (Number(b?.y) - Number(a?.y)) * t,
    z: Number(a?.z) + (Number(b?.z) - Number(a?.z)) * t,
  }
}

export function splitWallSegmentsIntoChains(segments: any[]): WallChainRange[] {
  const chains: WallChainRange[] = []
  let startIndex = 0
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (!seg) {
      continue
    }
    const prev = i > startIndex ? segments[i - 1] : null
    if (prev) {
      const distSq = distanceSqXZ(
        Number((prev as any)?.end?.x),
        Number((prev as any)?.end?.z),
        Number((seg as any)?.start?.x),
        Number((seg as any)?.start?.z),
      )
      if (!Number.isFinite(distSq) || distSq > 1e-8) {
        chains.push({ startIndex, endIndex: i - 1 })
        startIndex = i
      }
    }
  }
  chains.push({ startIndex, endIndex: Math.max(startIndex, segments.length - 1) })
  return chains
}

export function computeWallEraseIntervalForLocalPoint(
  segments: any[],
  localPoint: THREE.Vector3,
  halfLenM: number,
): { chain: WallChainRange; rangeStart: number; rangeEnd: number; chainTotalLen: number } | null {
  let bestIndex = -1
  let bestDistSq = Number.POSITIVE_INFINITY
  let bestT = 0

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (!seg) continue
    const ax = Number(seg.start?.x)
    const az = Number(seg.start?.z)
    const bx = Number(seg.end?.x)
    const bz = Number(seg.end?.z)
    if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) {
      continue
    }
    const projected = projectPointToSegmentXZ(localPoint.x, localPoint.z, ax, az, bx, bz)
    if (projected.distSq < bestDistSq) {
      bestDistSq = projected.distSq
      bestIndex = i
      bestT = projected.t
    }
  }

  if (bestIndex < 0) {
    return null
  }

  const chains = splitWallSegmentsIntoChains(segments)
  const chain = chains.find((c) => bestIndex >= c.startIndex && bestIndex <= c.endIndex) ?? null
  if (!chain) {
    return null
  }

  let chainCursorDist = 0
  let segStartDist = 0
  let segEndDist = 0
  for (let i = chain.startIndex; i <= chain.endIndex; i += 1) {
    const seg = segments[i]
    const len = seg ? segmentLengthXZ(seg) : 0
    const start = chainCursorDist
    const end = chainCursorDist + len
    if (i === bestIndex) {
      segStartDist = start
      segEndDist = end
      break
    }
    chainCursorDist = end
  }

  let chainTotalLen = 0
  for (let i = chain.startIndex; i <= chain.endIndex; i += 1) {
    chainTotalLen += segments[i] ? segmentLengthXZ(segments[i]) : 0
  }

  const segLen = Math.max(0, segEndDist - segStartDist)
  const hitDist = segStartDist + Math.max(0, Math.min(1, bestT)) * segLen
  const rangeStart = Math.max(0, hitDist - halfLenM)
  const rangeEnd = Math.min(chainTotalLen, hitDist + halfLenM)

  if (rangeEnd - rangeStart <= 1e-6) {
    return null
  }

  return { chain, rangeStart, rangeEnd, chainTotalLen }
}

export function computeWallEraseUnitIntervalAlignedForLocalPoint(
  segments: any[],
  localPoint: THREE.Vector3,
  unitLenM: number,
): { chain: WallChainRange; rangeStart: number; rangeEnd: number; chainTotalLen: number } | null {
  const unit = Math.max(1e-6, Number(unitLenM))

  let bestIndex = -1
  let bestDistSq = Number.POSITIVE_INFINITY
  let bestT = 0

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (!seg) continue
    const ax = Number(seg.start?.x)
    const az = Number(seg.start?.z)
    const bx = Number(seg.end?.x)
    const bz = Number(seg.end?.z)
    if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) {
      continue
    }
    const projected = projectPointToSegmentXZ(localPoint.x, localPoint.z, ax, az, bx, bz)
    if (projected.distSq < bestDistSq) {
      bestDistSq = projected.distSq
      bestIndex = i
      bestT = projected.t
    }
  }

  if (bestIndex < 0) {
    return null
  }

  const chains = splitWallSegmentsIntoChains(segments)
  const chain = chains.find((c) => bestIndex >= c.startIndex && bestIndex <= c.endIndex) ?? null
  if (!chain) {
    return null
  }

  let chainCursorDist = 0
  let segStartDist = 0
  let segEndDist = 0
  for (let i = chain.startIndex; i <= chain.endIndex; i += 1) {
    const seg = segments[i]
    const len = seg ? segmentLengthXZ(seg) : 0
    const start = chainCursorDist
    const end = chainCursorDist + len
    if (i === bestIndex) {
      segStartDist = start
      segEndDist = end
      break
    }
    chainCursorDist = end
  }

  let chainTotalLen = 0
  for (let i = chain.startIndex; i <= chain.endIndex; i += 1) {
    chainTotalLen += segments[i] ? segmentLengthXZ(segments[i]) : 0
  }

  const segLen = Math.max(0, segEndDist - segStartDist)
  const hitDist = segStartDist + Math.max(0, Math.min(1, bestT)) * segLen

  // Snap to chain-origin grid: [k*unit, (k+1)*unit]
  const k = Math.floor(hitDist / unit)
  const rangeStart = Math.max(0, Math.min(chainTotalLen, k * unit))
  const rangeEnd = Math.min(chainTotalLen, rangeStart + unit)

  if (rangeEnd - rangeStart <= 1e-6) {
    return null
  }

  return { chain, rangeStart, rangeEnd, chainTotalLen }
}

export function getWallLocalPointAtChainDistance(
  segments: any[],
  chain: WallChainRange,
  dist: number,
): { x: number; y: number; z: number } | null {
  const target = Math.max(0, dist)
  let cursor = 0
  for (let i = chain.startIndex; i <= chain.endIndex; i += 1) {
    const seg = segments[i]
    if (!seg) continue
    const len = segmentLengthXZ(seg)
    const segStart = cursor
    const segEnd = cursor + len
    if (len > 1e-6 && target <= segEnd + 1e-6) {
      const t = Math.max(0, Math.min(1, (target - segStart) / len))
      return interpolatePoint(seg.start, seg.end, t)
    }
    cursor = segEnd
  }
  const last = segments[chain.endIndex]
  if (last) {
    return { x: Number(last.end?.x), y: Number(last.end?.y), z: Number(last.end?.z) }
  }
  return null
}

export function applyEraseIntervalToSegments(
  segments: any[],
  chain: WallChainRange,
  rangeStart: number,
  rangeEnd: number,
): any[] {
  const nextSegments: any[] = []
  const eps = 1e-6

  // Copy segments before the chain.
  for (let i = 0; i < chain.startIndex; i += 1) {
    nextSegments.push(segments[i])
  }

  // Split segments within the chain by the erase interval.
  let cursor = 0
  for (let i = chain.startIndex; i <= chain.endIndex; i += 1) {
    const seg = segments[i]
    if (!seg) continue
    const len = segmentLengthXZ(seg)
    const segStart = cursor
    const segEnd = cursor + len
    cursor = segEnd
    if (!Number.isFinite(len) || len <= eps) continue
    const overlapStart = Math.max(segStart, rangeStart)
    const overlapEnd = Math.min(segEnd, rangeEnd)
    if (overlapEnd <= overlapStart + eps) {
      nextSegments.push(seg)
      continue
    }
    if (overlapStart > segStart + eps) {
      const t1 = (overlapStart - segStart) / len
      nextSegments.push({ ...seg, start: interpolatePoint(seg.start, seg.end, 0), end: interpolatePoint(seg.start, seg.end, t1) })
    }
    if (overlapEnd < segEnd - eps) {
      const t0 = (overlapEnd - segStart) / len
      nextSegments.push({ ...seg, start: interpolatePoint(seg.start, seg.end, t0), end: interpolatePoint(seg.start, seg.end, 1) })
    }
  }

  // Copy segments after the chain.
  for (let i = chain.endIndex + 1; i < segments.length; i += 1) {
    nextSegments.push(segments[i])
  }

  return mergeAdjacentWallSegments(nextSegments)
}
