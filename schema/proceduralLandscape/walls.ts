import { hashStringToSeed, hashUnit } from './noise'
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
import type { RoadTraceNode } from './roadTrace'
import type { LandscapeExclusionCircle } from './exclusion'

/**
 * 官方路侧墙体（`WallController` + 各生成器）的平台无关移植，与
 * `tools/slowroads-lab/src/core/walls.ts` 同一套规则（摘录见
 * `tools/slowroads-lab/reference/official/walls.js`）：
 *
 *  - **Barrier / Fence**：`p.y > SEAWALL_ELEV` 且侧向梯度越过门限（宽路 2 / 窄路 4，按
 *    lab 起伏尺度 ÷4），或“下坡 + 转角”软条件；墙心在 `halfWidth + BARRIER_DIST`；
 *    `detail > 1` 时按节点序数交替生成木栏。
 *  - **SeaWall**：`p.y` 低于 `SEAWALL_ELEV(4)`（官方尺度）且海侧梯度越过 ±0.3。
 *  - **Drystone**：官方来源是农田地块边界；这里用官方 field 门限做等价规则
 *    （20m 地块网格 + 海拔 15..220m + 坡度 ≤0.7 + 概率 0.5），紧贴公路的地块边界
 *    打 `∓(roadWidth + DRYSTONE_MARGIN(2))`。
 *
 * 与 lab 的差异仅在取样入口：编辑器地形是导入网格（`TerrainHeightGrid` + 压平后的
 * 可见地表），因此外部通过 `WallTerrainSampling` 注入“原始地形高度 / 压平后高度 /
 * 道路中线采样 / 路缘树影”，其余算法逐项一致。
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

export interface WallTerrainSampling {
  /** 道路中线总里程（米）。 */
  length: number
  /** 半路宽（米）。 */
  halfWidth: number
  /** 水面高度（米）：官方海拔门限的零点。 */
  waterLevel: number
  /** 原始地形高度（官方探针打的是高度场，不是压平后的可见地表）。 */
  terrainHeightAt(x: number, z: number): number
  /** 压平后的可见地表高度（干砌石墙贴地）。 */
  surfaceHeightAt(x: number, z: number): number
  /** 沿里程采样道路中线。 */
  sampleRoad(along: number): { x: number; z: number; y: number; heading: number }
  /** 路缘树影密度（0..1）。 */
  shadowAt(x: number, z: number): number
}

export interface WallSettings {
  seed: number
  /** 整幅路宽（米）。 */
  roadWidth: number
  /** 0..1：地块概率与护栏/海墙生成门限的缩放（1 = 官方原值）。 */
  density: number
  /** 官方 `X.detail`：≥2 时 Barrier / Fence 交替。 */
  detail: number
  /** 划线路型（探针参数来源）。 */
  style: RoadStyleProfile
}

export interface WallSample {
  /** 世界坐标（已含官方 `"wall"` 噪声横向抖动）。 */
  x: number
  z: number
  /** 路面高度（护栏 / 海墙贴地高度）。 */
  roadY: number
  /** 路边地形高度（干砌石墙贴地高度）。 */
  groundY: number
  /** 单位外法线（已按 side 取向）。 */
  nx: number
  nz: number
  /** 道路切线朝向（弧度）。 */
  rotation: number
  /** 沿墙 UV。 */
  u: number
  shadow: number
  /** 官方 `"wall"` 噪声高度抖动（米，±0.1）。 */
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
  lateral: number
  headingDelta: number
  elevation: number
  shadowLeft: number
  shadowRight: number
}

