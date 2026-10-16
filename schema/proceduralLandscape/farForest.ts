import type { TreePlacement } from './chunkPlan'
import type { LandscapeDensityField } from './densityField'
import type { RoadFieldData } from './roadField'
import type { TerrainHeightGrid } from './terrainSampler'
import { clamp, hashUnit, lerp } from './noise'

/**
 * 远景林多环 LOD 规划器（相机锚定 + 世界锚定候选格）。
 *
 * 近景分块流式（`streamBatches`）只覆盖相机 `tier.viewDistance` 半径（high = 1200m）；
 * 编辑器地形可达数十公里、雾远端按地形放大到 ~10km，超出流式半径的可见地形因此
 * 完全没有植被（用户实测：山上向远方看，1.2km 之外整片裸地形）。这里用一个
 * 「远景环」补齐：以相机为中心、从近景半径到 `outerRadius` 的多层环带，逐环降低
 * 密度、放大 imposter，使远山读起来仍是森林，同时把实例数压进固定预算。
 *
 * 关键性质：
 *  - **世界锚定**：候选点由世界整数格 `(gx, gz) × cellSize` 决定（格内哈希抖动），
 *    判优/抽稀也只依赖格坐标 —— 相机移动重锚时只会改变「哪些格被包含」，
 *    视野内已存在的树不会重排（不会整片闪变）。
 *  - **分帧摊薄**：`createFarForestScan` + `stepFarForestScan(scan, deps, budget)`
 *    按采样预算跨帧推进，避免一次重锚卡帧；扫完再由
 *    `collectFarForestPlacements` 一次性给出预算内的最终实例。
 *  - **近环优先**：预算按环配额分配（环1 45% / 环2 35% / 环3 20%），
 *    近环没用完的配额顺延给更远的环；超配的环按稳定哈希排序截断。
 */

export interface FarForestRingSpec {
  /** 环带内边界在 (innerRadius .. outerRadius) 区间的归一化位置。 */
  startFraction: number
  /** 环带外边界（同上，0..1）。 */
  endFraction: number
  /** 世界锚定候选格边长（米）。 */
  cellSize: number
  /** 环带树密度相对近景分块密度的倍率。 */
  densityScale: number
  /** 环带内由近到远的缩放增益（乘在树木自身 5..12m 高度上）。 */
  scaleGainStart: number
  scaleGainEnd: number
  /** 总预算配额占比（近环优先，未用配额顺延到更远的环）。 */
  budgetShare: number
}

/**
 * 三环 LOD：
 *  - 环1（近景外沿）：格 16m、密度 12%，增益 1.0→1.3 —— 1.2~3km 仍能逐棵辨认；
 *  - 环2：格 32m、密度 4.5%，增益 1.3→1.9 —— 3~5.5km。
 *  - 环3：格 64m、密度 1.8%，增益 1.9→2.6 —— 5.5~8km，最远仍能看到「森林」而非光板。
 */
export const FAR_FOREST_RINGS: readonly FarForestRingSpec[] = [
  {
    startFraction: 0,
    endFraction: 0.26,
    cellSize: 16,
    densityScale: 0.12,
    scaleGainStart: 1,
    scaleGainEnd: 1.3,
    budgetShare: 0.45,
  },
  {
    startFraction: 0.26,
    endFraction: 0.61,
    cellSize: 32,
    densityScale: 0.045,
    scaleGainStart: 1.3,
    scaleGainEnd: 1.9,
    budgetShare: 0.35,
  },
  {
    startFraction: 0.61,
    endFraction: 1,
    cellSize: 64,
    densityScale: 0.018,
    scaleGainStart: 1.9,
    scaleGainEnd: 2.6,
    budgetShare: 0.2,
  },
]

