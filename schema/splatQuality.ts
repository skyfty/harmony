/**
 * 小程序高斯泼溅（.rad）的画质分档与运行时升降档决策。
 *
 * 背景（真机实测，396x800 画布、单文件 833 万 splat、分页 LoD）：
 * - Spark 对 Android 的默认 `lodSplatCount` 是 100 万，实测帧率只有 6.6~15fps；
 * - 收到 18 万档后稳定在 55~61fps（该机型已贴近 60Hz 上限）；
 * - 帧时间与"每帧渲染的 splat 数"近似线性，主线程 JS 只占 3~5ms。
 *
 * 因此这里把画质拆成一条阶梯：强机型从高画质档起步，弱机型从低画质档起步，
 * 运行中再按实测 FPS 带滞回地升降。模块保持纯函数，便于单测。
 */

export type SplatTier = 'high' | 'balanced' | 'safe'

/** 设备信息（字段语义按微信官方文档；拿不到时传 null）。 */
export interface SplatTierInfo {
  platform?: string | null
  /** 设备内存（MB），来自 `wx.getDeviceInfo().memorySize`。 */
  memoryMb?: number | null
  cpuCores?: number | null
  /**
   * `wx.getDeviceBenchmarkInfo().benchmarkLevel`：越大性能越好，
   * `-1` 未知，`-2`/`0` 该设备无法运行小游戏，移动端上限约 50。
   */
  benchmarkLevel?: number | null
  /**
   * `wx.getDeviceBenchmarkInfo().modelLevel`：`0` 未知、`1` 高档机、`2` 中档机、`3` 低档机。
   * 注意语义与 benchmarkLevel 相反——数值越大档位越低。
   */
  modelLevel?: number | null
  maxTextureSize?: number | null
}

export interface SplatLevelTuning {
  level: number
  lodSplatCount: number
  lodRenderScale: number
}

/** 完整的小程序泼溅参数（阶梯档位 + 全档固定项）。 */
export interface SplatTuning {
  lodSplatCount: number
  lodRenderScale: number
  maxPixelRadius: number
  maxStdDev: number
  minSortIntervalMs: number
  maxPagedSplats: number
}

/** 画质阶梯：level 越大画质越低。 */
export const SPLAT_LOD_LADDER: readonly SplatLevelTuning[] = [
  { level: 0, lodSplatCount: 300000, lodRenderScale: 2 },
  { level: 1, lodSplatCount: 240000, lodRenderScale: 2.5 },
  { level: 2, lodSplatCount: 180000, lodRenderScale: 3 },
  { level: 3, lodSplatCount: 150000, lodRenderScale: 3.5 },
  { level: 4, lodSplatCount: 120000, lodRenderScale: 4 },
]

/** 所有档位共用的固定参数（真机实测确认，不参与自动升降档）。 */
export const SPLAT_FIXED_TUNING = {
  maxPixelRadius: 128,
  maxStdDev: 2,
  minSortIntervalMs: 400,
  maxPagedSplats: 1048576,
} as const

/** 各机型档位的起始 level。 */
export const SPLAT_TIER_START_LEVEL: Record<SplatTier, number> = {
  high: 0,
  balanced: 2,
  safe: 4,
}

/** 画质下限：自动降档不会越过这一档。 */
export const SPLAT_LADDER_FLOOR_LEVEL = SPLAT_LOD_LADDER.length - 1

/** 自动升降档阈值与滞回参数。 */
export const SPLAT_AUTOTUNE = {
  /** 低于该帧率累计到连续窗口数就降一档。 */
  lowFpsThreshold: 45,
  /** 低于该帧率累计到连续窗口数时一次降两档（深度掉帧不逐档磨蹭）。 */
  deepFpsThreshold: 35,
  /** 高于该帧率累计到连续窗口数才考虑升档。 */
  highFpsThreshold: 57,
  /**
   * 真机教训：首版用 3 窗口 + 5s 冷却，从起点档逐档降到下限要 20 多秒，
   * 这段时间（fps 35~50）就是用户能明显感觉到的"帧率下降"。改成快降快升：
   * 判定窗口减半、冷却缩短，移动时快速让出画质，停下后快速收回。
   */
  lowWindowsToStepDown: 2,
  highWindowsToStepUp: 3,
  stepDownCooldownMs: 3000,
  stepUpCooldownMs: 5000,
  /** 采样窗口至少要有这么多帧，否则窗口作废（避免把卡顿瞬间当结论）。 */
  minFramesPerWindow: 5,
  /** splat 分页量相对上一窗口的变化超过该比例时，窗口作废（加载期不判定）。 */
  maxPagingDriftRatio: 0.05,
} as const

function toFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return SPLAT_TIER_START_LEVEL.balanced
  return Math.min(SPLAT_LADDER_FLOOR_LEVEL, Math.max(0, Math.trunc(level)))
}

/** 取某个 level 的阶梯参数（越界自动夹到 [0, floor]）。 */
export function resolveSplatLevelTuning(level: number): SplatLevelTuning {
  return SPLAT_LOD_LADDER[clampLevel(level)]
}

/** 取某个 level 的完整泼溅参数。 */
export function resolveSplatTuning(level: number): SplatTuning {
  const rung = resolveSplatLevelTuning(level)
  return {
    lodSplatCount: rung.lodSplatCount,
    lodRenderScale: rung.lodRenderScale,
    maxPixelRadius: SPLAT_FIXED_TUNING.maxPixelRadius,
    maxStdDev: SPLAT_FIXED_TUNING.maxStdDev,
    minSortIntervalMs: SPLAT_FIXED_TUNING.minSortIntervalMs,
    maxPagedSplats: SPLAT_FIXED_TUNING.maxPagedSplats,
  }
}

/**
 * 按设备信息推断机型档位。
 *
 * 规则（按优先级，`safe` 优先于 `high`，信息缺失一律 balanced）：
 * - safe：`modelLevel === 3`，或 `benchmarkLevel` 落在 1~10，或 `memoryMb <= 3072`
 * - high：`modelLevel === 1`，或 `benchmarkLevel >= 25`，或（`memoryMb >= 6144` 且 `benchmarkLevel >= 15`）
 */
export function resolveSplatTier(info: SplatTierInfo | null | undefined): SplatTier {
  if (!info) {
    return 'balanced'
  }
  const memoryMb = toFiniteNumber(info.memoryMb)
  const benchmarkLevel = toFiniteNumber(info.benchmarkLevel)
  const modelLevel = toFiniteNumber(info.modelLevel)

  if (modelLevel === 3) return 'safe'
  if (benchmarkLevel !== null && benchmarkLevel >= 1 && benchmarkLevel <= 10) return 'safe'
  if (memoryMb !== null && memoryMb > 0 && memoryMb <= 3072) return 'safe'

  if (modelLevel === 1) return 'high'
  if (benchmarkLevel !== null && benchmarkLevel >= 25) return 'high'
  if (memoryMb !== null && memoryMb >= 6144 && benchmarkLevel !== null && benchmarkLevel >= 15) return 'high'

  return 'balanced'
}

/**
 * 机型档位 + 场景 deviceAdaptation 档位合成起始 level。
 *
 * 场景档位只允许**更保守**，且只保守一档：`low` 在机型档基础上 +1，
 * 但不会把弱机型抬升（`high`/`balanced` 一律沿用机型档）。
 *
 * 真机教训：早期实现让 `low` 直接落到最低档（level 4），而闭环又只允许在
 * `[floorLevel, startLevel]` 内活动，等于把 `startLevel === floorLevel` 的机器
 * 永久钉死在最低画质档。实测 120K 档与 180K 档帧率几乎一样（52~62 vs 55~61），
 * 画质却是白降，因此改成"只保守一档"，把剩余空间交给帧率闭环。
 */
export function resolveSplatStartLevel(
  info: SplatTierInfo | null | undefined,
  sceneQuality?: 'low' | 'balanced' | 'high' | null,
): number {
  const deviceLevel = SPLAT_TIER_START_LEVEL[resolveSplatTier(info)]
  if (sceneQuality === 'low') {
    return Math.min(deviceLevel + 1, SPLAT_LADDER_FLOOR_LEVEL)
  }
  return deviceLevel
}

export interface SplatLevelState {
  level: number
  startLevel: number
  floorLevel: number
  lowStreak: number
  highStreak: number
}

export interface SplatLevelDecisionInput {
  state: SplatLevelState
  /** 本窗口实测帧率；`null` 表示窗口作废。 */
  fps: number | null
  /** 本窗口渲染帧数。 */
  frames: number
  /** 当前分页入显存的 splat 数。 */
  splatLive: number | null
  /** 上一窗口的 splat 数，用于判断分页是否已稳定。 */
  previousSplatLive: number | null
  /** 距上一次升降档的毫秒数。 */
  sinceLastStepMs: number
}

