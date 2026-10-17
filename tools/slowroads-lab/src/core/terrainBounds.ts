/** Axis-aligned XZ bounds used by both procedural and DEM terrain sources. */
export interface TerrainBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  sizeX: number
  sizeZ: number
  centerX: number
  centerZ: number
}

export function createTerrainBounds(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): TerrainBounds {
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    sizeX: maxX - minX,
    sizeZ: maxZ - minZ,
    centerX: (minX + maxX) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
  }
}
