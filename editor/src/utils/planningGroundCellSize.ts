/**
 * Working-grid cell size planning for DEM conversions.
 *
 * The runtime ground stores its whole working grid as two float64 layers inside
 * the scene height sidecar (16 bytes per vertex), so the grid implied by
 * `worldBounds / cellSize` must stay inside a vertex budget. DEM conversions
 * can expand the ground bounds far beyond the default working area (tens of
 * kilometres); coarsen the working cell size so the sidecar stays allocatable
 * instead of trying to build multi-gigabyte buffers.
 */

// Soft working-grid budget: 2048 x 2048 vertices ~= 64 MiB height sidecar,
// matching the size a 2 km scene at 1 m cells already produced before the DEM
// conversion path existed. Keeps small scenes untouched while bounding the
// multi-gigabyte sidecars large DEM extents used to trigger.
const GROUND_WORKING_GRID_VERTEX_LIMIT = 2048 * 2048

export function resolveGroundWorkingCellSizeForBounds(
  currentCellSize: number | null | undefined,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  chunkSizeMeters = 100,
): number {
  const current = Number(currentCellSize)
  const normalizedCurrent = Number.isFinite(current) && current > 0 ? current : 1
  const spanX = Math.max(0, bounds.maxX - bounds.minX)
  const spanZ = Math.max(0, bounds.maxZ - bounds.minZ)
  const maxSpan = Math.max(spanX, spanZ)
  if (!(maxSpan > 0)) {
    return normalizedCurrent
  }
  const required = maxSpan / Math.sqrt(GROUND_WORKING_GRID_VERTEX_LIMIT)
  const chunkSize = Number.isFinite(chunkSizeMeters) && chunkSizeMeters > 0 ? chunkSizeMeters : 100
  // Derive the cell size from the extent so re-converting always reaches the
  // budget-correct resolution (an earlier, coarser value is not sticky). Only
  // sub-metre grids the user/process picked explicitly are preserved.
  const base = Math.max(
    Number.isFinite(required) ? Math.ceil(required * 1000) / 1000 : 0,
    Math.min(normalizedCurrent, 1),
  )
  // Quantize the working-grid cell size so a terrain chunk spans a whole number
  // of grid cells (`chunkSize = divisor * cellSize`). Otherwise the streamed
  // chunk meshes (meshed over their grid span) no longer match the 100m chunk
  // spacing and visible seams appear between chunks.
  const divisor = Math.max(1, Math.floor(chunkSize / base))
  return chunkSize / divisor
}