/**
 * 官方 `"wall"` 噪声（`new f0("wall", 31, .2, .1)`）的等价实现。
 *
 * 官方 `f0` 是**相干噪声**，这里在粗节点（10m）上取值、细节点（2m）之间 smoothstep
 * 插值；逐点白噪声会让墙顶与墙身出现锯齿（lab 实测同款结论）。
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

function terrainSlope(
  sampling: WallTerrainSampling,
  x: number,
  z: number,
): number {
  const step = 2
  const dx = (sampling.terrainHeightAt(x + step, z) - sampling.terrainHeightAt(x - step, z)) / (2 * step)
  const dz = (sampling.terrainHeightAt(x, z + step) - sampling.terrainHeightAt(x, z - step)) / (2 * step)
  return Math.hypot(dx, dz)
}

function buildCoarseSamples(
  sampling: WallTerrainSampling,
  nodes: readonly RoadTraceNode[] | null,
  _settings: WallSettings,
): CoarseSample[] {
  const samples: CoarseSample[] = []
  const count = Math.max(2, Math.floor(sampling.length / WALL_NODE_SPACING) + 1)
  const nodeStep = nodes && nodes.length > 1 ? sampling.length / (nodes.length - 1) : WALL_NODE_SPACING
  const feel = WALL_PROBE.feelDistance
  const feelAngle = WALL_PROBE.feelAngleRad
  const scale = feel * WALL_PROBE.maxGrad
  const edge = sampling.halfWidth
  for (let i = 0; i < count; i += 1) {
    const along = Math.min(sampling.length, i * WALL_NODE_SPACING)
    const road = sampling.sampleRoad(along)
    const nx = -Math.sin(road.heading)
    const nz = Math.cos(road.heading)
    const feelLeft = sampling.terrainHeightAt(
      road.x + Math.cos(road.heading - feelAngle) * feel,
      road.z + Math.sin(road.heading - feelAngle) * feel,
    )
    const feelRight = sampling.terrainHeightAt(
      road.x + Math.cos(road.heading + feelAngle) * feel,
      road.z + Math.sin(road.heading + feelAngle) * feel,
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
      x: road.x,
      z: road.z,
      y: road.y,
      heading: road.heading,
      nx,
      nz,
      lateral: (feelLeft - feelRight) / scale,
      headingDelta,
      elevation: normalizeFieldHeight(road.y, sampling.waterLevel),
      shadowLeft: sampling.shadowAt(road.x - nx * edge, road.z - nz * edge),
      shadowRight: sampling.shadowAt(road.x + nx * edge, road.z + nz * edge),
    })
  }
  return samples
}

function computeFieldFlags(
  sampling: WallTerrainSampling,
  settings: WallSettings,
  samples: readonly CoarseSample[],
  drystoneDistance: number,
): { left: boolean[]; right: boolean[] } {
  const seed = (hashStringToSeed('slowroads-field') ^ (settings.seed >>> 0)) >>> 0
  const cell = FIELD_GATES.cellSize
  const isFarmland = (x: number, z: number): boolean => {
    const height = normalizeFieldHeight(sampling.terrainHeightAt(x, z), sampling.waterLevel)
    if (height < FIELD_GATES.minHeight || height > FIELD_GATES.maxHeight) {
      return false
    }
    if (terrainSlope(sampling, x, z) > FIELD_GATES.maxGrade) {
      return false
    }
    return hashUnit(seed, Math.floor(x / cell), Math.floor(z / cell))
      < FIELD_GATES.probabilityThreshold * settings.density
  }
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

/** 官方段长规则（合并 / 最短 / 切分），单位 = 官方节点（10m）。 */
function applySegmentRules(flags: readonly boolean[], minRunNodes = 2): RawRun[] {
  const runs: RawRun[] = []
  let start = -1
  for (let i = 0; i <= flags.length; i += 1) {
    const active: boolean = i < flags.length && flags[i] === true
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
    const span = run.end - run.start
    if (span < minRunNodes) {
      continue
    }
    const chunks = Math.max(1, Math.ceil(span / WALL_SEGMENT_RULES.maxRunNodes))
    const base = Math.floor(span / chunks)
    let extra = span - base * chunks
    let cursor = run.start
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      const steps = base + (extra > 0 ? 1 : 0)
      if (extra > 0) {
        extra -= 1
      }
      out.push({ start: cursor, end: cursor + steps })
      cursor += steps
    }
  }
  return out
}

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
  sampling: WallTerrainSampling,
  nodes: readonly RoadTraceNode[] | null,
  settings: WallSettings,
): WallSegment[] {
  const tuning = resolveWallTuning(settings.roadWidth)
  const samples = buildCoarseSamples(sampling, nodes, settings)
  if (!samples.length) {
    return []
  }
  const jitterSeed = (settings.seed >>> 0) ^ DRYSTONE.jitterSeed
  const density = Math.max(0, Math.min(1, settings.density))
  const densitySeed = (settings.seed >>> 0) ^ 0x5bf03635
  const densityGate = (index: number, side: -1 | 1): boolean =>
    density >= 1 || hashUnit(densitySeed, index, side > 0 ? 17 : 29) < density
  const seaWallGradient = resolveSeaWallGradientThreshold()

  const fieldFlags = computeFieldFlags(sampling, settings, samples, tuning.drystoneDistance)
  const barrier = tuning.barrier
  const barrierLeft: boolean[] = []
  const barrierRight: boolean[] = []
  const seaWallLeft: boolean[] = []
  const seaWallRight: boolean[] = []
  const seaWallLeftStart: boolean[] = []
  const seaWallRightStart: boolean[] = []
  for (const sample of samples) {
    const aboveSea = sample.elevation > SEAWALL.elevation
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
          sampling,
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
    sampling.halfWidth + SEAWALL.distance,
  )
  push(
    'seaWall',
    1,
    applySegmentRules(continueRuns(seaWallRight, seaWallRightStart)),
    sampling.halfWidth + SEAWALL.distance,
  )

  const alternate = settings.detail >= BARRIER_TUNING.fenceAlternateDetail
  const pushBarrierRuns = (runs: RawRun[], side: -1 | 1): void => {
    let previousFence: boolean = false
    let previousEnd = -Infinity
    for (const run of runs) {
      const startSample = samples[run.start]!
      const contiguousFence: boolean = previousFence && previousEnd === run.start
      const isFence: boolean = alternate && (startSample.index % 2 === 0 || contiguousFence)
      previousFence = isFence
      previousEnd = run.end
      push(
        isFence ? 'fence' : 'barrier',
        side,
        [run],
        sampling.halfWidth + barrier.distance,
      )
    }
  }
  pushBarrierRuns(applySegmentRules(barrierLeft, WALL_SEGMENT_RULES.minRunNodes), -1)
  pushBarrierRuns(applySegmentRules(barrierRight, WALL_SEGMENT_RULES.minRunNodes), 1)

  segments.sort((a, b) => (a.startAlong - b.startAlong) || (a.side - b.side))
  return segments
}

