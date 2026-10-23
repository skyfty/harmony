import * as THREE from 'three'
import { writeArrayBuffer } from 'geotiff'
import type { TerrainDemPackageSidecar } from '../../../schema/terrainDemPackage'
import { eastOffsetToLongitudeDeltaDegrees, latLonToUtm, utmZoneOfLongitude } from './wgs84Utm'

/**
 * DEM export pipeline for the merged terrain mesh.
 *
 * The merged geometry from `terrainMerge.ts` lives in the capture-local frame
 * where +X points north, +Y points up and +Z points east (the viewer's camera
 * base frame). This module rasterises that mesh into a regular height grid,
 * fills sampling holes, and encodes GeoTIFF rasters whose affine transform
 * maps the grid onto the UTM zone that contains the capture anchor.
 *
 * Grid layout convention used everywhere in this module:
 *  - `rows` run north -> south (raster row 0 is the northern edge),
 *  - `cols` run west -> east (raster column 0 is the western edge),
 *  - a cell value is sampled at the cell centre,
 *  - DEM values are WGS84 ellipsoid heights in meters.
 */

export const DEM_PACKAGE_VERSION = 1
export const DEFAULT_DEM_GRID_MAX_SIZE = 4096
export const DEM_CELL_SIZE_SNAP_STEPS = [0.5, 1, 2, 5, 10, 20] as const

const MEDIAN_EDGE_MAX_TRIANGLE_SAMPLES = 50000
const DEFAULT_SAMPLE_CHUNK_TRIANGLES = 65536
const RASTER_EDGE_EPSILON = 1e-9
const RASTER_MIN_PROJECTED_AREA = 1e-12

export type DemExportPhase =
  | 'prepare'
  | 'merge'
  | 'sample'
  | 'fill-dem'
  | 'encode-dem'
  | 'ortho-render'
  | 'ortho-process'
  | 'encode-ortho'
  | 'package'

export interface DemExportProgress {
  phase: DemExportPhase
  completed: number
  total: number
  label: string
}

export interface DemExportStageTiming {
  phase: DemExportPhase
  elapsedMs: number
}

export interface DemExportFrame {
  latitudeDegrees: number
  longitudeDegrees: number
  /** WGS84 ellipsoid height of the local frame origin in meters. */
  groundElevationMeters: number
}

export interface DemGridPlan {
  rows: number
  cols: number
  cellSizeMeters: number
  /** Local north extent (mesh X axis) in meters. */
  xMin: number
  xMax: number
  /** Local east extent (mesh Z axis) in meters. */
  zMin: number
  zMax: number
  autoCellSize: boolean
}

