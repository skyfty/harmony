import * as THREE from 'three'

export type WallChainRange = { startIndex: number; endIndex: number }

export type WallDefinitionAutofillPlan = {
  chainIndex: number
  direction: 1 | -1
  closedLoop: boolean
  score: number
  startArc: number
  endArc: number
  stepLength: number
  segments: Array<{
    start: { x: number; y: number; z: number }
    end: { x: number; y: number; z: number }
  }>
}

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
// ---------------------------------------------------------------------------
// New opening-based helpers (work directly with WallDynamicMesh chains)
// ---------------------------------------------------------------------------
import type { WallDynamicMesh, WallOpening } from '@schema'
import { compileWallSegmentsFromDefinition, computeChainArcLength } from '@schema/wallLayout'

type WallLocalHitOnCompiled = {
  chainIndex: number
  hitArcInChain: number
  erasableRangeStart: number
  erasableRangeEnd: number
  distSq: number
}

type WallLocalHitPreference = {
  preferredChainIndex?: number
  preferredArcStart?: number
  preferredArcEnd?: number
}

function resolveWallLocalHitOnCompiledSegments(
  definition: WallDynamicMesh,
  localPoint: THREE.Vector3,
  preference?: WallLocalHitPreference,
): WallLocalHitOnCompiled | null {
  const compiled = compileWallSegmentsFromDefinition(definition)
  if (!compiled.length) {
    return null
  }

  const preferredChainIndex = Number(preference?.preferredChainIndex)
  const preferredArcStart = Number(preference?.preferredArcStart)
  const preferredArcEnd = Number(preference?.preferredArcEnd)
  const hasPreferredRange = Number.isFinite(preferredChainIndex)
    && Number.isFinite(preferredArcStart)
    && Number.isFinite(preferredArcEnd)
    && preferredArcEnd > preferredArcStart + 1e-6

  const candidateIndices = hasPreferredRange
    ? compiled
        .map((seg, index) => {
          const chainIndex = Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0)))
          if (chainIndex !== Math.max(0, Math.trunc(preferredChainIndex))) {
            return -1
          }
          const segStart = Number(seg.chainArcStart ?? NaN)
          const segLen = Math.sqrt(
            (Number(seg.end.x) - Number(seg.start.x)) ** 2 +
            (Number(seg.end.z) - Number(seg.start.z)) ** 2,
          )
          const segEnd = segStart + segLen
          if (!Number.isFinite(segStart) || !Number.isFinite(segLen) || segLen <= 1e-6) {
            return -1
          }
          if (segEnd <= preferredArcStart + 1e-6 || segStart >= preferredArcEnd - 1e-6) {
            return -1
          }
          return index
        })
        .filter((index) => index >= 0)
    : []

  const indicesToSearch = candidateIndices.length
    ? candidateIndices
    : compiled.map((_, index) => index)

  let bestIndex = -1
  let bestDistSq = Number.POSITIVE_INFINITY
  let bestT = 0

  for (const i of indicesToSearch) {
    const seg = compiled[i]!
    const ax = Number(seg.start.x)
    const az = Number(seg.start.z)
    const bx = Number(seg.end.x)
    const bz = Number(seg.end.z)
    const res = projectPointToSegmentXZ(localPoint.x, localPoint.z, ax, az, bx, bz)
    if (res.distSq < bestDistSq) {
      bestDistSq = res.distSq
      bestIndex = i
      bestT = res.t
    }
  }

  if (bestIndex < 0) {
    return null
  }

  const hitSeg = compiled[bestIndex]!
  const chainIndex = Math.max(0, Math.trunc(Number(hitSeg.chainIndex ?? 0)))
  const chainArcStart = Number(hitSeg.chainArcStart ?? 0)

  const dx = Number(hitSeg.end.x) - Number(hitSeg.start.x)
  const dz = Number(hitSeg.end.z) - Number(hitSeg.start.z)
  const segLen = Math.sqrt(dx * dx + dz * dz)

  if (!Number.isFinite(segLen)) {
    return null
  }

  const contiguousEps = 1e-4
  let erasableRangeStart = chainArcStart
  let erasableRangeEnd = chainArcStart + segLen

  for (let i = bestIndex - 1; i >= 0; i -= 1) {
    const prev = compiled[i]!
    if (Math.max(0, Math.trunc(Number(prev.chainIndex ?? -1))) !== chainIndex) {
      break
    }
    const prevStart = Number(prev.chainArcStart ?? NaN)
    const prevLen = Math.sqrt(
      (Number(prev.end.x) - Number(prev.start.x)) ** 2 +
      (Number(prev.end.z) - Number(prev.start.z)) ** 2,
    )
    if (!Number.isFinite(prevStart) || !Number.isFinite(prevLen)) {
      break
    }
    const prevEnd = prevStart + prevLen
    if (Math.abs(prevEnd - erasableRangeStart) > contiguousEps) {
      break
    }
    erasableRangeStart = prevStart
  }

  for (let i = bestIndex + 1; i < compiled.length; i += 1) {
    const next = compiled[i]!
    if (Math.max(0, Math.trunc(Number(next.chainIndex ?? -1))) !== chainIndex) {
      break
    }
    const nextStart = Number(next.chainArcStart ?? NaN)
    const nextLen = Math.sqrt(
      (Number(next.end.x) - Number(next.start.x)) ** 2 +
      (Number(next.end.z) - Number(next.start.z)) ** 2,
    )
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextLen)) {
      break
    }
    if (Math.abs(nextStart - erasableRangeEnd) > contiguousEps) {
      break
    }
    erasableRangeEnd = nextStart + nextLen
  }

  const hitArcInChain = chainArcStart + Math.max(0, Math.min(1, bestT)) * segLen
  return {
    chainIndex,
    hitArcInChain,
    erasableRangeStart,
    erasableRangeEnd,
    distSq: bestDistSq,
  }
}