/**
 * 近景分块树的密度基准（棵 / km² / 密度等级）：对齐 `chunkPlan` 的
 * `TREE_BASE_PER_CLASS = 224` 与 192m 分块（36,864 m²）→ 224 × 1e6 / 36864 ≈ 6070。
 * 远景环用「相对近景密度」表达密度，跨质量档保持一致含义。
 */
export const FAR_FOREST_NEAR_DENSITY_PER_CLASS = (1_000_000 / (192 * 192)) * 224

const RANK_SALT = 0x7feb352d
const JITTER_X_SALT = 0x9e3779b9
const JITTER_Z_SALT = 0x85ebca6b
const DENSITY_ACCEPT_SALT = 0xc2b2ae35
const ROTATION_SALT = 0x27d4eb2f
const SCALE_SALT = 0x165667b1
const VARIANT_SALT = 0xd3a2646c
const SPECIES_SALT = 0xfd7046c5

export interface FarForestPlanParams {
  seed: number
  /** 锚点（相机世界坐标 XZ）。 */
  centerX: number
  centerZ: number
  /** 近景分块流式半径（米）：远景环从这里开始。 */
  innerRadius: number
  /** 远景环外半径（米）。 */
  outerRadius: number
  /** 远景实例总预算（棵；0 = 关闭）。 */
  budget: number
  /** 与近景一致的放置过滤参数。 */
  maxSlope: number
  roadClearance: number
  waterLevel: number
  minScale: number
  maxScale: number
  /** 质量档密度倍率（与近景 `takeDensityPrefix` 同源）。 */
  densityMultiplier: number
  rings?: readonly FarForestRingSpec[]
}

export interface FarForestPlanDeps {
  grid: TerrainHeightGrid
  density: LandscapeDensityField
  roadField: RoadFieldData | null
}

export interface FarForestCandidate {
  gx: number
  gz: number
  /** 稳定排序键（同格恒定），用于预算截断。 */
  rank: number
  x: number
  y: number
  z: number
  rotation: number
  scale: number
  variant: number
  species: 0 | 1
}

export interface FarForestScan {
  readonly params: FarForestPlanParams
  readonly rings: readonly FarForestRingSpec[]
  ringIndex: number
  /** 当前环的候选格游标（世界整数格）。 */
  gx: number
  gz: number
  minGx: number
  maxGx: number
  minGz: number
  maxGz: number
  ringInnerRadius: number
  ringOuterRadius: number
  ringInnerSq: number
  ringOuterSq: number
  candidates: FarForestCandidate[][]
  scannedCells: number
  complete: boolean
}

export interface FarForestPlanResult {
  placements: TreePlacement[]
  /** 逐环最终实例数（诊断/统计用）。 */
  ringCounts: number[]
  budget: number
}

function enterRing(scan: FarForestScan, ringIndex: number): void {
  const { params, rings } = scan
  const ring = rings[ringIndex]!
  const span = Math.max(0, params.outerRadius - params.innerRadius)
  scan.ringIndex = ringIndex
  scan.ringInnerRadius = params.innerRadius + span * clamp(ring.startFraction, 0, 1)
  scan.ringOuterRadius = params.innerRadius + span * clamp(ring.endFraction, 0, 1)
  scan.ringInnerSq = scan.ringInnerRadius * scan.ringInnerRadius
  scan.ringOuterSq = scan.ringOuterRadius * scan.ringOuterRadius
  const cell = Math.max(1, ring.cellSize)
  scan.minGx = Math.floor((params.centerX - scan.ringOuterRadius) / cell)
  scan.maxGx = Math.ceil((params.centerX + scan.ringOuterRadius) / cell)
  scan.minGz = Math.floor((params.centerZ - scan.ringOuterRadius) / cell)
  scan.maxGz = Math.ceil((params.centerZ + scan.ringOuterRadius) / cell)
  scan.gx = scan.minGx
  scan.gz = scan.minGz
}

/**
 * 坡度（`1 - normal.y`，与 `TerrainHeightGrid.sampleNormal` 同一公式）。
 * 这里就地用高度差分算，避免扫描期每格一次 `Vector3` 分配（每帧可达 2.5 万次）。
 */
