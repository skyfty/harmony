import type { RoadProfile } from './roadProfile'

/**
 * Scene-independent height source for generated road geometry. The editor can
 * later implement the same contract from its TerrainSurfaceSampler.
 */
export interface TerrainSurfaceHeightSource {
  readonly cellSize: number
  heightAt(x: number, z: number): number
  maxHeightAt(x: number, z: number, radius: number): number
}

export interface TerrainGridSurfaceData {
  cols: number
  rows: number
  minX: number
  minZ: number
  cellSizeX: number
  cellSizeZ: number
  /** Row 0 south, column 0 west. */
  heights: Float32Array
}

/** Exact triangle interpolation on the coarse terrain grid. */
export function createTerrainGridSurface(data: TerrainGridSurfaceData): TerrainSurfaceHeightSource {
  const { cols, rows, minX, minZ, cellSizeX, cellSizeZ, heights } = data
  const cellSize = Math.max(cellSizeX, cellSizeZ)

  const heightAt = (x: number, z: number): number => {
    const gx = Math.min(cols - 1 - 1e-6, Math.max(0, (x - minX) / cellSizeX))
    const gz = Math.min(rows - 1 - 1e-6, Math.max(0, (z - minZ) / cellSizeZ))
    const col = Math.floor(gx)
    const row = Math.floor(gz)
    const u = gx - col
    const v = gz - row
    const base = row * cols + col
    const h00 = heights[base]!
    const h10 = heights[base + 1]!
    const h01 = heights[base + cols]!
    const h11 = heights[base + cols + 1]!
    // The coarse builder uses the (a,c,d) and (a,d,b) diagonal.
    if (u <= v) {
      return h00 + (h01 - h00) * v + (h11 - h01) * u
    }
    return h00 + (h10 - h00) * u + (h11 - h10) * v
  }

  const maxHeightAt = (x: number, z: number, radius: number): number => {
    if (!(radius > 0)) {
      return heightAt(x, z)
    }
    const offsets = [-1, -0.5, 0, 0.5, 1]
    let best = Number.NEGATIVE_INFINITY
    for (const oz of offsets) {
      for (const ox of offsets) {
        const height = heightAt(x + ox * radius, z + oz * radius)
        if (height > best) {
          best = height
        }
      }
    }
    return best
  }

  return { cellSize, heightAt, maxHeightAt }
}

export interface RoadCrossSectionSample {
  columns: number[]
  centerHeight: number
  leftEdgeHeight: number
  rightEdgeHeight: number
}

export interface RoadCrossSectionOptions {
  columnCount?: number
  envelopeRadius?: number
}

/** Samples a conservative surface envelope across one road row. */
export function sampleRoadCrossSection(
  surface: TerrainSurfaceHeightSource,
  row: { x: number; z: number; heading: number },
  halfWidth: number,
  options: RoadCrossSectionOptions = {},
): RoadCrossSectionSample {
  const columnCount = Math.max(2, Math.round(options.columnCount ?? 9))
  const envelopeRadius = options.envelopeRadius ?? Math.max(0.5, surface.cellSize * 0.75)
  const perpX = -Math.sin(row.heading)
  const perpZ = Math.cos(row.heading)
  const columns: number[] = []
  for (let col = 0; col < columnCount; col += 1) {
    const u = col / (columnCount - 1)
    const lateral = -halfWidth + u * halfWidth * 2
    columns.push(surface.maxHeightAt(row.x + perpX * lateral, row.z + perpZ * lateral, envelopeRadius))
  }
  const centerIndex = Math.floor(columnCount / 2)
  return {
    columns,
    centerHeight: columns[centerIndex]!,
    leftEdgeHeight: columns[0]!,
    rightEdgeHeight: columns[columnCount - 1]!,
  }
}

export interface RoadBandColumnResult {
  columns: number[][]
  step: number
  columnCount: number
}

/** Column heights aligned with the road mesh's 2m rows. */
export function sampleRoadBandColumns(
  profile: RoadProfile,
  surface: TerrainSurfaceHeightSource,
  options: RoadCrossSectionOptions & { step?: number; flatCrossSection?: boolean } = {},
): RoadBandColumnResult {
  const step = Math.max(0.5, options.step ?? 2)
  const columnCount = Math.max(2, Math.round(options.columnCount ?? 9))
  const flatCrossSection = options.flatCrossSection ?? true
  const sampleCount = Math.max(2, Math.floor(profile.length / step) + 1)
  const columns: number[][] = []
  for (let i = 0; i < sampleCount; i += 1) {
    const row = profile.sampleAt(Math.min(profile.length, i * step))
    const section = sampleRoadCrossSection(surface, row, profile.halfWidth, {
      columnCount,
      envelopeRadius: options.envelopeRadius,
    })
    if (flatCrossSection) {
      const flat = Math.max(...section.columns)
      columns.push(new Array(columnCount).fill(flat))
    } else {
      columns.push(section.columns)
    }
  }
  return { columns, step, columnCount }
}

export interface RoadSurfaceAuditOptions {
  clearance?: number
  crossSamples?: number
}

export interface RoadSurfaceAudit {
  samples: number
  occluded: number
  maxAboveRoad: number
}

/**
 * Dense audit of the final road-band surface against the visible coarse
 * surface. A non-zero result means a coarse triangle still rises through it.
 */
export function countRoadSurfaceOcclusions(
  profile: RoadProfile,
  surface: TerrainSurfaceHeightSource,
  columnResult: RoadBandColumnResult,
  options: RoadSurfaceAuditOptions = {},
): RoadSurfaceAudit {
  const clearance = options.clearance ?? 0.05
  const crossSamples = Math.max(3, Math.round(options.crossSamples ?? 17))
  const perpX = (row: { heading: number }): number => -Math.sin(row.heading)
  const perpZ = (row: { heading: number }): number => Math.cos(row.heading)
  let occluded = 0
  let samples = 0
  let maxAboveRoad = 0
  const rowCount = Math.min(
    columnResult.columns.length,
    Math.max(2, Math.floor(profile.length / columnResult.step) + 1),
  )
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = profile.sampleAt(Math.min(profile.length, rowIndex * columnResult.step))
    const columns = columnResult.columns[rowIndex]!
    const px = perpX(row)
    const pz = perpZ(row)
    for (let sampleIndex = 0; sampleIndex < crossSamples; sampleIndex += 1) {
      const u = sampleIndex / (crossSamples - 1)
      const scaled = u * (columns.length - 1)
      const low = Math.floor(scaled)
      const high = Math.min(columns.length - 1, low + 1)
      const fraction = scaled - low
      const bandHeight = columns[low]! + (columns[high]! - columns[low]!) * fraction + clearance
      const lateral = -profile.halfWidth + u * profile.halfWidth * 2
      const surfaceHeight = surface.heightAt(
        row.x + px * lateral,
        row.z + pz * lateral,
      )
      samples += 1
      const above = surfaceHeight - bandHeight
      if (above > maxAboveRoad) {
        maxAboveRoad = above
      }
      if (above > 1e-3) {
        occluded += 1
      }
    }
  }
  return { samples, occluded, maxAboveRoad }
}