function wrapWallChainDistance(totalLen: number, distance: number): number {
  if (!Number.isFinite(totalLen) || totalLen <= 1e-6) {
    return 0
  }
  const wrapped = distance % totalLen
  return wrapped < 0 ? wrapped + totalLen : wrapped
}

function resolveWallDefinitionPointAtDistance(
  definition: WallDynamicMesh,
  chainIndex: number,
  distance: number,
  options: { totalLen: number; closed: boolean },
): { x: number; y: number; z: number } | null {
  const safeDistance = options.closed
    ? wrapWallChainDistance(options.totalLen, distance)
    : Math.max(0, Math.min(options.totalLen, distance))
  return getWallLocalPointAtDefinitionChainDistance(definition, chainIndex, safeDistance)
}

function computeClosedArcTravel(from: number, to: number, totalLen: number): number {
  return wrapWallChainDistance(totalLen, to - from)
}

export function computeWallAutofillPlanForDefinition(
  definition: WallDynamicMesh,
  placedStartLocal: THREE.Vector3,
  placedEndLocal: THREE.Vector3,
  stepLength: number,
): WallDefinitionAutofillPlan | null {
  const step = Math.max(1e-6, Number(stepLength))
  if (!Number.isFinite(step) || step <= 1e-6) {
    return null
  }

  const startHit = resolveWallLocalHitOnCompiledSegments(definition, placedStartLocal)
  if (!startHit) {
    return null
  }

  const endHit = resolveWallLocalHitOnCompiledSegments(definition, placedEndLocal, {
    preferredChainIndex: startHit.chainIndex,
    preferredArcStart: startHit.erasableRangeStart,
    preferredArcEnd: startHit.erasableRangeEnd,
  })
  if (!endHit || endHit.chainIndex !== startHit.chainIndex) {
    return null
  }

  const chainIndex = startHit.chainIndex
  const chain = definition.chains?.[chainIndex]
  if (!chain) {
    return null
  }

  const totalLen = computeChainArcLength(chain)
  if (!Number.isFinite(totalLen) || totalLen <= 1e-6) {
    return null
  }

  const startArc = Math.max(0, Math.min(totalLen, startHit.hitArcInChain))
  const endArc = Math.max(0, Math.min(totalLen, endHit.hitArcInChain))
  const availableStart = Math.max(0, Math.min(totalLen, startHit.erasableRangeStart))
  const availableEnd = Math.max(0, Math.min(totalLen, endHit.erasableRangeEnd))
  const availableSpan = Math.max(0, availableEnd - availableStart)
  const closedLoop = Boolean(chain.closed) && availableSpan >= totalLen - 1e-4

  let direction: 1 | -1 = 1
  let remaining = 0

  if (closedLoop) {
    const forwardTravel = computeClosedArcTravel(startArc, endArc, totalLen)
    const backwardTravel = computeClosedArcTravel(endArc, startArc, totalLen)
    const placedLen = Math.min(forwardTravel, backwardTravel)
    if (!Number.isFinite(placedLen) || placedLen <= 1e-6 || placedLen >= totalLen - 1e-6) {
      return null
    }
    direction = forwardTravel <= backwardTravel ? 1 : -1
    remaining = totalLen - placedLen
  } else {
    const delta = endArc - startArc
    if (!Number.isFinite(delta) || Math.abs(delta) <= 1e-6) {
      return null
    }
    direction = delta >= 0 ? 1 : -1
    remaining = direction > 0
      ? Math.max(0, availableEnd - endArc)
      : Math.max(0, endArc - availableStart)
  }

  if (!Number.isFinite(remaining) || remaining <= 1e-6) {
    return null
  }

  const segments: WallDefinitionAutofillPlan['segments'] = []
  let currentDistance = endArc
  let remainingDistance = remaining
  const maxIterations = Math.min(4096, Math.ceil(remaining / step) + 2)

  for (let index = 0; index < maxIterations && remainingDistance > 1e-6; index += 1) {
    const segmentLen = remainingDistance <= step + 1e-6 ? remainingDistance : step
    const nextDistance = currentDistance + direction * segmentLen
    const start = resolveWallDefinitionPointAtDistance(definition, chainIndex, currentDistance, {
      totalLen,
      closed: closedLoop,
    })
    const end = resolveWallDefinitionPointAtDistance(definition, chainIndex, nextDistance, {
      totalLen,
      closed: closedLoop,
    })
    if (!start || !end) {
      break
    }
    if (distanceSqXZ(start.x, start.z, end.x, end.z) > 1e-10) {
      segments.push({ start, end })
    }
    currentDistance = closedLoop
      ? wrapWallChainDistance(totalLen, nextDistance)
      : Math.max(availableStart, Math.min(availableEnd, nextDistance))
    remainingDistance -= segmentLen
  }

  if (!segments.length) {
    return null
  }

  return {
    chainIndex,
    direction,
    closedLoop,
    score: startHit.distSq + endHit.distSq,
    startArc,
    endArc,
    stepLength: step,
    segments,
  }
}