export interface DemOrthoCameraFrame {
  xCenter: number
  zCenter: number
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * OrthographicCamera frustum values are camera-local offsets, not absolute
 * scene coordinates. Keep every tile symmetric around its camera position so
 * a raster tile maps exactly to NDC [-1, 1] on both axes.
 */
export function resolveDemOrthoCameraFrame(
  plan: DemGridPlan,
  tile: {
    rowStart: number
    colStart: number
    width: number
    height: number
  },
): DemOrthoCameraFrame {
  const halfWidth = tile.width * plan.cellSizeMeters * 0.5
  const halfHeight = tile.height * plan.cellSizeMeters * 0.5
  return {
    xCenter: plan.xMax - (tile.rowStart + tile.height * 0.5) * plan.cellSizeMeters,
    zCenter: plan.zMin + (tile.colStart + tile.width * 0.5) * plan.cellSizeMeters,
    left: -halfWidth,
    right: halfWidth,
    top: halfHeight,
    bottom: -halfHeight,
  }
}

export interface DemPlanResult {
  plan: DemGridPlan
  warnings: string[]
}

export interface DemPlanOptions {
  /** `'auto'` (default) derives the cell size from the mesh triangle edges. */
  cellSize?: number | 'auto'
  /** Hard cap for both raster dimensions. Default 4096. */
  maxGridSize?: number
}

export interface DemGeoReference {
  epsg: number
  zone: number
  hemisphere: 'north' | 'south'
  /** UTM coordinates of the local frame origin (local x = 0, z = 0). */
  eastingOrigin: number
  northingOrigin: number
  /** GDAL geotransform [originX, pixelX, 0, originY, 0, -pixelY]. */
  geoTransform: [number, number, number, number, number, number]
}

export interface DemSampleProgress {
  phase: 'sample' | 'fill'
  loaded: number
  total: number
  label: string
}

export interface DemSampleOptions {
  onProgress?: (progress: DemSampleProgress) => void
  /** Triangle visits processed between event-loop yields/progress updates. */
  chunkCells?: number
  /** Injectable yield hook for tests. */
  yieldFn?: () => Promise<void>
}

export interface DemSampleResult {
  /** rows * cols ellipsoid heights (filled; no NaN remains unless nothing hit). */
  heights: Float32Array
  hitCount: number
  holeCount: number
  filledCount: number
  filledRatio: number
  /** 1 where the cell had to be filled from a neighbour. */
  wasHole: Uint8Array
}

export interface TerrainDemSidecarInput {
  frame: DemExportFrame
  plan: DemGridPlan
  geo: DemGeoReference
  heights: Float32Array
  sample: Pick<DemSampleResult, 'hitCount' | 'filledCount' | 'filledRatio'>
  sourceTriangleCount: number
  hasOrtho: boolean
  warnings: string[]
  createdAt?: Date
}

function defaultYield(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function formatMeters(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function snapCellSizeUp(value: number): number {
  for (const step of DEM_CELL_SIZE_SNAP_STEPS) {
    if (value <= step) {
      return step
    }
  }
  return Math.ceil(value / 10) * 10
}

function triangleCountOf(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex()
  const position = geometry.getAttribute('position')
  if (!position || position.count < 3) {
    return 0
  }
  return index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)
}

function readTriangleVertexIndices(
  geometry: THREE.BufferGeometry,
  triangle: number,
): [number, number, number] {
  const index = geometry.getIndex()
  if (index) {
    return [index.getX(triangle * 3), index.getX(triangle * 3 + 1), index.getX(triangle * 3 + 2)]
  }
  return [triangle * 3, triangle * 3 + 1, triangle * 3 + 2]
}

/**
 * Median triangle edge length in meters, estimated from a deterministic
 * stride-sample of the mesh so huge terrains stay fast to plan.
 */
export function estimateMedianTriangleEdgeMeters(geometry: THREE.BufferGeometry): number {
  const triangleCount = triangleCountOf(geometry)
  if (triangleCount <= 0) {
    throw new Error('DEM 采样失败：地形网格没有三角形。')
  }
  const position = geometry.getAttribute('position')
  const stride = Math.max(1, Math.floor(triangleCount / MEDIAN_EDGE_MAX_TRIANGLE_SAMPLES))
  const edges: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  for (let triangle = 0; triangle < triangleCount; triangle += stride) {
    const [ia, ib, ic] = readTriangleVertexIndices(geometry, triangle)
    a.set(position.getX(ia), position.getY(ia), position.getZ(ia))
    b.set(position.getX(ib), position.getY(ib), position.getZ(ib))
    c.set(position.getX(ic), position.getY(ic), position.getZ(ic))
    edges.push(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a))
  }

  if (edges.length === 0) {
    return 1
  }
  edges.sort((left, right) => left - right)
  const median = edges[Math.floor(edges.length / 2)] ?? 1
  return Number.isFinite(median) && median > 0 ? median : 1
}

/**
 * Builds the raster plan for the merged terrain mesh: extent from the mesh
 * bounding box, cell size either auto-derived from triangle edges or taken
 * from the caller, clamped so both raster dimensions stay below the cap.
 */
export function planDemGrid(
  geometry: THREE.BufferGeometry,
  options: DemPlanOptions = {},
): DemPlanResult {
  if (triangleCountOf(geometry) <= 0) {
    throw new Error('DEM 采样失败：地形网格没有三角形。')
  }
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }
  const box = geometry.boundingBox
  if (!box || box.isEmpty()) {
    throw new Error('DEM 采样失败：地形网格包围盒为空。')
  }