function sampleSlope(grid: TerrainHeightGrid, x: number, z: number): number | null {
  const h = grid.cellSize
  const hx0 = grid.sampleHeight(x - h, z)
  const hx1 = grid.sampleHeight(x + h, z)
  const hz0 = grid.sampleHeight(x, z - h)
  const hz1 = grid.sampleHeight(x, z + h)
  if (hx0 == null || hx1 == null || hz0 == null || hz1 == null) {
    return null
  }
  const dx = (hx1 - hx0) / (2 * h)
  const dz = (hz1 - hz0) / (2 * h)
  return 1 - 1 / Math.sqrt(dx * dx + dz * dz + 1)
}

export function createFarForestScan(params: FarForestPlanParams): FarForestScan {
  const rings = params.rings?.length ? params.rings : FAR_FOREST_RINGS
  const scan: FarForestScan = {
    params,
    rings,
    ringIndex: 0,
    gx: 0,
    gz: 0,
    minGx: 0,
    maxGx: -1,
    minGz: 0,
    maxGz: -1,
    ringInnerRadius: params.innerRadius,
    ringOuterRadius: params.innerRadius,
    ringInnerSq: params.innerRadius * params.innerRadius,
    ringOuterSq: params.innerRadius * params.innerRadius,
    candidates: rings.map(() => []),
    scannedCells: 0,
    complete: false,
  }
  if (params.budget <= 0 || !(params.outerRadius > params.innerRadius)) {
    scan.complete = true
    return scan
  }
  enterRing(scan, 0)
  return scan
}

function evaluateFarForestCell(
  scan: FarForestScan,
  deps: FarForestPlanDeps,
  gx: number,
  gz: number,
): FarForestCandidate | null {
  const { params } = scan
  const ring = scan.rings[scan.ringIndex]!
  const seed = params.seed >>> 0
  const cell = Math.max(1, ring.cellSize)
  const x = (gx + hashUnit(seed ^ JITTER_X_SALT, gx, gz)) * cell
  const z = (gz + hashUnit(seed ^ JITTER_Z_SALT, gx, gz)) * cell
  const dx = x - params.centerX
  const dz = z - params.centerZ
  const distanceSq = dx * dx + dz * dz
  if (distanceSq < scan.ringInnerSq || distanceSq > scan.ringOuterSq) {
    return null
  }
  const { grid, density, roadField } = deps
  if (!grid.contains(x, z)) {
    return null
  }
  const y = grid.sampleHeight(x, z)
  if (y == null || y < params.waterLevel + 2) {
    return null
  }
  const slope = sampleSlope(grid, x, z)
  if (slope == null || slope > params.maxSlope) {
    return null
  }
  if (roadField && roadField.distanceAt(x, z) < params.roadClearance) {
    return null
  }
  // 密度：把「近景密度倍率」换算成当前格网下的接受概率，格网本身封顶密度。
  // 注意 `sampleUnit` 返回 0..1 的归一化值（= 等级/3），而近景密度基准
  // （`FAR_FOREST_NEAR_DENSITY_PER_CLASS`）是按**等级 0..3** 定义的，这里必须
  // 还原成等级再换算，否则远景密度只有预期的一半左右。
  const latticeDensity = 1_000_000 / (cell * cell)
  const classValue = density.sampleUnit(x, z) * 3
  const acceptance = clamp(
    (ring.densityScale * params.densityMultiplier * FAR_FOREST_NEAR_DENSITY_PER_CLASS * classValue) / latticeDensity,
    0,
    1,
  )
  if (acceptance <= 0 || hashUnit(seed ^ DENSITY_ACCEPT_SALT, gx, gz) >= acceptance) {
    return null
  }
  const distance = Math.sqrt(distanceSq)
  const bandSpan = Math.max(1, scan.ringOuterRadius - scan.ringInnerRadius)
  const gain = lerp(
    ring.scaleGainStart,
    ring.scaleGainEnd,
    clamp((distance - scan.ringInnerRadius) / bandSpan, 0, 1),
  )
  return {
    gx,
    gz,
    rank: hashUnit(seed ^ RANK_SALT, gx, gz),
    x,
    y,
    z,
    rotation: hashUnit(seed ^ ROTATION_SALT, gx, gz) * Math.PI * 2,
    scale: lerp(params.minScale, params.maxScale, hashUnit(seed ^ SCALE_SALT, gx, gz)) * gain,
    variant: hashUnit(seed ^ VARIANT_SALT, gx, gz),
    species: hashUnit(seed ^ SPECIES_SALT, gx, gz) < 0.4 ? 1 : 0,
  }
}