export interface SplatLevelTransition {
  direction: 'down' | 'up'
  fromLevel: number
  toLevel: number
  /** 本次跨了几档（深度掉帧会一次跨两档）。 */
  steps: number
  reason: string
  fps: number
  lowStreak: number
  highStreak: number
}

export interface SplatLevelDecisionResult {
  state: SplatLevelState
  transition: SplatLevelTransition | null
}

/** 分页是否已稳定（相对变化小于阈值）。首个窗口/无数据视为不稳定。 */
export function isSplatPagingStable(
  previousSplatLive: number | null,
  splatLive: number | null,
): boolean {
  if (previousSplatLive === null || splatLive === null) return false
  if (!Number.isFinite(previousSplatLive) || !Number.isFinite(splatLive)) return false
  if (previousSplatLive <= 0) return false
  return Math.abs(splatLive - previousSplatLive) / previousSplatLive < SPLAT_AUTOTUNE.maxPagingDriftRatio
}

/**
 * 运行时升降档决策（纯函数）。
 *
 * 调用方每个采样窗口调用一次，把返回的 `state` 存回去；`transition` 非空表示本窗口
 * 需要实际改写 Spark 的 `lodSplatCount` / `lodRenderScale`。
 */
export function resolveSplatLevelDecision(input: SplatLevelDecisionInput): SplatLevelDecisionResult {
  const { state } = input
  const floorLevel = clampLevel(state.floorLevel)
  const startLevel = clampLevel(state.startLevel)
  const level = clampLevel(state.level)
  const base = { level, startLevel, floorLevel, lowStreak: 0, highStreak: 0 }

  const fps = toFiniteNumber(input.fps)
  if (fps === null || fps <= 0) {
    return { state: base, transition: null }
  }
  if (!Number.isFinite(input.frames) || input.frames < SPLAT_AUTOTUNE.minFramesPerWindow) {
    return { state: base, transition: null }
  }
  if (!isSplatPagingStable(input.previousSplatLive, input.splatLive)) {
    return { state: base, transition: null }
  }

  if (fps < SPLAT_AUTOTUNE.lowFpsThreshold) {
    const lowStreak = state.lowStreak + 1
    const deep = fps < SPLAT_AUTOTUNE.deepFpsThreshold
    if (
      lowStreak >= SPLAT_AUTOTUNE.lowWindowsToStepDown
      && level < floorLevel
      && input.sinceLastStepMs >= SPLAT_AUTOTUNE.stepDownCooldownMs
    ) {
      const toLevel = Math.min(level + (deep ? 2 : 1), floorLevel)
      return {
        state: { ...base, level: toLevel },
        transition: {
          direction: 'down',
          fromLevel: level,
          toLevel,
          steps: toLevel - level,
          reason: deep
            ? `fps<${SPLAT_AUTOTUNE.deepFpsThreshold}x${SPLAT_AUTOTUNE.lowWindowsToStepDown}`
            : `fps<${SPLAT_AUTOTUNE.lowFpsThreshold}x${SPLAT_AUTOTUNE.lowWindowsToStepDown}`,
          fps,
          lowStreak,
          highStreak: 0,
        },
      }
    }
    return { state: { ...base, lowStreak }, transition: null }
  }

  if (fps > SPLAT_AUTOTUNE.highFpsThreshold) {
    const highStreak = state.highStreak + 1
    if (
      highStreak >= SPLAT_AUTOTUNE.highWindowsToStepUp
      && level > startLevel
      && input.sinceLastStepMs >= SPLAT_AUTOTUNE.stepUpCooldownMs
    ) {
      return {
        state: { ...base, level: level - 1 },
        transition: {
          direction: 'up',
          fromLevel: level,
          toLevel: level - 1,
          steps: 1,
          reason: `fps>${SPLAT_AUTOTUNE.highFpsThreshold}x${SPLAT_AUTOTUNE.highWindowsToStepUp}`,
          fps,
          lowStreak: 0,
          highStreak,
        },
      }
    }
    return { state: { ...base, highStreak }, transition: null }
  }

  return { state: base, transition: null }
}

/** 构造初始升档状态。 */
export function createSplatLevelState(startLevel: number): SplatLevelState {
  const level = clampLevel(startLevel)
  return {
    level,
    startLevel: level,
    floorLevel: SPLAT_LADDER_FLOOR_LEVEL,
    lowStreak: 0,
    highStreak: 0,
  }
}
