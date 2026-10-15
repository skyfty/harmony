/**
 * slowroads 官方路型表与墙体常量（平台无关）。
 *
 * 来源：官方线上包体解包产物（`%TEMP%/sr`，摘录见 `reference/official/world-constants.js`）
 *  - `roadStyle[]`（`chunks__DevMidlineGenerator.7013ef99.js` @386581-390000）：
 *    四种路型各自的 road.width（整幅路宽，米）与划线判定阈值；
 *  - 常量区（同文件 @535700-543000）：路宽表、DRYSTONE_*、BARRIER_*、SEAWALL_*、
 *    墙体段长规则与农田（field）门限。
 *
 * 关键语义（与官方逐项对齐）：
 *  - `ROAD_WIDTH_TABLE = [AUTO 3.2, NARROW 1.8, REGULAR 3.2, WIDE 4]`；
 *    `ROAD_IS_SINGLE_TRACK = roadWidth < 2.25`，即窄路用 `roadSingle` 贴图带，
 *    否则用宽路（`road_base` + 划线）材质；
 *  - 墙体判定用的梯度是官方 `g`（= `(feelL-feelR)/feelDist/maxGrad`，1.0 = 该路型坡度上限），
 *    转角是官方 `da`（弧度，1 个官方节点 = 10m）；
 *  - 段长规则以**官方节点**为单位（1 节点 = 10m）：单个墙段最长 30 节点、最短 3 节点，
 *    同侧两段间隔小于 4 节点时合并；`maxWallLength` 随 graphics preset 变化
 *    （low/medium/high/ultra = 20/25/30/30），lab 取 medium 档（与 README 的性能口径一致）。
 */

export type RoadStyleId = 'straight' | 'casual' | 'normal' | 'winding'

export interface RoadStyleProfile {
  id: RoadStyleId
  label: string
  /** 官方 `road.width`：整幅路宽（米）。 */
  width: number
  /** 官方 `midline.feelDist`（米）：梯度探针距离。 */
  feelDist: number
  /** 官方 `midline.maxGrad`：梯度归一化基准（1.0 = 坡度上限）。 */
  maxGrad: number
  /** 官方 `midline.solidLineThreshold`：实线起判门限。 */
  solidLineThreshold: number
  /** 官方 `midline.solidLineCrestThreshold`：山脊（纵向梯度符号翻转）项门限。 */
  solidLineCrestThreshold: number
  /** 官方 `midline.markingsMargin`：划线判定窗口（官方节点数）。 */
  markingsMargin: number
}

/** 官方 `roadStyle[]` 四个档位（索引 = hash 里的 roadStyle 数字）。 */
export const ROAD_STYLE_PROFILES: Record<RoadStyleId, RoadStyleProfile> = {
  straight: {
    id: 'straight',
    label: 'STRAIGHT',
    width: 1.8,
    feelDist: 10,
    maxGrad: 0.2,
    solidLineThreshold: 0.1,
    solidLineCrestThreshold: -0.02,
    markingsMargin: 12,
  },
  casual: {
    id: 'casual',
    label: 'CASUAL',
    width: 4,
    feelDist: 30,
    maxGrad: 0.16,
    solidLineThreshold: 0.08,
    solidLineCrestThreshold: -0.3,
    markingsMargin: 8,
  },
  normal: {
    id: 'normal',
    label: 'NORMAL',
    width: 3.2,
    feelDist: 10,
    maxGrad: 0.14,
    solidLineThreshold: 0.08,
    solidLineCrestThreshold: -0.5,
    markingsMargin: 6,
  },
  winding: {
    id: 'winding',
    label: 'WINDING',
    width: 1.8,
    feelDist: 10,
    maxGrad: 0.12,
    solidLineThreshold: 0.18,
    solidLineCrestThreshold: -0.5,
    markingsMargin: 5,
  },
}

/** lab 默认对齐参考链接 `#A2-…`（NORMAL 档）。 */
export const DEFAULT_ROAD_STYLE: RoadStyleId = 'normal'

/** 官方路宽枚举 `_i = [AUTO 3.2, NARROW 1.8, REGULAR 3.2, WIDE 4]`。 */
export const ROAD_WIDTH_PRESETS = {
  narrow: 1.8,
  regular: 3.2,
  wide: 4,
} as const

export type RoadWidthPresetId = keyof typeof ROAD_WIDTH_PRESETS | 'custom'

/** 官方 `ms = it < 2.25`：低于该路宽用 `roadSingle`（单车道）贴图带。 */
export const ROAD_SINGLE_TRACK_THRESHOLD = 2.25

export function isSingleTrackRoad(roadWidth: number): boolean {
  return roadWidth < ROAD_SINGLE_TRACK_THRESHOLD
}

