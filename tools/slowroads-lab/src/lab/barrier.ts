import type { Heightfield } from './heightfield'
import { bakeTerrainHeight, type RoadProfile } from './roadProfile'
import { hashUnit } from './noise'
import type { SpriteInstance } from './foliage'
import { BARRIER_RAIL_REGIONS } from './spriteRegions'

/**
 * 下坡侧木护栏（slowroads 山路两侧的横木挡墙）。
 *
 * 规则：沿路每 2m 采样；把肩外 3m 处的地形与肩沿地形比较，
 * 落差超过阈值（默认 1.5m）的一侧才可能放置；同一侧至少间隔 8m，
 * 再按密度门限筛一遍。护栏段贴地、宽度方向对齐道路切线。
 */
export interface BarrierSettings {
  seed: number
  /** 0..1，门限通过率。 */
  density: number
  /** 同一侧的最小间隔（米）。 */
  spacing?: number
  /** 参考落差（米）。 */
  dropThreshold?: number
}

const ALONG_STEP = 2
const DEFAULT_SPACING = 8
const DEFAULT_DROP = 1.2
/**
 * 落差判定用“原始”地形：道路压平带（inner → inner+flattenBand）会把肩外 10m 内的
 * 起伏抹平，若按压平后的高度测落差，几乎永远不达标。这里在肩沿与肩外 12m
 * （已越过压平带）取原始噪声高度比较；实测本实验室的丘陵地形在该跨度上
 * 约每 10% 坡度产生 1.2m 落差，正好筛出真正临崖的路段。护栏本身仍贴合压平
 * 后的可见地表。
 */
const PROBE_OUT = 12
const PLACE_INSET = 0.25

export function computeBarrierSegments(
  field: Heightfield,
  profile: RoadProfile,
  settings: BarrierSettings,
): SpriteInstance[] {
  const seed = settings.seed >>> 0
  const spacing = settings.spacing ?? DEFAULT_SPACING
  const dropThreshold = settings.dropThreshold ?? DEFAULT_DROP
  const probeLateral = profile.halfWidth + profile.shoulderWidth + PROBE_OUT
  const placeLateral = profile.halfWidth + profile.shoulderWidth - PLACE_INSET
  const lastPlaced: Record<number, number> = { 1: -Infinity, '-1': -Infinity }
  const out: SpriteInstance[] = []

  for (let along = 0; along <= profile.length; along += ALONG_STEP) {
    const sample = profile.sampleAt(along)
    const dirX = Math.cos(sample.heading)
    const dirZ = Math.sin(sample.heading)
    const perpX = -dirZ
    const perpZ = dirX
    for (const side of [1, -1]) {
      if (along - lastPlaced[side]! < spacing) {
        continue
      }
      const probeX = sample.x + perpX * side * probeLateral
      const probeZ = sample.z + perpZ * side * probeLateral
      if (!field.inBounds(probeX, probeZ, 4)) {
        continue
      }
      const placeX = sample.x + perpX * side * placeLateral
      const placeZ = sample.z + perpZ * side * placeLateral
      const placeHeight = bakeTerrainHeight(field, profile, placeX, placeZ).height
      if (field.sampleHeight(placeX, placeZ) - field.sampleHeight(probeX, probeZ) < dropThreshold) {
        continue
      }
      const gate = hashUnit(seed, Math.round(along), side > 0 ? 7 : 11)
      if (gate > settings.density) {
        continue
      }
      out.push({
        x: placeX,
        z: placeZ,
        y: placeHeight - 0.02,
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
