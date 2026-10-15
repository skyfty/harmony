import { BARRIER_RAIL_REGIONS } from '../slowroads/core/spriteRegions'
import { hashUnit } from './noise'
import type { TerrainHeightGrid } from './terrainSampler'
import type { RoadTraceNode } from './roadTrace'

/**
 * 下坡侧木护栏（slowroads-lab `core/barrier.ts` 移植，平台无关）。
 *
 * 规则：沿路每 2m 采样；把肩外 12m（已越过道路压平带）的地形与肩沿地形比较，
 * 落差超过阈值（默认 1.2m）的一侧才可能放置；同一侧至少间隔 spacing（默认 8m），
 * 再按密度门限筛一遍。护栏段贴地（y 取道路高度 - 0.02，即压平后的可见地表）、
 * 宽度方向对齐道路切线（rotation = -heading）。
 */
export interface BarrierSprite {
  x: number
  z: number
  y: number
  rotation: number
  scale: number
  /** BARRIER_RAIL_REGIONS 下标。 */
  variant: number
}

export interface BarrierSettings {
  seed: number
  /** 0..1，门限通过率。 */
  density: number
  /** 同一侧的最小间隔（米）。 */
  spacing?: number
  /** 参考落差（米）。 */
  dropThreshold?: number
  /** 道路半宽（米）。 */
  halfWidth: number
  /** 路肩宽度（米）。 */
  shoulderWidth: number
}

const ALONG_STEP = 2
const DEFAULT_SPACING = 8
const DEFAULT_DROP = 1.2
const PROBE_OUT = 12
const PLACE_INSET = 0.25

function sampleRoadSegment(
  nodes: ReadonlyArray<RoadTraceNode>,
  along: number,
): { x: number; z: number; y: number; heading: number } | null {
  let cumulative = 0
  for (let i = 1; i < nodes.length; i += 1) {
    const previous = nodes[i - 1]!
    const current = nodes[i]!
    const segment = Math.hypot(current.x - previous.x, current.z - previous.z)
    if (segment <= 1e-6) {
      continue
    }
    if (cumulative + segment >= along) {
      const t = (along - cumulative) / segment
      let headingDelta = current.heading - previous.heading
      while (headingDelta > Math.PI) {
        headingDelta -= Math.PI * 2
      }
      while (headingDelta < -Math.PI) {
        headingDelta += Math.PI * 2
      }
      return {
        x: previous.x + (current.x - previous.x) * t,
        z: previous.z + (current.z - previous.z) * t,
        y: previous.y + (current.y - previous.y) * t,
        heading: previous.heading + headingDelta * t,
      }
    }
    cumulative += segment
  }
  return null
}

export function computeBarrierSegments(
  grid: TerrainHeightGrid,
  nodes: ReadonlyArray<RoadTraceNode>,
  settings: BarrierSettings,
): BarrierSprite[] {
  if (nodes.length < 2 || settings.density <= 0) {
    return []
  }
  const seed = settings.seed >>> 0
  const spacing = settings.spacing ?? DEFAULT_SPACING
  const dropThreshold = settings.dropThreshold ?? DEFAULT_DROP
  const probeLateral = settings.halfWidth + settings.shoulderWidth + PROBE_OUT
  const placeLateral = settings.halfWidth + settings.shoulderWidth - PLACE_INSET
  const lastPlaced: Record<number, number> = { 1: -Infinity, '-1': -Infinity }
  const out: BarrierSprite[] = []

  let totalLength = 0
  for (let i = 1; i < nodes.length; i += 1) {
    totalLength += Math.hypot(nodes[i]!.x - nodes[i - 1]!.x, nodes[i]!.z - nodes[i - 1]!.z)
  }

  for (let along = 0; along <= totalLength; along += ALONG_STEP) {
    const sample = sampleRoadSegment(nodes, along)
    if (!sample) {
      continue
    }
    const dirX = Math.cos(sample.heading)
    const dirZ = Math.sin(sample.heading)
    const perpX = -dirZ
    const perpZ = dirX
    for (const side of [1, -1] as const) {
      if (along - lastPlaced[side]! < spacing) {
        continue
      }
      const probeX = sample.x + perpX * side * probeLateral
      const probeZ = sample.z + perpZ * side * probeLateral
      if (!grid.contains(probeX, probeZ)) {
        continue
      }
      const placeX = sample.x + perpX * side * placeLateral
      const placeZ = sample.z + perpZ * side * placeLateral
      if (!grid.contains(placeX, placeZ)) {
        continue
      }
      const placeHeight = grid.sampleHeight(placeX, placeZ)
      const probeHeight = grid.sampleHeight(probeX, probeZ)
      if (placeHeight == null || probeHeight == null) {
        continue
      }
      if (placeHeight - probeHeight < dropThreshold) {
        continue
      }
      const gate = hashUnit(seed, Math.round(along), side > 0 ? 7 : 11)
      if (gate > settings.density) {
        continue
      }
      out.push({
        x: placeX,
        z: placeZ,
        // 可见地表 = 压平的肩沿高度（≈ 道路高度）；-0.02 防 z-fighting。
        y: sample.y - 0.02,
        rotation: -sample.heading,
        scale: 1,
        variant: Math.min(
          BARRIER_RAIL_REGIONS.length - 1,
          Math.floor(hashUnit(seed, Math.round(along), side > 0 ? 13 : 17) * BARRIER_RAIL_REGIONS.length),
        ),
      })
      lastPlaced[side] = along
    }
  }
  return out
}
