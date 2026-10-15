import type { Heightfield } from './heightfield'
import { hashStringToSeed, hashUnit } from './noise'
import { bakeTerrainHeight, type RoadProfile } from './roadProfile'
import {
  BARRIER_TUNING,
  DRYSTONE,
  FIELD_GATES,
  SEAWALL,
  WALL_FINE_SEGMENTS_PER_NODE,
  WALL_NODE_SPACING,
  WALL_SEGMENT_RULES,
  normalizeFieldHeight,
  resolveSeaWallGradientThreshold,
  resolveWallTuning,
  type RoadStyleProfile,
} from './roadStyle'
import type { RoadNode } from './roadTrace'

/**
 * 官方路侧墙体（`WallController` + 各生成器）的 lab 等价实现，平台无关。
 * 官方摘录见 `reference/official/wall-controller.js` 与 `reference/official/walls.js`。
 *
 * 移植的三种“沿路生成”的墙：
 *  - **Barrier**（硬护栏）：`p.y > SEAWALL_ELEV(4)` 且侧向梯度 ≥ 门限（宽路 2 / 窄路 4），
 *    或“下坡 + 转角 ≥ 0.4rad”的软条件；墙心在 `halfWidth + BARRIER_DIST`；
 *    `detail > 1` 时按节点序数把部分段换成 **Fence**（木栏，官方同一生成器）。
 *  - **SeaWall**（混凝土墙）：`p.y <= SEAWALL_ELEV(4)` 或与上一段相接（`p.y <= 3` 起放宽），
 *    且海侧梯度越过 ±0.3；墙心在 `halfWidth + SEAWALL_DIST(0.8)`。
 *  - **Drystone**（干砌石墙）：官方来源是**农田地块边界**；lab 无农田系统，用官方
 *    field 门限做等价规则——20m 地块网格，地块在海拔 15..220m（lab ±40m ×4 折算）、
 *    坡度 ≤0.7、单元概率 0.5 处成立；紧贴公路的地块边界打
 *    `dswl/dswr = ∓(roadWidth + DRYSTONE_MARGIN(2))`，再套官方段长规则。
 *
 * 三者共用官方网格：沿路每 2m（细节点）采样、每 10m（粗节点）做判定。
 *  - 梯度 `g` 用官方 NORMAL 档探针公式（feelDist 10m、feelAng 0.463rad、maxGrad 0.14），
 *    与官方门限同量纲；
 *  - 转角 `da` 取追踪节点的实际转角并折算到 10m；
 *  - 官方节点字段 `h` 在 Hills 恒为 0（见 `reference/official/world-constants.js`），
 *    故 `h < 0.6` / `h < -1` 这类门限按 0 处理（恒真/恒假）。
 */

export type WallType = 'drystone' | 'barrier' | 'fence' | 'seaWall'

/** 官方细节点步长（米）：`nodeSpacing(10) / G7(5)`。 */
export const WALL_FINE_STEP = WALL_NODE_SPACING / WALL_FINE_SEGMENTS_PER_NODE

/** 官方探针公式（`A.gradLat / A.gradLon`）使用的 NORMAL 档参数。 */
export const WALL_PROBE = {
  feelDistance: 10,
  feelAngleRad: 0.463,
  maxGrad: 0.14,
} as const

export interface WallSettings {
  seed: number
  /** 整幅路宽（米）。 */
  roadWidth: number
  /** 0..1：地块概率与护栏/海墙生成门限的缩放（1 = 官方原值）。 */
  density: number
  /** 官方 `X.detail`：≥2 时 Barrier / Fence 交替。 */
  detail: number
  /** 水面高度（米）：官方海拔门限的零点。 */
  waterLevel: number
  /** 划线路型（探针参数来源）。 */
  style: RoadStyleProfile
  /** 路缘树影采样（0..1），用于墙体阴影属性。 */
  shadowAt: (x: number, z: number) => number
}