  const xSpan = box.max.x - box.min.x
  const zSpan = box.max.z - box.min.z
  if (!(xSpan > 0) || !(zSpan > 0)) {
    throw new Error('DEM 采样失败：地形网格包围盒退化。')
  }

  const maxGridSize = Math.max(
    2,
    Math.floor(Number.isFinite(options.maxGridSize) ? Number(options.maxGridSize) : DEFAULT_DEM_GRID_MAX_SIZE),
  )
  const warnings: string[] = []

  let autoCellSize = false
  let cellSize: number
  if (options.cellSize === undefined || options.cellSize === 'auto') {
    autoCellSize = true
    cellSize = snapCellSizeUp(estimateMedianTriangleEdgeMeters(geometry))
  } else {
    const requested = Number(options.cellSize)
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new Error(`DEM 分辨率无效：${String(options.cellSize)}`)
    }
    cellSize = requested
  }

  let rows = Math.max(2, Math.ceil(xSpan / cellSize))
  let cols = Math.max(2, Math.ceil(zSpan / cellSize))
  if (rows > maxGridSize || cols > maxGridSize) {
    const requestedCellSize = cellSize
    while (rows > maxGridSize || cols > maxGridSize) {
      cellSize = snapCellSizeUp(cellSize * 1.25 + 1e-9)
      rows = Math.max(2, Math.ceil(xSpan / cellSize))
      cols = Math.max(2, Math.ceil(zSpan / cellSize))
    }
    warnings.push(
      `为满足 ${maxGridSize}×${maxGridSize} 网格上限，采样间距从 ${formatMeters(requestedCellSize)}m 调整为 ${formatMeters(cellSize)}m。`,
    )
  }

  return {
    plan: {
      rows,
      cols,
      cellSizeMeters: cellSize,
      xMin: box.min.x,
      xMax: box.max.x,
      zMin: box.min.z,
      zMax: box.max.z,
      autoCellSize,
    },
    warnings,
  }
}

/**
 * Maps the local grid onto the UTM zone of the anchor. Throws when the raster
 * extent crosses a UTM zone boundary so the caller can ask for a new anchor.
 */
export function resolveDemGeoReference(plan: DemGridPlan, frame: DemExportFrame): DemGeoReference {
  const utm = latLonToUtm(frame.latitudeDegrees, frame.longitudeDegrees)
  const westLon = frame.longitudeDegrees + eastOffsetToLongitudeDeltaDegrees(plan.zMin, frame.latitudeDegrees)
  const eastLon = frame.longitudeDegrees + eastOffsetToLongitudeDeltaDegrees(plan.zMax, frame.latitudeDegrees)
  if (utmZoneOfLongitude(westLon) !== utm.zone || utmZoneOfLongitude(eastLon) !== utm.zone) {
    throw new Error('导出区域跨越 UTM 分带，无法生成单一投影的 DEM。请在分带内重新设置锚点后导出。')
  }

  const geoTransform: DemGeoReference['geoTransform'] = [
    utm.easting + plan.zMin,
    plan.cellSizeMeters,
    0,
    utm.northing + plan.xMax,
    0,
    -plan.cellSizeMeters,
  ]

  return {
    epsg: utm.epsg,
    zone: utm.zone,
    hemisphere: utm.hemisphere,
    eastingOrigin: utm.easting,
    northingOrigin: utm.northing,
    geoTransform,
  }
}

/**
 * Fills cells without a terrain hit from the nearest sampled cell using a
 * multi-source BFS. Returns the filled count and a mask of the filled cells
 * so the same holes can be patched in the ortho image.
 */
