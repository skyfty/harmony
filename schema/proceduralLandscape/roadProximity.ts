import type { RoadTraceNode } from './roadTrace'
import { clamp } from './noise'

/**
 * Exact road proximity provider（slowroads-lab `core/roadProfile.ts` 移植）。
 *
 * 编辑器原先把「到公路中心线的 XZ 距离」烘焙成覆盖整个地形 AABB 的距离场
 * 贴图（`roadField.ts`，固定 1024 格封顶）。在数十公里的导入地形上格边长可
 * 达 40m+，远大于路宽与植被净空：落在沥青上的树木候选有一半以上会被光栅场
 * 误判为「离路足够远」，植被因此长到路面上。
 *
 * 这里改为 lab 的做法：查询时对道路折线做精确的点-线段距离计算；线段按
 * bbox 外扩 `maxDistance` 注册进 32m 空间哈希，查询只扫描所在单元。代价与
 * lab 相同，且精度不受地形尺度影响。
 *
 * 本索引只服务**放置过滤**（分块树木 / 远景林 / 相机草 / 走廊草灌木）与
 * per-instance `roadProx`；地表着色器与地形压平仍使用 `roadField.ts` 的光栅
 * 贴图（纯视觉近似，40km 地形无法做到与路面同精度）。
 */
export interface RoadDistanceSource {
  /** 距离上限（米）：超过该距离的查询返回 `range`。 */
  range: number
  /** 到道路中心线的精确 XZ 距离（米，超过 `range` 时返回 `range`）。 */
  distanceAt(x: number, z: number): number
  /** 最近点处的道路高度（节点 y 线性插值）；超出 `range` 或无可达线段时返回 null。 */
  heightAt(x: number, z: number): number | null
}

export interface RoadProximityIndex extends RoadDistanceSource {
  /** 参与索引的线段数（= 可用节点数 - 1）。 */
  segmentCount: number
  /** 空间哈希单元边长（米）。 */
  cellSize: number
  /** 索引内存占用估算（字节）。 */
  memoryBytes: number
}

export interface BuildRoadProximityIndexOptions {
  /** 查询上限（米）：与光栅距离场的 influence 同值，保证过滤语义一致。 */
  maxDistance?: number
  /** 空间哈希单元边长（米），默认与 lab 相同 32m。 */
  cellSize?: number
}

const DEFAULT_MAX_DISTANCE = 72
const DEFAULT_CELL_SIZE = 32
/**
 * 单元坐标偏置/步长：世界坐标可达 ±数十公里（GIS 地形 pack），直接用
 * `(cellX << 20) | cellZ` 的紧凑键会溢出碰撞；用 2^21 步长 + 2^20 偏置可在
 * Number 安全整数内表达 ±100 万米世界（cellX + 偏置 ≤ 2^21）。
 */
const CELL_BIAS = 1 << 20
const CELL_STRIDE = 1 << 21

function cellKey(cellX: number, cellZ: number): number {
  return (cellX + CELL_BIAS) * CELL_STRIDE + (cellZ + CELL_BIAS)
}

/**
 * 构建道路距离索引。节点少于 2 个或没有任何可用线段（全部退化）时返回 null
 *（与光栅场的「无道路」状态一致：调用方不做过滤）。
 */