export interface WallSample {
  /** 世界坐标（已含官方 `"wall"` 噪声的横向抖动）。 */
  x: number
  z: number
  /** 路面高度（护栏 / 海墙贴地高度）。 */
  roadY: number
  /** 路边地形高度（干砌石墙贴地高度）。 */
  groundY: number
  /** 单位外法线（已按 side 取向，指向远离公路的一侧）。 */
  nx: number
  nz: number
  /** 道路切线朝向（弧度），精灵护栏用 `-heading`。 */
  rotation: number
  /** 沿墙 UV（官方每粗节点推进 uvPerNode）。 */
  u: number
  /** 官方节点树影（0..1）。 */
  shadow: number
  /** 官方 `"wall"` 噪声的高度抖动（米，±0.1）。 */
  jitterHeight: number
}

export interface WallSegment {
  type: WallType
  side: -1 | 1
  /** 有符号距离（左负右正）。 */
  distance: number
  startAlong: number
  endAlong: number
  /** 采样点：沿路每 2m 一个，含端点。 */
  points: WallSample[]
}

interface CoarseSample {
  index: number
  along: number
  x: number
  z: number
  y: number
  heading: number
  nx: number
  nz: number
  /** 官方 `g`：侧向梯度（归一化，1.0 = 路型坡度上限）。 */
  lateral: number
  /** 官方 `da`：折算到 10m 节点的实际转角（弧度）。 */
  headingDelta: number
  /** 官方尺度的路面海拔（米）。 */
  elevation: number
  shadowLeft: number
  shadowRight: number
}

function roadsideHeight(
  field: Heightfield,
  profile: RoadProfile,
  x: number,
  z: number,
): number {
  return bakeTerrainHeight(field, profile, x, z).height
}

function terrainSlope(field: Heightfield, x: number, z: number): number {
  const step = 2
  const dx = (field.sampleHeight(x + step, z) - field.sampleHeight(x - step, z)) / (2 * step)
  const dz = (field.sampleHeight(x, z + step) - field.sampleHeight(x, z - step)) / (2 * step)
  return Math.hypot(dx, dz)
}

/**
 * 官方 `"wall"` 噪声（`new f0("wall", 31, .2, .1)`）的 lab 等价实现。
 *
 * 官方 `f0` 是**相干噪声**（同一类生成器也用于树木摆放的 offset/type），因此这里在
 * 粗节点（10m）上取值、细节点（2m）之间做 smoothstep 插值——逐点白噪声会让墙顶和
 * 墙身呈锯齿状（实测观感明显更差）。
 */
function wallNoise(seed: number, index: number): number {
  const span = WALL_FINE_SEGMENTS_PER_NODE
  const coarse = Math.floor(index / span)
  const t = (index - coarse * span) / span
  const a = hashUnit(seed, coarse, 0x51ab) * 2 - 1
  const b = hashUnit(seed, coarse + 1, 0x51ab) * 2 - 1
  const smooth = t * t * (3 - 2 * t)
  return a + (b - a) * smooth
}

function buildCoarseSamples(
  field: Heightfield,
  profile: RoadProfile,
  settings: WallSettings,
  nodes: readonly RoadNode[] | null,
): CoarseSample[] {
  const samples: CoarseSample[] = []
  const count = Math.max(2, Math.floor(profile.length / WALL_NODE_SPACING) + 1)
  const nodeStep = nodes && nodes.length > 1 ? profile.length / (nodes.length - 1) : WALL_NODE_SPACING
  const feel = WALL_PROBE.feelDistance
  const feelAngle = WALL_PROBE.feelAngleRad
  const scale = feel * WALL_PROBE.maxGrad
  const edge = profile.halfWidth
  for (let i = 0; i < count; i += 1) {
    const along = Math.min(profile.length, i * WALL_NODE_SPACING)
    const sample = profile.sampleAt(along)
    const nx = -Math.sin(sample.heading)
    const nz = Math.cos(sample.heading)
    // 官方探针打的是**高度场**（`heightmap.getMidlineXZ`），不是压平后的可见地表；
    // 若用压平后的高度，压平带会把 ±10m 的横向落差抹平（lab barrier.ts 同款结论）。
    const feelLeft = field.sampleHeight(
      sample.x + Math.cos(sample.heading - feelAngle) * feel,
      sample.z + Math.sin(sample.heading - feelAngle) * feel,
    )
    const feelRight = field.sampleHeight(
      sample.x + Math.cos(sample.heading + feelAngle) * feel,
      sample.z + Math.sin(sample.heading + feelAngle) * feel,
    )
    let headingDelta = 0
    if (nodes && nodes.length > 1) {
      const nodeIndex = Math.min(nodes.length - 1, Math.max(0, Math.round(along / nodeStep)))
      if (nodeIndex > 0) {
        headingDelta = nodes[nodeIndex]!.headingDelta * (WALL_NODE_SPACING / nodeStep)
      }
    }
    samples.push({
      index: i,
      along,
      x: sample.x,
      z: sample.z,
      y: sample.y,
      heading: sample.heading,
      nx,
      nz,
      // 官方 `A.gradLat = (feelL - feelR) / feelDist / maxGrad`。
      lateral: (feelLeft - feelRight) / scale,
      headingDelta,
      elevation: normalizeFieldHeight(sample.y, settings.waterLevel),
      shadowLeft: settings.shadowAt(sample.x - nx * edge, sample.z - nz * edge),
      shadowRight: settings.shadowAt(sample.x + nx * edge, sample.z + nz * edge),
    })
  }
  return samples
}

