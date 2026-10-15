/**
 * Official slowroads seasonal shading parameters (extracted from the shipped
 * scene presets). Colours are authored as `#RRGGBB` strings to stay
 * three-agnostic; the lab converts them into THREE.Color uniforms.
 *
 * Shader branch semantics keyed on `index` (see seasonCatalog.SEASON_INDEX):
 *   - index == 1 (summer): the terrain paints the road colour band even close
 *     to the camera (`vCamDepth > 100 || seasonIndex == 1`);
 *   - index == 2 (autumn): roadside gravel brightens under tree shadow (1.8);
 *   - index == 3 (winter): no sand band, no roadside gravel, far detail x0.7,
 *     snow on leaf trees (normal-up mix), frozen water.
 *
 * The alpha-test values come from the official preset table
 * (`foliage: { grassAlphaTest, bushAlphaTest, imposterAlphaTest }`; winter
 * differs: .2/.3/.5). Near tree cards use fixed values instead: broadleaf .5
 * (map alpha) and conifer .4 (alpha map), per the official shared tree material.
 *
 * `effects.treeDiscolouration` 是树卡变色噪声的**幅度**，不是通道乘数：官方顶点先用
 * `1.0 + (noise(world.xz / 256.0) - 0.5) * factor` 换算成 ≈1 的乘数（冬季 0.2 → 0.9..1.1），
 * 柏树列再走 `* 0.5 + 0.5`。把因子直接当乘数会让冬季绿通道只剩 20%，树冠因此发紫
 * （2026-10 修复，见 lab/foliage.ts 与 lab/treeMeshes.ts 顶点注释）。
 */

import { SEASON_INDEX, type SeasonId } from './seasonCatalog'

export interface SeasonParams {
  id: SeasonId
  /** slowroads shader season index (spring 0 / summer 1 / autumn 2 / winter 3). */
  index: number
  /** base grass colours; the grass texture multiplies into these. */
  grassColA: string
  grassColB: string
  /** grass "tip" colours for the light-grass factor. */
  peakColA: string
  peakColB: string
  /** farmland-style tint added by the field attribute (lab: unused, kept for porting). */
  fieldDiscolouration: string
  /** terrain-painted road band colour. */
  roadCol: string
  /** tree-shadow strength multiplier feeding the road overlay. */
  shadowFactor: number
  /**
   * 官方 `effects.treeDiscolouration`：树卡/近树/远景树变色**噪声的幅度**，不是乘数。
   * 官方顶点分块先换算成乘数
   * `disc = 1.0 + (noise(world.xz / 256.0) - 0.5) * factor`（冬 0.2 → 0.9..1.1、
   * 春 1.5 → 0.25..1.75），柏树列再走 `disc * 0.5 + 0.5`；随后阔叶 `rg *= disc`
   * （近树卡/近树网格为 `rg *= 1 - (1 - disc) * leafEffect`）、针叶 `g *= disc`。
   */
  treeDiscolouration: number
  /** official foliage.grassAlphaTest — grass sprite alpha cutout. */
  grassAlphaTest: number
  /** official foliage.bushAlphaTest — bush alpha cutout (floored by the distance alpha). */
  bushAlphaTest: number
  /** official foliage.imposterAlphaTest — far tree card alpha cutout. */
  imposterAlphaTest: number
  /** winter: snow whitening on leaf trees + imposters. */
  hasSnow: boolean
  /** winter: flat/desaturated water surface. */
  frozenWater: boolean
}

export const SEASON_PARAMS: Record<SeasonId, SeasonParams> = {
  spring: {
    id: 'spring',
    index: SEASON_INDEX.spring,
    grassColA: '#4F9140',
    grassColB: '#94AC53',
    peakColA: '#B7C08C',
    peakColB: '#C5875E',
    fieldDiscolouration: '#180C0C',
    roadCol: '#636260',
    shadowFactor: 0.8,
    treeDiscolouration: 1.5,
    grassAlphaTest: 0.5,
    bushAlphaTest: 0.2,
    imposterAlphaTest: 0.6,
    hasSnow: false,
    frozenWater: false,
  },
  summer: {
    id: 'summer',
    index: SEASON_INDEX.summer,
    grassColA: '#699159',
    grassColB: '#AFAD64',
    peakColA: '#D3C497',
    peakColB: '#D6875C',
    fieldDiscolouration: '#2E0905',
    roadCol: '#5F5C5A',
    shadowFactor: 0.9,
    treeDiscolouration: 0.9,
    grassAlphaTest: 0.5,
    bushAlphaTest: 0.2,
    imposterAlphaTest: 0.6,
    hasSnow: false,
    frozenWater: false,
  },
  autumn: {
    id: 'autumn',
    index: SEASON_INDEX.autumn,
    grassColA: '#4A7D4D',
    grassColB: '#BEAF79',
    peakColA: '#E3BEA0',
    peakColB: '#A28A45',
    fieldDiscolouration: '#231C15',
    roadCol: '#636260',
    shadowFactor: 0.8,
    treeDiscolouration: 1.2,
    grassAlphaTest: 0.5,
    bushAlphaTest: 0.2,
    imposterAlphaTest: 0.6,
    hasSnow: false,
    frozenWater: false,
  },
  winter: {
    id: 'winter',
    index: SEASON_INDEX.winter,
    grassColA: '#FFFFFF',
    grassColB: '#DBDDE1',
    peakColA: '#DBDDE1',
    peakColB: '#B9BDC6',
    fieldDiscolouration: '#616161',
    roadCol: '#959493',
    shadowFactor: 0.75,
    treeDiscolouration: 0.2,
    grassAlphaTest: 0.2,
    bushAlphaTest: 0.3,
    imposterAlphaTest: 0.5,
    hasSnow: true,
    frozenWater: true,
  },
}

