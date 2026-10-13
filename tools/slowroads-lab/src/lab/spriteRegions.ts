import type * as THREE from 'three'

/**
 * 精灵图集的区域表。
 *
 * 网格类图集（草地 2×2、灌木 4×2、imposters 16×4）由 `gridRegions` 按行列生成，
 * 并带 1.5 texel 内缩防止 mipmap 渗色；打包类图集（slowroads 的树卡/花草/高草/
 * 护栏）不是规则网格，区域由一次性 PIL 脚本按 alpha 连通域实测后写死在下面：
 *
 *   掩膜 = alpha 通道（针叶树卡用 `spring_trees_1_a` 的亮度）；
 *   连通域在 3× 降采样上用 BOX 阈值 + 4 邻域 BFS 求出；
 *   矩形按内容 bbox 外扩 3px、裁剪到图内、底边对齐（树/草/灌木都在画稿里落地）；
 *   `heightScale` 以该图集内最高区域为 1.0，用来还原树丛与灌木的真实体量差。
 *
 * 注意：下面写死的区域是 **着色器 UV 空间**（原点在左下）。素材是图片空间
 * （原点在左上，TextureLoader 默认 flipY），换算规则 `v = 1 - y / height`；
 * 例如 spring_trees_0 顶部 384px 的树区 = 图片 v 0…0.75 = 着色器 v 0.25…1。
 */
export interface SpriteRegion {
  u0: number
  v0: number
  u1: number
  v1: number
  /** 画幅宽高比（宽 / 高）。 */
  aspect: number
  /** 相对高度：1.0 = 图集内最高的区域。 */
  heightScale: number
}

export interface SpriteAtlasSpec {
  texture: THREE.Texture
  /** diffuse 自身 alpha 不可用（如 spring_trees_1_m）时提供单独的遮罩图，按 R 通道取样。 */
  alphaTexture?: THREE.Texture | null
  normalTexture?: THREE.Texture | null
  regions: SpriteRegion[]
  /** 生成方式备注，便于排查。 */
  note?: string
}

export function gridRegions(
  columns: number,
  rows: number,
  textureWidth: number,
  textureHeight: number,
  insetPx = 1.5,
): SpriteRegion[] {
  const regions: SpriteRegion[] = []
  const cellW = 1 / columns
  const cellH = 1 / rows
  const insetU = insetPx / textureWidth
  const insetV = insetPx / textureHeight
  const aspect = (cellW * textureWidth) / (cellH * textureHeight)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      regions.push({
        u0: column * cellW + insetU,
        v0: 1 - (row + 1) * cellH + insetV,
        u1: (column + 1) * cellW - insetU,
        v1: 1 - row * cellH - insetV,
        aspect,
        heightScale: 1,
      })
    }
  }
  return regions
}

/** spring_trees_0：4 列“树丛卡”，底部 128px（v 0.75→1）是树皮条带，不参与渲染。 */
export const NEAR_BROADLEAF_REGIONS: SpriteRegion[] = [
  { u0: 0.00000, v0: 0.25000, u1: 0.25000, v1: 1.00000, aspect: 1.3333, heightScale: 1.000 },
  { u0: 0.25000, v0: 0.25000, u1: 0.50000, v1: 1.00000, aspect: 1.3333, heightScale: 1.000 },
  { u0: 0.50000, v0: 0.25000, u1: 0.75000, v1: 1.00000, aspect: 1.3333, heightScale: 1.000 },
  { u0: 0.75000, v0: 0.25000, u1: 1.00000, v1: 1.00000, aspect: 1.3333, heightScale: 1.000 },
]

/**
 * spring_trees_1_m + _a：整张图集包含树皮条带、俯视树冠贴片、倒挂枝卡与枝叶碎片，
 * 其中只有 2 处是完整侧视树（树干落地、针叶向上）：
 *  - 第 1 棵：细干幼杉，实测内容 x 957…1186、主干贴到画面底边；区域左边界收到
 *    x990，因为 x955…1009 混有邻卡（倒挂枝）的针叶尖，矩形框无法两全，只能略裁
 *    掉它最外侧一根左枝的枝尖；
 *  - 第 2 棵：浅色羽叶幼树，x 1225…1555，树干落在底边上方 4px。
 * 此前误把“倒挂云杉枝卡”（树干在上、针叶垂在下方，立在地面上像倒立的树）与
 * “俯视树冠贴片”（从上往下的圆盘）当作侧视树使用，已剔除。
 */
export const NEAR_CONIFER_REGIONS: SpriteRegion[] = [
  { u0: 0.48340, v0: 0.00000, u1: 0.58057, v1: 0.92578, aspect: 0.4198, heightScale: 0.967 },
  { u0: 0.59814, v0: 0.00195, u1: 0.75928, v1: 0.95898, aspect: 0.6735, heightScale: 1.000 },
]

/**
 * spring_bushes：4 丛贴地花草（黄花丛、白花苗、匍匐幼苗、卷芽）。
 * 图集右下角另有两根深色云杉枝卡（其中一根从上缘倒挂下来），属于树冠装饰素材而非
 * 地被植物；此前被并成一个大框当作“大型蕨”放在路边，立在地上像倒挂的枝子，已剔除。
 * heightScale 沿用原基准（旧大框 = 1.0），4 丛花草的世界高度与原表现一致。
 */
export const FLOWER_REGIONS: SpriteRegion[] = [
  { u0: 0.01270, v0: 0.01953, u1: 0.10059, v1: 0.37891, aspect: 0.9783, heightScale: 0.375 },
  { u0: 0.14746, v0: 0.68359, u1: 0.22168, v1: 0.88672, aspect: 1.4615, heightScale: 0.223 },
  { u0: 0.26270, v0: 0.05859, u1: 0.34277, v1: 0.39453, aspect: 0.9535, heightScale: 0.352 },
  { u0: 0.53027, v0: 0.13672, u1: 0.58496, v1: 0.41016, aspect: 0.8000, heightScale: 0.293 },
]

/** summer_grasses：3 丛浅色干草 + 1 个深色灌木球。 */
export const TALL_GRASS_REGIONS: SpriteRegion[] = [
  { u0: 0.04102, v0: 0.00000, u1: 0.21289, v1: 0.50000, aspect: 1.3750, heightScale: 0.538 },
  { u0: 0.24805, v0: 0.00000, u1: 0.49805, v1: 0.53125, aspect: 1.8824, heightScale: 0.571 },
  { u0: 0.50000, v0: 0.00000, u1: 0.75000, v1: 0.92969, aspect: 1.0756, heightScale: 1.000 },
  { u0: 0.75977, v0: 0.00000, u1: 0.99023, v1: 0.51562, aspect: 1.7879, heightScale: 0.555 },
]

/** spring_wall_barrier_wood：两条横栏（顶部木墙贴图备用，未使用）。 */
export const BARRIER_RAIL_REGIONS: SpriteRegion[] = [
  { u0: 0.00000, v0: 0.31641, u1: 1.00000, v1: 0.40234, aspect: 22.2609, heightScale: 1.000 },
  { u0: 0.00000, v0: 0.14063, u1: 1.00000, v1: 0.22656, aspect: 22.2609, heightScale: 1.000 },
]

export const TREE_FAR_VARIANTS = 64
