import {
  parseTerrainDemPackageSidecar,
  type TerrainDemPackageSidecar,
} from '@schema/terrainDemPackage'

export function parseTerrainDemSidecarJson(bytes: Uint8Array): TerrainDemPackageSidecar {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('地形包 dem.json 不是有效的 JSON。')
  }
  return parseTerrainDemPackageSidecar(parsed)
}

/**
 * Guards against a corrupted package where the sidecar no longer matches the
 * GeoTIFF that was actually parsed (dimensions or pixel size drift).
 */
export function verifyTerrainDemPackageImport(
  sidecar: TerrainDemPackageSidecar,
  dem: { width: number; height: number; sampleStepMeters: number | null },
): void {
  if (dem.width !== sidecar.dem.width || dem.height !== sidecar.dem.height) {
    throw new Error(
      `地形包不一致：dem.tif 为 ${dem.width}×${dem.height}，dem.json 记录为 ${sidecar.dem.width}×${sidecar.dem.height}。`,
    )
  }
  const step = Number(dem.sampleStepMeters)
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error('地形包不一致：无法从 dem.tif 解析像素间距。')
  }
  const tolerance = sidecar.dem.cellSizeMeters * 0.005
  if (Math.abs(step - sidecar.dem.cellSizeMeters) > tolerance) {
    throw new Error(
      `地形包不一致：dem.tif 像素间距 ${step}m 与 dem.json 记录的 ${sidecar.dem.cellSizeMeters}m 不符。`,
    )
  }
}
