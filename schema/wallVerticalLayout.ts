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