/**
 * Given a local-space hit point on a wall object, compute the WallOpening that
 * should be added for a manual erase of `halfLenM` metres either side.
 *
 * Uses the compiled render segments so the hit test works against the visual mesh,
 * then converts arc-lengths back to the original chain coordinates.
 *
 * Returns null if no suitable hit is found.
 */
export function computeWallOpeningForLocalHit(
  definition: WallDynamicMesh,
  localPoint: THREE.Vector3,
  halfLenM: number,
  preference?: WallLocalHitPreference,
): WallOpening | null {
  const hit = resolveWallLocalHitOnCompiledSegments(definition, localPoint, preference)
  if (!hit) {
    return null
  }

  const half = Math.max(0, Number(halfLenM))
  const start = Math.max(hit.erasableRangeStart, hit.hitArcInChain - half)
  const end = Math.min(hit.erasableRangeEnd, hit.hitArcInChain + half)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= 1e-6) {
    return null
  }

  return {
    chainIndex: hit.chainIndex,
    start,
    end,
  }
}

/**
 * Compute a fixed-width opening centered on the nearest wall hit, aligned to
 * chain-origin buckets: [k*unit, (k+1)*unit].
 */
export function computeWallOpeningAlignedForLocalHit(
  definition: WallDynamicMesh,
  localPoint: THREE.Vector3,
  unitLenM: number,
): WallOpening | null {
  const hit = resolveWallLocalHitOnCompiledSegments(definition, localPoint)
  if (!hit) {
    return null
  }

  const chain = definition.chains?.[hit.chainIndex]
  if (!chain) {
    return null
  }

  const chainTotalLen = computeChainArcLength(chain)
  const unit = Math.max(1e-6, Math.abs(Number(unitLenM)))
  const bucket = Math.floor(hit.hitArcInChain / unit)
  const start = Math.max(0, Math.min(chainTotalLen, bucket * unit))
  const end = Math.min(chainTotalLen, start + unit)

  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= 1e-6) {
    return null
  }

  return {
    chainIndex: hit.chainIndex,
    start,
    end,
  }
}