export function fillDemHoles(
  heights: Float32Array,
  rows: number,
  cols: number,
  options: {
    onProgress?: (progress: { filledCount: number; processedCount: number; totalCount: number }) => void
  } = {},
): { filledCount: number; wasHole: Uint8Array } {
  const count = rows * cols
  const wasHole = new Uint8Array(count)
  const queue = new Int32Array(count)
  const onProgress = options.onProgress
  let head = 0
  let tail = 0
  let filledCount = 0
  let lastProgressAt = 0

  for (let index = 0; index < count; index += 1) {
    if (Number.isFinite(heights[index])) {
      queue[tail] = index
      tail += 1
    } else {
      wasHole[index] = 1
    }
  }

  // Nothing to fill from: leave the raster as-is (caller reports the failure).
  if (tail === 0) {
    return { filledCount: 0, wasHole }
  }

  while (head < tail) {
    const index = queue[head] ?? 0
    head += 1
    const row = Math.floor(index / cols)
    const col = index - row * cols
    const value = heights[index] ?? Number.NaN

    if (col > 0) {
      const neighbour = index - 1
      if (!Number.isFinite(heights[neighbour])) {
        heights[neighbour] = value
        filledCount += 1
        queue[tail] = neighbour
        tail += 1
      }
    }
    if (col < cols - 1) {
      const neighbour = index + 1
      if (!Number.isFinite(heights[neighbour])) {
        heights[neighbour] = value
        filledCount += 1
        queue[tail] = neighbour
        tail += 1
      }
    }
    if (row > 0) {
      const neighbour = index - cols
      if (!Number.isFinite(heights[neighbour])) {
        heights[neighbour] = value
        filledCount += 1
        queue[tail] = neighbour
        tail += 1
      }
    }
    if (row < rows - 1) {
      const neighbour = index + cols
      if (!Number.isFinite(heights[neighbour])) {
        heights[neighbour] = value
        filledCount += 1
        queue[tail] = neighbour
        tail += 1
      }
    }

    if (onProgress && head - lastProgressAt >= 65536) {
      lastProgressAt = head
      onProgress({ filledCount, processedCount: head, totalCount: count })
    }
  }

  onProgress?.({ filledCount, processedCount: count, totalCount: count })
  return { filledCount, wasHole }
}

/**
 * Samples the merged terrain mesh into a height grid by scan-converting every
 * triangle into the target raster. Each cell keeps the highest triangle
 * intersection, matching a vertical ray entering the mesh from above without
 * paying for one BVH query per cell.
 */