/**
 * 官方农田地块的等价规则：20m 地块网格 + 海拔/坡度门限 + 概率。
 * 返回沿路每个粗节点、每一侧“是否处在农田地块内侧”（即是否该有地块边界墙）。
 */
function computeFieldFlags(
  field: Heightfield,
  settings: WallSettings,
  samples: readonly CoarseSample[],
  drystoneDistance: number,
): { left: boolean[]; right: boolean[] } {
  const seed = (hashStringToSeed('slowroads-field') ^ (settings.seed >>> 0)) >>> 0
  const cell = FIELD_GATES.cellSize
  const isFarmland = (x: number, z: number): boolean => {
    const height = normalizeFieldHeight(field.sampleHeight(x, z), settings.waterLevel)
    if (height < FIELD_GATES.minHeight || height > FIELD_GATES.maxHeight) {
      return false
    }
    if (terrainSlope(field, x, z) > FIELD_GATES.maxGrade) {
      return false
    }
    return hashUnit(seed, Math.floor(x / cell), Math.floor(z / cell))
      < FIELD_GATES.probabilityThreshold * settings.density
  }
  // 官方地块边界墙在“地块内侧”：往外探半格（10m）取样。
  const probeOut = drystoneDistance + cell / 2
  const left: boolean[] = []
  const right: boolean[] = []
  for (const sample of samples) {
    left.push(isFarmland(sample.x - sample.nx * probeOut, sample.z - sample.nz * probeOut))
    right.push(isFarmland(sample.x + sample.nx * probeOut, sample.z + sample.nz * probeOut))
  }
  return { left, right }
}

interface RawRun {
  start: number
  end: number
}

/**
 * 官方段长规则：间隔 < `MIN_WALL_GAP(4 节点)` 的相邻段合并；可选最短长度
 * （`MIN_WALL_LENGTH(3 节点)`，官方只用于 Barrier）；超过 `MAX_WALL_LENGTH(30 节点)`
 * 的连续段切分（官方用 contiguous 段继续）。
 */
function applySegmentRules(flags: readonly boolean[], minRunNodes = 2): RawRun[] {
  const runs: RawRun[] = []
  let start = -1
  for (let i = 0; i <= flags.length; i += 1) {
    const active = i < flags.length && flags[i] === true
    if (active && start < 0) {
      start = i
    } else if (!active && start >= 0) {
      runs.push({ start, end: i - 1 })
      start = -1
    }
  }
  const merged: RawRun[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (last && run.start - last.end < WALL_SEGMENT_RULES.mergeGapNodes) {
      last.end = run.end
    } else {
      merged.push({ ...run })
    }
  }
  const out: RawRun[] = []
  for (const run of merged) {
    // 官方段长按“节点序号差”计（`t.i - e.i`）：N 个跨度 = N+1 个采样点。
    const span = run.end - run.start
    if (span < minRunNodes) {
      continue
    }
    // 官方按 MAX_WALL_LENGTH 切分成连续的 contiguous 段；这里均分成等长块，
    // 避免出现长度 0 的尾块（官方用 contiguous 标记把尾块并回上一段）。
    const chunks = Math.max(1, Math.ceil(span / WALL_SEGMENT_RULES.maxRunNodes))
    const base = Math.floor(span / chunks)
    let extra = span - base * chunks
    let cursor = run.start
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      const nodes = base + (extra > 0 ? 1 : 0)
      if (extra > 0) {
        extra -= 1
      }
      out.push({ start: cursor, end: cursor + nodes })
      cursor += nodes
    }
  }
  return out
}

