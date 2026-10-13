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
  /** leaf-colour scaling for green-dominant tree pixels (leafEffect). */
  treeDiscolouration: number
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
    hasSnow: true,
    frozenWater: true,
  },
}