export async function sampleDemHeights(
  geometry: THREE.BufferGeometry,
  plan: DemGridPlan,
  frame: DemExportFrame,
  options: DemSampleOptions = {},
): Promise<DemSampleResult> {
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }
  const box = geometry.boundingBox
  if (!box || box.isEmpty()) {
    throw new Error('DEM 采样失败：地形网格包围盒为空。')
  }

  const heights = new Float32Array(plan.rows * plan.cols)
  heights.fill(Number.NaN)

  const position = geometry.getAttribute('position')
  if (!position || position.count < 3) {
    throw new Error('DEM 采样失败：地形网格没有顶点。')
  }
  const index = geometry.getIndex()
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)
  if (triangleCount <= 0) {
    throw new Error('DEM 采样失败：地形网格没有三角形。')
  }

  const chunkTriangles = Math.max(1024, options.chunkCells ?? DEFAULT_SAMPLE_CHUNK_TRIANGLES)
  const yieldFn = options.yieldFn ?? defaultYield
  const onProgress = options.onProgress
  const cellSize = plan.cellSizeMeters
  const cellCount = plan.rows * plan.cols

  let hitCount = 0
  let processedSinceYield = 0

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = index ? index.getX(triangle * 3) : triangle * 3
    const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
    const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2

    const ax = position.getX(ia)
    const ay = position.getY(ia)
    const az = position.getZ(ia)
    const bx = position.getX(ib)
    const by = position.getY(ib)
    const bz = position.getZ(ib)
    const cx = position.getX(ic)
    const cy = position.getY(ic)
    const cz = position.getZ(ic)

    // A projected triangle with no X/Z area can only touch a raster cell on a
    // measure-zero edge (vertical skirts). The hole filler handles those cells.
    const denominator = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= RASTER_MIN_PROJECTED_AREA) {
      processedSinceYield += 1
      continue
    }

    const minZ = Math.min(az, bz, cz)
    const maxZ = Math.max(az, bz, cz)
    const minX = Math.min(ax, bx, cx)
    const maxX = Math.max(ax, bx, cx)

    const colStart = Math.max(0, Math.ceil((minZ - plan.zMin) / cellSize - 0.5))
    const colEnd = Math.min(plan.cols - 1, Math.floor((maxZ - plan.zMin) / cellSize - 0.5))
    const rowStart = Math.max(0, Math.ceil((plan.xMax - maxX) / cellSize - 0.5))
    const rowEnd = Math.min(plan.rows - 1, Math.floor((plan.xMax - minX) / cellSize - 0.5))

    if (colStart <= colEnd && rowStart <= rowEnd) {
      for (let row = rowStart; row <= rowEnd; row += 1) {
        const x = plan.xMax - (row + 0.5) * cellSize
        for (let col = colStart; col <= colEnd; col += 1) {
          const z = plan.zMin + (col + 0.5) * cellSize
          const weightB = ((z - az) * (cx - ax) - (x - ax) * (cz - az)) / denominator
          const weightC = ((x - ax) * (bz - az) - (z - az) * (bx - ax)) / denominator
          const weightA = 1 - weightB - weightC
          if (
            weightA < -RASTER_EDGE_EPSILON
            || weightB < -RASTER_EDGE_EPSILON
            || weightC < -RASTER_EDGE_EPSILON
          ) {
            continue
          }

          const y = weightA * ay + weightB * by + weightC * cy
          const offset = row * plan.cols + col
          const previous = heights[offset] ?? Number.NaN
          if (Number.isNaN(previous)) {
            hitCount += 1
            heights[offset] = y + frame.groundElevationMeters
          } else if (y + frame.groundElevationMeters > previous) {
            heights[offset] = y + frame.groundElevationMeters
          }
        }
      }
    }

    processedSinceYield += 1
    if (processedSinceYield >= chunkTriangles) {
      processedSinceYield = 0
      onProgress?.({
        phase: 'sample',
        loaded: triangle + 1,
        total: triangleCount,
        label: `扫描地形三角形 ${triangle + 1}/${triangleCount}`,
      })
      await yieldFn()
    }
  }

  onProgress?.({
    phase: 'sample',
    loaded: triangleCount,
    total: triangleCount,
    label: `扫描地形三角形 ${triangleCount}/${triangleCount}`,
  })

  const { filledCount, wasHole } = fillDemHoles(heights, plan.rows, plan.cols, {
    onProgress: ({ filledCount: currentFilledCount, processedCount, totalCount }) => {
      onProgress?.({
        phase: 'fill',
        loaded: processedCount,
        total: totalCount,
        label: `填充采样空洞 ${currentFilledCount}/${totalCount}`,
      })
    },
  })
  const totalCells = cellCount

  return {
    heights,
    hitCount,
    holeCount: totalCells - hitCount,
    filledCount,
    filledRatio: totalCells > 0 ? filledCount / totalCells : 0,
    wasHole,
  }
}

function baseRasterMetadata(
  rows: number,
  cols: number,
  geo: DemGeoReference,
): Record<string, unknown> {
  return {
    height: rows,
    width: cols,
    ModelPixelScale: [geo.geoTransform[1], -geo.geoTransform[5], 0],
    ModelTiepoint: [0, 0, 0, geo.geoTransform[0], geo.geoTransform[3], 0],
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    GeographicTypeGeoKey: 4326,
    GeogCitationGeoKey: 'WGS 84',
    ProjectedCSTypeGeoKey: geo.epsg,
  }
}

