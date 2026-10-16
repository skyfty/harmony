import type { TerrainHeightGrid } from './terrainSampler'
import { clamp } from './noise'

/**
 * 水位诊断：水下（低于水线）的地形面积占比。
 *
 * 水线语义是「地形最低点 + `water.levelOffset`」：偏移为 0 时水面只与最低点相切，
 * 除最低点外整片水面都被地形遮住（用户实测：看不到任何湖面/水面）。这里按采样
 * 统计淹没比例，供面板提示与自检使用（也用于把水线偏移调到可见水位）。
 */

export interface WaterFloodStats {
  level: number
  /** 低于水线的地形采样占比（0..1）。 */
  floodedFraction: number
  sampledCells: number
  minY: number
  maxY: number
}

export interface WaterFloodStatsOptions {
  /** 每轴最多采样数（默认 256；用于把 O(grid) 统计压到常数级）。 */
  maxSamplesPerAxis?: number
}

export const WATER_FLOOD_VISIBLE_FRACTION = 0.0005

function resolveStride(grid: TerrainHeightGrid, options: WaterFloodStatsOptions | undefined): number {
  const requested = Number.isFinite(options?.maxSamplesPerAxis)
    ? Math.round(options!.maxSamplesPerAxis as number)
    : 256
  const maxAxis = clamp(requested, 8, 4096)
  return Math.max(1, Math.ceil(Math.max(grid.cols, grid.rows) / maxAxis))
}

function collectSampledHeights(
  grid: TerrainHeightGrid,
  options: WaterFloodStatsOptions | undefined,
  visit: (height: number) => void,
): { sampled: number; minY: number; maxY: number } {
  const stride = resolveStride(grid, options)
  let sampled = 0
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let row = 0; row < grid.rows; row += stride) {
    const rowBase = row * grid.cols
    for (let col = 0; col < grid.cols; col += stride) {
      const index = rowBase + col
      if (!grid.coverage[index]) {
        continue
      }
      const height = grid.heights[index]
      if (height == null || !Number.isFinite(height)) {
        continue
      }
      sampled += 1
      if (height < minY) {
        minY = height
      }
      if (height > maxY) {
        maxY = height
      }
      visit(height)
    }
  }
  return { sampled, minY, maxY }
}

export function computeWaterFloodStats(
  grid: TerrainHeightGrid,
  level: number,
  options?: WaterFloodStatsOptions,
): WaterFloodStats {
  let flooded = 0
  const { sampled, minY, maxY } = collectSampledHeights(grid, options, (height) => {
    if (height < level) {
      flooded += 1
    }
  })
  return {
    level,
    floodedFraction: sampled > 0 ? flooded / sampled : 0,
    sampledCells: sampled,
    minY: Number.isFinite(minY) ? minY : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0,
  }
}

/**
 * 反解给定淹没面积占比对应的水位（面积法分位数）；无法解析时返回 null。
 * 供「把水线偏移调到可见水位」的调试/测试路径使用。
 */
export function resolveWaterLevelForFloodFraction(
  grid: TerrainHeightGrid,
  fraction: number,
  options?: WaterFloodStatsOptions,
): number | null {
  const heights: number[] = []
  collectSampledHeights(grid, options, (height) => {
    heights.push(height)
  })
  if (!heights.length) {
    return null
  }
  heights.sort((a, b) => a - b)
  const target = clamp(fraction, 0, 1)
  const index = Math.min(heights.length - 1, Math.max(0, Math.floor(target * heights.length)))
  return heights[index]!
}