/** 官方 `PrevSeg` 的“相邻即延长”语义（SeaWall 的 `p.y <= Tr || 邻接`）。 */
function continueRuns(flags: readonly boolean[], startFlags: readonly boolean[]): boolean[] {
  const out: boolean[] = []
  let previous: boolean = false
  for (let i = 0; i < flags.length; i += 1) {
    const active: boolean = flags[i] === true || (previous && startFlags[i] === true)
    out.push(active)
    previous = active
  }
  return out
}

export function computeWallSegments(
  field: Heightfield,
  profile: RoadProfile,
  nodes: readonly RoadNode[] | null,
  settings: WallSettings,
): WallSegment[] {
  const tuning = resolveWallTuning(settings.roadWidth)
  const samples = buildCoarseSamples(field, profile, settings, nodes)
  if (!samples.length) {
    return []
  }
  const jitterSeed = (settings.seed >>> 0) ^ DRYSTONE.jitterSeed
  const density = Math.max(0, Math.min(1, settings.density))
  const seaWallGradient = resolveSeaWallGradientThreshold()
  const densitySeed = (settings.seed >>> 0) ^ 0x5bf03635
  const densityGate = (index: number, side: -1 | 1): boolean =>
    density >= 1 || hashUnit(densitySeed, index, side > 0 ? 17 : 29) < density

  const fieldFlags = computeFieldFlags(field, settings, samples, tuning.drystoneDistance)
  const barrier = tuning.barrier
  const barrierLeft: boolean[] = []
  const barrierRight: boolean[] = []
  const seaWallLeft: boolean[] = []
  const seaWallRight: boolean[] = []
  const seaWallLeftStart: boolean[] = []
  const seaWallRightStart: boolean[] = []
  for (const sample of samples) {
    const aboveSea = sample.elevation > SEAWALL.elevation
    // 官方 `testGenLeft` + `testLeft`（取两者的并集，覆盖“起点软条件 + 延续硬条件”）。
    const left = aboveSea
      && densityGate(sample.index, -1)
      && (sample.lateral < -barrier.gradientThreshold
        || (sample.lateral < 0 && sample.headingDelta > barrier.turnThreshold)
        || sample.lateral < -barrier.gradientMaint
        || (sample.lateral < 0.1 && sample.headingDelta < -barrier.turnMaint))
    const right = aboveSea
      && densityGate(sample.index, 1)
      && (sample.lateral > barrier.gradientThreshold
        || (sample.lateral > 0 && sample.headingDelta < -barrier.turnThreshold)
        || sample.lateral > barrier.gradientMaint
        || (sample.lateral > -0.1 && sample.headingDelta > barrier.turnMaint))
    barrierLeft.push(left)
    barrierRight.push(right)
    // 官方 `Er.testGenLeft` + `Er.testLeft`：`p.y <= 3` 起可生成；`p.y < 4` 才能延续。
    const seaHard = sample.elevation < SEAWALL.elevation
    const seaStart = sample.elevation <= SEAWALL.lowElevation
    seaWallLeftStart.push(seaHard && seaStart && sample.lateral < -seaWallGradient)
    seaWallRightStart.push(seaHard && seaStart && sample.lateral > seaWallGradient)
    seaWallLeft.push(seaHard && sample.lateral < -seaWallGradient)
    seaWallRight.push(seaHard && sample.lateral > seaWallGradient)
  }

  const segments: WallSegment[] = []
  const push = (type: WallType, side: -1 | 1, runs: RawRun[], distance: number): void => {
    for (const run of runs) {
      const startSample = samples[run.start]!
      const endSample = samples[run.end]!
      segments.push({
        type,
        side,
        distance: distance * side,
        startAlong: startSample.along,
        endAlong: endSample.along,
        points: samplePoints(
          field,
          profile,
          startSample.along,
          endSample.along,
          side,
          distance,
          type,
          samples,
          jitterSeed,
        ),
      })
    }
  }

  push('drystone', -1, applySegmentRules(fieldFlags.left), tuning.drystoneDistance)
  push('drystone', 1, applySegmentRules(fieldFlags.right), tuning.drystoneDistance)
  push(
    'seaWall',
    -1,
    applySegmentRules(continueRuns(seaWallLeft, seaWallLeftStart)),
    profile.halfWidth + SEAWALL.distance,
  )
  push(
    'seaWall',
    1,
    applySegmentRules(continueRuns(seaWallRight, seaWallRightStart)),
    profile.halfWidth + SEAWALL.distance,
  )

  // Barrier / Fence：官方同一生成器，`detail > 1` 时按节点序数交替出 Fence。
  const alternate = settings.detail >= BARRIER_TUNING.fenceAlternateDetail
  const pushBarrierRuns = (runs: RawRun[], side: -1 | 1): void => {
    let previousFence: boolean = false
    let previousEnd = -Infinity
    for (const run of runs) {
      const startSample = samples[run.start]!
      // 官方：`e.i % 2 == 0` 或“上一段恰好在 e.i 结束且是 Fence”时用木栏。
      const contiguousFence: boolean = previousFence && previousEnd === run.start
      const isFence: boolean = alternate && (startSample.index % 2 === 0 || contiguousFence)
      previousFence = isFence
      previousEnd = run.end
      push(
        isFence ? 'fence' : 'barrier',
        side,
        [run],
        profile.halfWidth + barrier.distance,
      )
    }
  }
  pushBarrierRuns(
    applySegmentRules(barrierLeft, WALL_SEGMENT_RULES.minRunNodes),
    -1,
  )
  pushBarrierRuns(
    applySegmentRules(barrierRight, WALL_SEGMENT_RULES.minRunNodes),
    1,
  )

  segments.sort((a, b) => (a.startAlong - b.startAlong) || (a.side - b.side))
  return segments
}

