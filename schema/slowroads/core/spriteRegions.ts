import type * as THREE from 'three'
import type { SeasonId } from './seasonCatalog'
import {
  GENERATED_BUSH_REGIONS,
  GENERATED_CONIFER_CARD_REGIONS,
  GENERATED_GRASS_SPRITE_REGIONS,
  type GeneratedSpriteEntry,
  type GeneratedSpriteRegion,
} from './spriteRegionsData'

/**
 * 精灵图集的区域表（平台无关核心层）。
 *
 * 网格类图集（imposters 16×4、阔叶树卡 4 列）由 `gridRegions` 按行列生成，
 * 带 1.5 texel 内缩防止 mipmap 渗色；打包类图集（灌木、草丛、针叶树卡）的
 * 区域由 `scripts/measure-sprites.py` 按 alpha 连通域实测后写入
 * `spriteRegionsData.ts`（生成文件，勿手改）。区域是**着色器 UV 空间**
 * （原点左下）：素材是图片空间（原点左上），换算规则 `v = 1 - y / height`。
 *
 * 槽位语义对齐 slowroads：灌木/草丛每季固定 4 个变体格（cell 0..3），
 * 空位为 null（冬季裁掉 0/1 号草格等）；针叶树卡只取“主干落地”的侧视树。
 */
export interface SpriteRegion {
  u0: number
  v0: number
  u1: number
  v1: number
  /** 画幅宽高比（宽 / 高）。 */
  aspect: number
  /** 相对高度：1.0 = 该图集内最高的区域。 */
  heightScale: number
}

export interface SpriteAtlasSpec {
  texture: THREE.Texture
  /** diffuse 自身 alpha 不可用（如 slowroads 树卡的 *_m）时提供单独的遮罩图，按 R 通道取样。 */
  alphaTexture?: THREE.Texture | null
  normalTexture?: THREE.Texture | null
  /** 每季/每变体的区域（可能含 null 空位，长度 = 图集变体格数）。 */
  regions: Array<SpriteRegion | null>
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

function fromGenerated(region: GeneratedSpriteRegion | null): SpriteRegion | null {
  if (!region) {
    return null
  }
  return {
    u0: region.u0,
    v0: region.v0,
    u1: region.u1,
    v1: region.v1,
    aspect: region.aspect,
    heightScale: region.heightScale,
  }
}

/** 一个图集格（slowroads 变体 cell 0..3）里的一个实测精灵。 */
export interface SpriteCellRegion {
  cell: number
  region: SpriteRegion
}

function fromGeneratedEntries(entries: ReadonlyArray<GeneratedSpriteEntry>): SpriteCellRegion[] {
  return entries.map((entry) => ({ cell: entry.cell, region: fromGenerated(entry.region)! }))
}

/** 阔叶树卡：4 列“树丛卡”，底部 128px（v 0.75→1）是树皮条带，不参与渲染。四季同布局。 */
export const BROADLEAF_CARD_REGIONS: SpriteRegion[] = [
  { u0: 0.00000, v0: 0.25000, u1: 0.25000, v1: 1.00000, aspect: 1.3333, heightScale: 1.000 },
  { u0: 0.25000, v0: 0.25000, u1: 0.50000, v1: 1.00000, aspect: 1.3333, heightScale: 1.000 },
  { u0: 0.50000, v0: 0.25000, u1: 0.75000, v1: 1.00000, aspect: 1.3333, heightScale: 1.000 },
  { u0: 0.75000, v0: 0.25000, u1: 1.00000, v1: 1.00000, aspect: 1.3333, heightScale: 1.000 },
]

/** 灌木层的全部实测精灵（含每个精灵所在的图集格）。 */
export function getBushEntries(season: SeasonId): SpriteCellRegion[] {
  return fromGeneratedEntries(GENERATED_BUSH_REGIONS[season].entries)
}

/** 草丛精灵层的全部实测精灵；冬季只有 2/3 号格（slowroads 会裁掉 0/1 号变体）。 */
export function getGrassEntries(season: SeasonId): SpriteCellRegion[] {
  return fromGeneratedEntries(GENERATED_GRASS_SPRITE_REGIONS[season].entries)
}

/** 常规草层只使用 0..2 号草格；3 号是棕色草球，不属于道路草灌样式。 */
export function grassVariantEntries(season: SeasonId): SpriteCellRegion[] {
  return getGrassEntries(season).filter((entry) => entry.cell <= 2)
}

/** 针叶近树卡：每季 2 株“主干落地”的侧视树（实测区域已裁掉倒挂枝/俯视冠盘）。 */
export function getConiferCardRegions(season: SeasonId): SpriteRegion[] {
  return GENERATED_CONIFER_CARD_REGIONS[season].regions.map((region) => fromGenerated(region)!)
}

/** spring_wall_barrier_wood：两条横栏（顶部木墙贴图备用，未使用）。 */
export const BARRIER_RAIL_REGIONS: SpriteRegion[] = [
  { u0: 0.00000, v0: 0.31641, u1: 1.00000, v1: 0.40234, aspect: 22.2609, heightScale: 1.000 },
  { u0: 0.00000, v0: 0.14063, u1: 1.00000, v1: 0.22656, aspect: 22.2609, heightScale: 1.000 },
]

/**
 * 灌木层的可用精灵。
 *
 * slowroads 的灌木顶点着色器只把变体指派到 0..2 号格（阴影处偏向蕨类 2 号、
 * 空地偏向 1 号，3 号格仅在注释掉的“荆豆”分支出现），而图集第 4 格是云杉枝
 * 装饰卡；立在路侧会像倒挂的枝子（上一版 lab 实测结论一致）。这里保持官方
 * 选择空间：只用 0..2 号格。
 */
export function bushVariantEntries(season: SeasonId): SpriteCellRegion[] {
  return getBushEntries(season).filter((entry) => entry.cell <= 2)
}

export const TREE_FAR_VARIANTS = 64