export function buildRoadProximityIndex(
  nodes: ReadonlyArray<RoadTraceNode>,
  options: BuildRoadProximityIndexOptions = {},
): RoadProximityIndex | null {
  if (!Array.isArray(nodes) || nodes.length < 2) {
    return null
  }
  const maxDistance = Math.max(1, Number.isFinite(options.maxDistance)
    ? (options.maxDistance as number)
    : DEFAULT_MAX_DISTANCE)
  const cellSize = Math.max(1, Number.isFinite(options.cellSize)
    ? (options.cellSize as number)
    : DEFAULT_CELL_SIZE)
  const segmentCount = nodes.length - 1

  const cells = new Map<number, number[]>()
  let cellEntries = 0
  let usableSegments = 0
  for (let i = 0; i < segmentCount; i += 1) {
    const from = nodes[i]!
    const to = nodes[i + 1]!
    if (
      !Number.isFinite(from.x) || !Number.isFinite(from.z) || !Number.isFinite(from.y)
      || !Number.isFinite(to.x) || !Number.isFinite(to.z) || !Number.isFinite(to.y)
    ) {
      continue
    }
    const segX = to.x - from.x
    const segZ = to.z - from.z
    if (segX * segX + segZ * segZ <= 1e-9) {
      continue
    }
    usableSegments += 1
    const cellX0 = Math.floor((Math.min(from.x, to.x) - maxDistance) / cellSize)
    const cellX1 = Math.floor((Math.max(from.x, to.x) + maxDistance) / cellSize)
    const cellZ0 = Math.floor((Math.min(from.z, to.z) - maxDistance) / cellSize)
    const cellZ1 = Math.floor((Math.max(from.z, to.z) + maxDistance) / cellSize)
    for (let cellX = cellX0; cellX <= cellX1; cellX += 1) {
      for (let cellZ = cellZ0; cellZ <= cellZ1; cellZ += 1) {
        const key = cellKey(cellX, cellZ)
        const list = cells.get(key)
        if (list) {
          list.push(i)
        } else {
          cells.set(key, [i])
        }
        cellEntries += 1
      }
    }
  }
  if (!usableSegments) {
    return null
  }

  const closestAt = (x: number, z: number): { distance: number; height: number } | null => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return null
    }
    const list = cells.get(cellKey(Math.floor(x / cellSize), Math.floor(z / cellSize)))
    if (!list || !list.length) {
      return null
    }
    let bestDistanceSq = Number.POSITIVE_INFINITY
    let bestHeight = 0
    for (const index of list) {
      const from = nodes[index]!
      const to = nodes[index + 1]!
      const segX = to.x - from.x
      const segZ = to.z - from.z
      const segLengthSq = segX * segX + segZ * segZ
      if (segLengthSq <= 1e-9) {
        continue
      }
      const t = clamp(((x - from.x) * segX + (z - from.z) * segZ) / segLengthSq, 0, 1)
      const px = from.x + segX * t
      const pz = from.z + segZ * t
      const dx = x - px
      const dz = z - pz
      const distanceSq = dx * dx + dz * dz
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        bestHeight = from.y + (to.y - from.y) * t
      }
    }
    if (!Number.isFinite(bestDistanceSq)) {
      return null
    }
    const distance = Math.sqrt(bestDistanceSq)
    if (distance > maxDistance) {
      return null
    }
    return { distance, height: bestHeight }
  }

  return {
    range: maxDistance,
    segmentCount: usableSegments,
    cellSize,
    // 估算：单元索引项（Number）+ Map/数组开销 + 节点表引用。
    memoryBytes: cellEntries * 8 + cells.size * 40 + segmentCount * 24,
    distanceAt(x: number, z: number): number {
      const closest = closestAt(x, z)
      return closest ? closest.distance : maxDistance
    },
    heightAt(x: number, z: number): number | null {
      return closestAt(x, z)?.height ?? null
    },
  }
}

function bruteForceDistanceSq(
  nodes: ReadonlyArray<RoadTraceNode>,
  x: number,
  z: number,
): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = nodes[i]!
    const to = nodes[i + 1]!
    const segX = to.x - from.x
    const segZ = to.z - from.z
    const segLengthSq = segX * segX + segZ * segZ
    if (segLengthSq <= 1e-9) {
      continue
    }
    const t = clamp(((x - from.x) * segX + (z - from.z) * segZ) / segLengthSq, 0, 1)
    const px = from.x + segX * t
    const pz = from.z + segZ * t
    const dx = x - px
    const dz = z - pz
    const distanceSq = dx * dx + dz * dz
    if (distanceSq < best) {
      best = distanceSq
    }
  }
  return best
}

/**
 * 自检用：把索引查询与暴力点-线段距离在抽样点上逐一比对。
 * 抽样取每段中点及其侧向 7/23/51m（覆盖 `range` 内外的上限语义）。
 */
export function verifyRoadProximityIndex(
  index: RoadDistanceSource,
  nodes: ReadonlyArray<RoadTraceNode>,
): boolean {
  if (!Array.isArray(nodes) || nodes.length < 2) {
    return true
  }
  const samples: Array<{ x: number; z: number }> = []
  const stride = Math.max(1, Math.floor((nodes.length - 1) / 24))
  for (let i = 0; i < nodes.length - 1; i += stride) {
    const from = nodes[i]!
    const to = nodes[i + 1]!
    samples.push({ x: (from.x + to.x) * 0.5, z: (from.z + to.z) * 0.5 })
    const dx = to.x - from.x
    const dz = to.z - from.z
    const length = Math.hypot(dx, dz)
    if (length <= 1e-9) {
      continue
    }
    const nx = -dz / length
    const nz = dx / length
    for (const lateral of [7, 23, 51]) {
      samples.push({ x: from.x + nx * lateral, z: from.z + nz * lateral })
    }
  }
  const tolerance = 1e-6
  for (const sample of samples) {
    const closestSq = bruteForceDistanceSq(nodes, sample.x, sample.z)
    const expected = Number.isFinite(closestSq)
      ? Math.min(Math.sqrt(closestSq), index.range)
      : index.range
    if (Math.abs(index.distanceAt(sample.x, sample.z) - expected) > tolerance) {
      return false
    }
  }
  return true
}