function samplePoints(
  field: Heightfield,
  profile: RoadProfile,
  startAlong: number,
  endAlong: number,
  side: -1 | 1,
  distance: number,
  type: WallType,
  coarse: readonly CoarseSample[],
  jitterSeed: number,
): WallSample[] {
  const uvPerNode = type === 'drystone'
    ? DRYSTONE.uvPerNode
    : type === 'seaWall'
      ? SEAWALL.uvPerNode
      : BARRIER_TUNING.uvPerNode
  const points: WallSample[] = []
  const span = Math.max(1e-3, endAlong - startAlong)
  const count = Math.max(2, Math.ceil(span / WALL_FINE_STEP) + 1)
  for (let i = 0; i < count; i += 1) {
    const along = startAlong + (span * i) / (count - 1)
    const sample = profile.sampleAt(along)
    const nx = -Math.sin(sample.heading)
    const nz = Math.cos(sample.heading)
    const coarseIndex = Math.min(coarse.length - 1, Math.max(0, Math.round(along / WALL_NODE_SPACING)))
    const coarseSample = coarse[coarseIndex]!
    const fineIndex = Math.round(along / WALL_FINE_STEP)
    // 官方：`dist = seg.distance + noise.next()`，位置（含抖动）先定，再取路边高度。
    const jittered = distance + wallNoise(jitterSeed, fineIndex) * DRYSTONE.jitterDistance
    const x = sample.x + nx * side * jittered
    const z = sample.z + nz * side * jittered
    points.push({
      x,
      z,
      roadY: sample.y,
      groundY: roadsideHeight(field, profile, x, z),
      nx: nx * side,
      nz: nz * side,
      rotation: -sample.heading,
      u: (along / WALL_NODE_SPACING) * uvPerNode,
      shadow: side < 0 ? coarseSample.shadowLeft : coarseSample.shadowRight,
      jitterHeight: wallNoise(jitterSeed ^ 0x9e3779b9, fineIndex) * DRYSTONE.jitterHeight,
    })
  }
  return points
}