function wallSampleInsideExclusion(
  point: WallSample,
  circles: ReadonlyArray<LandscapeExclusionCircle>,
  margin: number,
): boolean {
  for (const circle of circles) {
    const radius = circle.radius + margin
    const dx = point.x - circle.centerX
    const dz = point.z - circle.centerZ
    if (dx * dx + dz * dz <= radius * radius + 1e-9) {
      return true
    }
  }
  return false
}

function lerpWallSample(
  from: WallSample,
  to: WallSample,
  t: number,
): WallSample {
  const mix = (a: number, b: number): number => a + (b - a) * t
  return {
    x: mix(from.x, to.x),
    z: mix(from.z, to.z),
    roadY: mix(from.roadY, to.roadY),
    groundY: mix(from.groundY, to.groundY),
    nx: mix(from.nx, to.nx),
    nz: mix(from.nz, to.nz),
    rotation: mix(from.rotation, to.rotation),
    u: mix(from.u, to.u),
    shadow: mix(from.shadow, to.shadow),
    jitterHeight: mix(from.jitterHeight, to.jitterHeight),
  }
}

function findWallExclusionBoundary(
  outside: WallSample,
  inside: WallSample,
  circles: ReadonlyArray<LandscapeExclusionCircle>,
  margin: number,
): WallSample {
  let outsideT = 0
  let insideT = 1
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const t = (outsideT + insideT) * 0.5
    const sample = lerpWallSample(outside, inside, t)
    if (wallSampleInsideExclusion(sample, circles, margin)) {
      insideT = t
    } else {
      outsideT = t
    }
  }
  return lerpWallSample(outside, inside, outsideT)
}