export function getWallLocalPointAtDefinitionChainDistance(
  definition: WallDynamicMesh,
  chainIndex: number,
  distance: number,
): { x: number; y: number; z: number } | null {
  const chain = definition.chains?.[Math.max(0, Math.trunc(chainIndex))]
  if (!chain) {
    return null
  }

  const points = Array.isArray(chain.points) ? chain.points : []
  if (points.length < 2) {
    return null
  }

  const closed = Boolean(chain.closed)
  const segmentCount = closed ? points.length : points.length - 1
  const eps = 1e-6

  let totalLen = 0
  const lengths: number[] = []
  for (let i = 0; i < segmentCount; i += 1) {
    const start = points[i]!
    const end = points[(i + 1) % points.length]!
    const dx = Number(end.x) - Number(start.x)
    const dz = Number(end.z) - Number(start.z)
    const len = Math.sqrt(dx * dx + dz * dz)
    const safeLen = Number.isFinite(len) && len > eps ? len : 0
    lengths.push(safeLen)
    totalLen += safeLen
  }

  if (totalLen <= eps) {
    return null
  }

  const target = Math.max(0, Math.min(totalLen, Number(distance)))
  let cursor = 0
  for (let i = 0; i < segmentCount; i += 1) {
    const len = lengths[i] ?? 0
    if (len <= eps) {
      continue
    }
    const startArc = cursor
    const endArc = cursor + len
    if (target <= endArc + eps) {
      const start = points[i]!
      const end = points[(i + 1) % points.length]!
      const t = Math.max(0, Math.min(1, (target - startArc) / len))
      return {
        x: Number(start.x) + (Number(end.x) - Number(start.x)) * t,
        y: Number(start.y) + (Number(end.y) - Number(start.y)) * t,
        z: Number(start.z) + (Number(end.z) - Number(start.z)) * t,
      }
    }
    cursor = endArc
  }

  const tail = points[points.length - 1]!
  return {
    x: Number(tail.x),
    y: Number(tail.y),
    z: Number(tail.z),
  }
}

/**
 * Find the index of a `WallOpening` that contains the projection of `localPoint`
 * onto the nearest chain. Returns -1 if no opening is close.
 */
export function findContainingWallOpeningIndex(
  definition: WallDynamicMesh,
  localPoint: THREE.Vector3,
): number {
  const chains = Array.isArray(definition.chains) ? definition.chains : []
  const openings = Array.isArray(definition.openings) ? definition.openings : []
  if (!openings.length) return -1

  // Find nearest point on any chain and its arc-length
  let bestChainIndex = -1
  let bestDistSq = Number.POSITIVE_INFINITY
  let bestArc = 0

  const eps = 1e-6

  for (let ci = 0; ci < chains.length; ci += 1) {
    const chain = chains[ci]!
    const pts = Array.isArray(chain.points) ? chain.points : []
    const loopCount = chain.closed ? pts.length : pts.length - 1
    let arc = 0
    for (let i = 0; i < loopCount; i += 1) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      const ax = Number(a.x)
      const az = Number(a.z)
      const bx = Number(b.x)
      const bz = Number(b.z)
      const dx = bx - ax
      const dz = bz - az
      const lenSq = dx * dx + dz * dz
      const len = lenSq > eps ? Math.sqrt(lenSq) : 0

      const res = projectPointToSegmentXZ(localPoint.x, localPoint.z, ax, az, bx, bz)
      if (res.distSq < bestDistSq) {
        bestDistSq = res.distSq
        bestChainIndex = ci
        bestArc = arc + Math.max(0, Math.min(1, res.t)) * len
      }
      arc += len
    }
  }

  if (bestChainIndex < 0) return -1

  // Find which opening contains bestArc on bestChainIndex
  for (let oi = 0; oi < openings.length; oi += 1) {
    const o = openings[oi]!
    if (Number(o.chainIndex) === bestChainIndex && bestArc >= Number(o.start) - 0.01 && bestArc <= Number(o.end) + 0.01) {
      return oi
    }
  }
  return -1
}