/** 官方 `midline.nodeSpacing`（米）：一个粗节点 = 10m，细节点 = 2m（每节点 5 个）。 */
export const WALL_NODE_SPACING = 10
/** 官方每粗节点的细节点数（`G7 = 5`）。 */
export const WALL_FINE_SEGMENTS_PER_NODE = 5

/** 官方墙体段长规则（`MAX_WALL_LENGTH` / `MIN_WALL_LENGTH` / `MIN_WALL_GAP`），单位 = 官方节点。 */
export const WALL_SEGMENT_RULES = {
  /** `M1 = maxWallLength`（medium 档 30 节点 = 300m）。 */
  maxRunNodes: 30,
  /** `Wi = minWallLength`（3 节点 = 30m）。 */
  minRunNodes: 3,
  /** `$3 = minWallGap`（4 节点 = 40m，小于该间隔的两段合并）。 */
  mergeGapNodes: 4,
  /** `Y3 = maxWallLength / 2 - minWallGap`（11 节点，向后回溯上限）。 */
  backExtendNodes: 11,
} as const

/** 官方 DRYSTONE_*（干砌石墙）。 */
export const DRYSTONE = {
  /** `DRYSTONE_MARGIN`：墙心离路缘的额外距离，`DIST = roadWidth + MARGIN`。 */
  margin: 2,
  /** `DRYSTONE_GRADIENT_THRESHOLD`（官方常量，随路宽调整；用于地块等价规则）。 */
  gradientThreshold: 2,
  /** `DRYSTONE_HEIGHT`：墙高（米）。 */
  height: 1.1,
  /** `DRYSTONE_SINK`：整段墙下沉量（米）。 */
  sink: 0.2,
  /** `DRYSTONE_WIDTH` = `WIDTH_TOP * 2`：墙顶宽（米）。 */
  width: 0.32,
  /** `DRYSTONE_WIDTH_TOP`：顶面到内侧的距离（米）。 */
  widthTop: 0.16,
  /** `DRYSTONE_WIDTH_BOTTOM`：墙脚总加宽（米，两侧各一半）。 */
  widthBottom: 0.38,
  /** `DRYSTONE_UV_SCALE`：贴图沿路重复尺度。 */
  uvScale: 5,
  /** `DRYSTONE_UV_HEIGHT`：贴图纵向占比。 */
  uvHeight: 0.475,
  /** `DRYSTONE_UV_WIDTH` = `(1 - UV_HEIGHT) * 2`。 */
  uvWidth: 1.05,
  /** 官方墙体噪声 `new f0("wall", 31, .2, .1)`：位置抖动 ±0.2m / 高度抖动 ±0.1m。 */
  jitterSeed: 31,
  jitterDistance: 0.2,
  jitterHeight: 0.1,
  /** 官方 `P7 = 1.5`：墙体阴影色乘数（`sqrt(shadow) * 1.5`）。 */
  shadowScale: 1.5,
  /** 官方 `Ur = 2`：每个粗节点沿路推进的 UV 距离。 */
  uvPerNode: 2,
} as const

/** 官方 BARRIER_*（硬护栏；宽路档 / 窄路档）。 */
export interface BarrierTuning {
  /** 侧向梯度门限（≥ 该值即“悬崖侧”）。 */
  gradientThreshold: number
  /** 延续判定用的坡度门限（比生成门限宽）。 */
  gradientMaint: number
  /** 转角门限（弧度 / 10m 节点）。 */
  turnThreshold: number
  /** 转角延续门限。 */
  turnMaint: number
  /** 护栏面板离路缘的距离（米）。 */
  distance: number
}

export const BARRIER_TUNING = {
  wide: {
    gradientThreshold: 2,
    gradientMaint: 1.5,
    turnThreshold: 0.4,
    turnMaint: 0.2,
    distance: 0.4,
  },
  narrow: {
    gradientThreshold: 4,
    gradientMaint: 2.5,
    turnThreshold: 1,
    turnMaint: 0.5,
    distance: 0.8,
  },
  /** 官方 `q1 = 0.78`：护栏总高（米）。 */
  height: 0.78,
  /** 官方 `Ye / M5 / Rt`：横档（贴图行）相对高度比例。 */
  railHeights: [0.55, 0.68, 0.88] as const,
  /** 官方护栏面板厚度（`x1 = x + n * 0.1 * side`）。 */
  thickness: 0.1,
  /** 官方 `k7 = 1.5`：护栏阴影色乘数（与石墙不同，不取平方根）。 */
  shadowScale: 1.5,
  /** 官方 `uvDist += 6 / actualSegs`：每粗节点 6 个 UV 单位。 */
  uvPerNode: 6,
  /** 官方 `R7 = 3`：护栏/海墙的最低路面海拔（米）。 */
  minElevation: 3,
  /** 官方 `testLeft/Right` 里的 `t.h < .6`（节点高差门限；官方该字段在 Hills 恒为 0）。 */
  maxCut: 0.6,
  /** 官方 detail > 1 时按节点序数交替生成 Fence（`e.i % 2 == 0`）。 */
  fenceAlternateDetail: 2,
} as const