/** Encodes the height grid as a float32 single band GeoTIFF. */
export function encodeDemGeoTiff(
  heights: Float32Array,
  plan: DemGridPlan,
  geo: DemGeoReference,
): ArrayBuffer {
  const metadata = baseRasterMetadata(plan.rows, plan.cols, geo)
  return writeArrayBuffer(
    heights,
    metadata as Parameters<typeof writeArrayBuffer>[1],
  )
}

/** Encodes an interleaved RGB raster as an uint8 GeoTIFF. */
export function encodeOrthoGeoTiff(
  rgb: Uint8Array,
  plan: DemGridPlan,
  geo: DemGeoReference,
): ArrayBuffer {
  const metadata = baseRasterMetadata(plan.rows, plan.cols, geo)
  return writeArrayBuffer(
    rgb,
    metadata as Parameters<typeof writeArrayBuffer>[1],
  )
}

/**
 * Copies one ortho render-target tile (OpenGL bottom-up rows) into the final
 * north-up RGB raster. Screen right is east and screen up is north, so tile
 * row 0 (GL bottom) is the tile's *southern* row.
 */
export function copyRenderTargetTileToOrtho(options: {
  rgba: Uint8Array
  tileWidth: number
  tileHeight: number
  /** Raster row of the tile's northern edge. */
  rasterRowStart: number
  /** Raster column of the tile's western edge. */
  rasterColStart: number
  rasterRows: number
  rasterCols: number
  rgb: Uint8Array
}): void {
  const { rgba, tileWidth, tileHeight, rasterRowStart, rasterColStart, rasterRows, rasterCols, rgb } = options
  for (let y = 0; y < tileHeight; y += 1) {
    const rasterRow = rasterRowStart + (tileHeight - 1 - y)
    if (rasterRow < 0 || rasterRow >= rasterRows) {
      continue
    }
    for (let x = 0; x < tileWidth; x += 1) {
      const rasterCol = rasterColStart + x
      if (rasterCol < 0 || rasterCol >= rasterCols) {
        continue
      }
      const source = (y * tileWidth + x) * 4
      const target = (rasterRow * rasterCols + rasterCol) * 3
      rgb[target] = rgba[source] ?? 0
      rgb[target + 1] = rgba[source + 1] ?? 0
      rgb[target + 2] = rgba[source + 2] ?? 0
    }
  }
}

/**
 * Patches ortho holes (cells the DEM had to fill) with the nearest valid
 * colour, using the same multi-source BFS as `fillDemHoles`.
 */
export function fillRgbHoles(
  rgb: Uint8Array,
  wasHole: Uint8Array,
  rows: number,
  cols: number,
  options: {
    onProgress?: (progress: { processedCount: number; totalCount: number }) => void
  } = {},
): number {
  const count = rows * cols
  const queue = new Int32Array(count)
  const pending = new Uint8Array(count)
  const onProgress = options.onProgress
  let head = 0
  let tail = 0
  let lastProgressAt = 0

  for (let index = 0; index < count; index += 1) {
    if (wasHole[index] === 1) {
      pending[index] = 1
    } else {
      queue[tail] = index
      tail += 1
    }
  }
  if (tail === 0) {
    return 0
  }

  let filled = 0
  while (head < tail) {
    const index = queue[head] ?? 0
    head += 1
    const row = Math.floor(index / cols)
    const col = index - row * cols
    const neighbours = [
      col > 0 ? index - 1 : -1,
      col < cols - 1 ? index + 1 : -1,
      row > 0 ? index - cols : -1,
      row < rows - 1 ? index + cols : -1,
    ]
    for (const neighbour of neighbours) {
      if (neighbour < 0 || pending[neighbour] !== 1) {
        continue
      }
      pending[neighbour] = 0
      const source = index * 3
      const target = neighbour * 3
      rgb[target] = rgb[source] ?? 0
      rgb[target + 1] = rgb[source + 1] ?? 0
      rgb[target + 2] = rgb[source + 2] ?? 0
      filled += 1
      queue[tail] = neighbour
      tail += 1
    }

    if (onProgress && head - lastProgressAt >= 65536) {
      lastProgressAt = head
      onProgress({ processedCount: head, totalCount: count })
    }
  }
  onProgress?.({ processedCount: count, totalCount: count })
  return filled
}

