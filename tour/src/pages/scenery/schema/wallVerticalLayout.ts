import { WALL_DEFAULT_HEIGHT } from './components/definitions/wallComponent'

export type WallVerticalLayout = {
  bodyBaseY: number
  bodyHeight: number
  headBaseY: number
  footBaseY: number
}

export type WallVerticalLayoutOptions = {
  headAssetHeight?: number
  footAssetHeight?: number
}

export type WallVerticalAnchorMode = 'body' | 'head' | 'foot'

export type ResolveWallPartAnchoredYOptions = {
  layout: WallVerticalLayout
  mode: WallVerticalAnchorMode
  minY: number
  maxY: number
  scaleY?: number
  baselineY?: number
}

export function resolveWallTotalHeight(totalHeightRaw: number, fallback = WALL_DEFAULT_HEIGHT): number {
  return Math.max(0, Number.isFinite(totalHeightRaw) ? totalHeightRaw : fallback)
}

export function resolveWallAssetHeight(assetHeightRaw: number | undefined): number {
  return Math.max(0, Number.isFinite(assetHeightRaw) ? (assetHeightRaw as number) : 0)
}

export function resolveWallVerticalLayout(
  totalHeightRaw: number,
  options: WallVerticalLayoutOptions = {},
): WallVerticalLayout {
  const totalHeight = resolveWallTotalHeight(totalHeightRaw)
  const headAssetHeight = resolveWallAssetHeight(options.headAssetHeight)
  const footAssetHeight = resolveWallAssetHeight(options.footAssetHeight)
  const bodyHeight = Math.max(0, totalHeight - headAssetHeight - footAssetHeight)

  return {
    bodyBaseY: footAssetHeight,
    bodyHeight,
    headBaseY: Math.max(0, totalHeight - headAssetHeight),
    footBaseY: 0,
  }
}

export function resolveWallPartAnchoredY(options: ResolveWallPartAnchoredYOptions): number {
  const { layout, mode, minY, maxY } = options
  const scaleY = Number.isFinite(options.scaleY) ? (options.scaleY as number) : 1
  const baselineY = Number.isFinite(options.baselineY) ? (options.baselineY as number) : 0

  if (mode === 'body') {
    return baselineY + layout.bodyBaseY - scaleY * minY
  }
  if (mode === 'head') {
    return baselineY + layout.bodyBaseY + layout.bodyHeight - minY
  }
  return baselineY + layout.bodyBaseY - maxY
}