/**
 * 推进扫描。`sampleBudget` 为本轮最多处理的候选格数量（分帧摊薄），
 * 返回 true 表示扫描完成。
 */
export function stepFarForestScan(
  scan: FarForestScan,
  deps: FarForestPlanDeps,
  sampleBudget = 25_000,
): boolean {
  if (scan.complete) {
    return true
  }
  let remaining = Math.max(1, Math.floor(sampleBudget))
  for (;;) {
    if (scan.ringIndex >= scan.rings.length) {
      scan.complete = true
      return true
    }
    if (scan.gx > scan.maxGx) {
      const nextRing = scan.ringIndex + 1
      if (nextRing >= scan.rings.length) {
        scan.complete = true
        return true
      }
      enterRing(scan, nextRing)
      continue
    }
    const candidate = evaluateFarForestCell(scan, deps, scan.gx, scan.gz)
    if (candidate) {
      scan.candidates[scan.ringIndex]!.push(candidate)
    }
    scan.scannedCells += 1
    scan.gz += 1
    if (scan.gz > scan.maxGz) {
      scan.gz = scan.minGz
      scan.gx += 1
    }
    remaining -= 1
    if (remaining <= 0) {
      return false
    }
  }
}

/**
 * 扫描完成后按预算产出实例：近环优先分配配额，未用完的配额顺延到更远的环；
 * 超配的环按 `rank`（每格稳定哈希）排序截断，保证结果确定且分布均匀。
 */
export function collectFarForestPlacements(scan: FarForestScan): FarForestPlanResult {
  const placements: TreePlacement[] = []
  const ringCounts: number[] = []
  const budget = Math.max(0, Math.floor(scan.params.budget))
  let carry = 0
  for (let index = 0; index < scan.rings.length; index += 1) {
    const ring = scan.rings[index]!
    const list = scan.candidates[index] ?? []
    const quota = budget > 0 ? ring.budgetShare * budget + carry : 0
    let kept = list
    if (list.length > quota) {
      const limit = Math.max(0, Math.floor(quota))
      kept = [...list].sort((a, b) => a.rank - b.rank).slice(0, limit)
      carry = 0
    } else {
      carry = Math.max(0, quota - list.length)
    }
    for (const candidate of kept) {
      placements.push({
        x: candidate.x,
        z: candidate.z,
        y: candidate.y,
        rotation: candidate.rotation,
        scale: candidate.scale,
        variant: candidate.variant,
        species: candidate.species,
        rank: placements.length,
      })
    }
    ringCounts.push(kept.length)
  }
  return { placements, ringCounts, budget }
}

/** 同步跑完一个远景环（测试/离线工具用；运行时走分帧的 step 版本）。 */
export function planFarForestRings(
  params: FarForestPlanParams,
  deps: FarForestPlanDeps,
  sampleBudget = 1_000_000,
): FarForestPlanResult {
  const scan = createFarForestScan(params)
  while (!scan.complete) {
    stepFarForestScan(scan, deps, sampleBudget)
  }
  return collectFarForestPlacements(scan)
}