/**
 * Split generated wall runs at circular keep-out areas. Boundary vertices are
 * projected onto the circle by bisection so fences and wall caps end cleanly
 * outside the protected model instead of stopping at the next 2m sample.
 */
export function clipWallSegmentsToExclusions(
  segments: ReadonlyArray<WallSegment>,
  circles: ReadonlyArray<LandscapeExclusionCircle>,
  margin = 0.5,
): WallSegment[] {
  if (!circles.length) {
    return segments.slice()
  }
  const safeMargin = Math.max(0, margin)
  const output: WallSegment[] = []
  for (const segment of segments) {
    if (segment.points.length < 2) {
      continue
    }
    const span = Math.max(1e-3, segment.endAlong - segment.startAlong)
    const denominator = Math.max(1, segment.points.length - 1)
    let run: WallSample[] = []
    let runStartOrdinal = 0

    const finishRun = (endOrdinal: number): void => {
      if (run.length < 2) {
        run = []
        return
      }
      output.push({
        ...segment,
        startAlong: segment.startAlong + span * (runStartOrdinal / denominator),
        endAlong: segment.startAlong + span * (endOrdinal / denominator),
        points: run,
      })
      run = []
    }

    for (let index = 0; index < segment.points.length; index += 1) {
      const current = segment.points[index]!
      const currentInside = wallSampleInsideExclusion(current, circles, safeMargin)
      const previous = index > 0 ? segment.points[index - 1]! : null
      const previousInside = previous
        ? wallSampleInsideExclusion(previous, circles, safeMargin)
        : false

      if (!currentInside) {
        if (previousInside && previous) {
          runStartOrdinal = index - 1 + 0.999
          run = [findWallExclusionBoundary(current, previous, circles, safeMargin)]
          runStartOrdinal = index - 1
        } else if (!previous) {
          runStartOrdinal = 0
        }
        const last = run[run.length - 1]
        if (!last || Math.hypot(last.x - current.x, last.z - current.z) > 1e-4) {
          run.push(current)
        }
      } else if (!previousInside && previous) {
        const boundary = findWallExclusionBoundary(previous, current, circles, safeMargin)
        const last = run[run.length - 1]
        if (!last || Math.hypot(last.x - boundary.x, last.z - boundary.z) > 1e-4) {
          run.push(boundary)
        }
        finishRun(index - 1 + 0.999)
      }
    }
    if (run.length >= 2) {
      finishRun(segment.points.length - 1)
    }
  }
  return output
}

function samplePoints(
  sampling: WallTerrainSampling,
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
    const road = sampling.sampleRoad(along)
    const nx = -Math.sin(road.heading)
    const nz = Math.cos(road.heading)
    const coarseIndex = Math.min(coarse.length - 1, Math.max(0, Math.round(along / WALL_NODE_SPACING)))
    const coarseSample = coarse[coarseIndex]!
    const fineIndex = Math.round(along / WALL_FINE_STEP)
    const jittered = distance + wallNoise(jitterSeed, fineIndex) * DRYSTONE.jitterDistance
    const x = road.x + nx * side * jittered
    const z = road.z + nz * side * jittered
    points.push({
      x,
      z,
      roadY: road.y,
      groundY: sampling.surfaceHeightAt(x, z),
      nx: nx * side,
      nz: nz * side,
      rotation: -road.heading,
      u: (along / WALL_NODE_SPACING) * uvPerNode,
      shadow: side < 0 ? coarseSample.shadowLeft : coarseSample.shadowRight,
      jitterHeight: wallNoise(jitterSeed ^ 0x9e3779b9, fineIndex) * DRYSTONE.jitterHeight,
    })
  }
  return points
}