/** 官方 SEAWALL_*（混凝土海墙）。 */
export const SEAWALL = {
  /** `SEAWALL_ELEV`：路面海拔低于该值才可能生成（米，相对海平面）。 */
  elevation: 4,
  /** `SEAWALL_DIST`：墙心离路缘距离（米）。 */
  distance: 0.8,
  /** 官方 `F7` 墙体截面：`h4 = 0.25`（墙厚）、`d2 = 0.15`（墙脚外扩）、`S2 = 1`（墙高）、`Dr = 0.2`（下沉）。 */
  width: 0.25,
  footWidth: 0.15,
  height: 1,
  sink: 0.2,
  /** 官方 `Rr = 2.5`：每粗节点 UV 推进量。 */
  uvPerNode: 2.5,
  /** 官方 `Tr = 3`：生成延续判定用的“低海拔”阈值。 */
  lowElevation: 3,
  /** 官方 `_7 = 0.3` / `j7 = 1`：海侧梯度与高差门限。 */
  gradientThreshold: 0.3,
  cutThreshold: 1,
} as const

/** 官方农田（field）门限：lab 用它做干砌石墙的“地块”等价规则。 */
export const FIELD_GATES = {
  /** `CELL_SIZE = 20`（米）：地块网格。 */
  cellSize: 20,
  /** `FIELD_MIN_HEIGHT` / `FIELD_MAX_HEIGHT`（米，官方海拔尺度）。 */
  minHeight: 15,
  maxHeight: 220,
  /** `FIELD_PROBABILITY_THRESHOLD`：地块出现概率门限。 */
  probabilityThreshold: 0.5,
  /** `FIELD_MAX_GRADE`：地块最大坡度。 */
  maxGrade: 0.7,
  /** `FIELD_MAP_SCALE`：地块噪声尺度（米）。 */
  mapScale: 1000,
  /** 官方 lab→官方海拔换算（lab 起伏 ±40m，地表着色按 ×4 折算到 0..300m）。 */
  labHeightScale: 4,
} as const

export function normalizeFieldHeight(labHeight: number, waterLevel: number): number {
  return Math.max(0, labHeight - waterLevel) * FIELD_GATES.labHeightScale
}

/** 宽路档 / 窄路档二选一的墙体参数（官方 `Rp()` 里按 `ms` 切换）。 */
export interface WallTuning {
  singleTrack: boolean
  barrier: BarrierTuning
  /** 干砌石墙墙心到中线的距离（米）：`roadWidth + DRYSTONE_MARGIN`。 */
  drystoneDistance: number
  /** 混凝土海墙墙心到路缘的距离（米）。 */
  seaWallDistance: number
}

export function resolveWallTuning(roadWidth: number): WallTuning {
  const singleTrack = isSingleTrackRoad(roadWidth)
  // lab 的地形起伏按官方 1/4 高度尺度设计（同地表高度带 ×4 的换算口径），
  // 因此官方“横坡门限”在 lab 侧按同一比例折算，才能得到与官方同样的分布；
  // 官方原值见 BARRIER_TUNING / SEAWALL（reference/official/world-constants.js）。
  return {
    singleTrack,
    barrier: scaleBarrierForLab(singleTrack ? BARRIER_TUNING.narrow : BARRIER_TUNING.wide),
    drystoneDistance: roadWidth + DRYSTONE.margin,
    seaWallDistance: SEAWALL.distance,
  }
}

/** lab 起伏尺度因子：官方 0..300m ↔ lab ±40m（地表高度带同款 ×4 口径）。 */
export const LAB_RELIEF_SCALE = FIELD_GATES.labHeightScale

function scaleBarrierForLab(tuning: BarrierTuning): BarrierTuning {
  return {
    ...tuning,
    gradientThreshold: tuning.gradientThreshold / LAB_RELIEF_SCALE,
    gradientMaint: tuning.gradientMaint / LAB_RELIEF_SCALE,
  }
}

/** lab 侧的混凝土海墙横坡门限（官方 0.3 ÷ 起伏尺度）。 */
export function resolveSeaWallGradientThreshold(): number {
  return SEAWALL.gradientThreshold / LAB_RELIEF_SCALE
}