/**
 * Treat both DEM sampling holes and actual black ortho pixels as uncovered.
 * A missing material or failed tile otherwise survives as RGB 0 and causes the
 * editor to reveal procedural terrain inside an otherwise textured raster.
 */
export function buildRgbCoverageHoleMask(
  rgb: Uint8Array,
  wasHole: Uint8Array,
  rows: number,
  cols: number,
  options: {
    onProgress?: (progress: { processedCount: number; totalCount: number }) => void
  } = {},
): { mask: Uint8Array; coveredCount: number; holeCount: number } {
  const count = rows * cols
  const mask = new Uint8Array(count)
  const onProgress = options.onProgress
  let coveredCount = 0
  let holeCount = 0
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const covered = (
      (rgb[offset] ?? 0) !== 0
      || (rgb[offset + 1] ?? 0) !== 0
      || (rgb[offset + 2] ?? 0) !== 0
    )
    if (covered) {
      coveredCount += 1
    }
    if (wasHole[index] === 1 || !covered) {
      mask[index] = 1
      holeCount += 1
    }
    if (onProgress && index > 0 && index % 65536 === 0) {
      onProgress({ processedCount: index, totalCount: count })
    }
  }
  onProgress?.({ processedCount: count, totalCount: count })
  return { mask, coveredCount, holeCount }
}

/** Builds the `dem.json` sidecar for the exported package. */
export function buildTerrainDemSidecar(input: TerrainDemSidecarInput): TerrainDemPackageSidecar {
  let minElevation = Number.POSITIVE_INFINITY
  let maxElevation = Number.NEGATIVE_INFINITY
  for (let index = 0; index < input.heights.length; index += 1) {
    const value = input.heights[index]
    if (value === undefined || !Number.isFinite(value)) {
      continue
    }
    if (value < minElevation) minElevation = value
    if (value > maxElevation) maxElevation = value
  }

  const createdAt = input.createdAt ?? new Date()
  const totalCells = input.plan.rows * input.plan.cols

  return {
    version: DEM_PACKAGE_VERSION as TerrainDemPackageSidecar['version'],
    generator: '3dtiles-viewer',
    createdAt: createdAt.toISOString(),
    anchor: {
      latitudeDegrees: input.frame.latitudeDegrees,
      longitudeDegrees: input.frame.longitudeDegrees,
      groundElevationMeters: input.frame.groundElevationMeters,
    },
    crs: {
      type: 'utm',
      epsg: input.geo.epsg,
      zone: input.geo.zone,
      hemisphere: input.geo.hemisphere,
      geographicEpsg: 4326,
    },
    geoTransform: [...input.geo.geoTransform] as TerrainDemPackageSidecar['geoTransform'],
    elevationDatum: 'wgs84-ellipsoid',
    dem: {
      file: 'dem.tif',
      width: input.plan.cols,
      height: input.plan.rows,
      cellSizeMeters: input.plan.cellSizeMeters,
      minElevationMeters: Number.isFinite(minElevation) ? minElevation : null,
      maxElevationMeters: Number.isFinite(maxElevation) ? maxElevation : null,
    },
    ortho: input.hasOrtho
      ? {
          file: 'ortho.tif',
          width: input.plan.cols,
          height: input.plan.rows,
          cellSizeMeters: input.plan.cellSizeMeters,
          photometric: 'rgb',
        }
      : null,
    stats: {
      sourceTriangleCount: input.sourceTriangleCount,
      sampledCellCount: totalCells,
      filledCellCount: input.sample.filledCount,
      filledRatio: input.sample.filledRatio,
      warnings: [...input.warnings],
    },
  }
}
