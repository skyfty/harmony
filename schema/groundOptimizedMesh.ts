import * as THREE from 'three'
import type { GroundContourBounds, GroundDynamicMesh } from './index'
import { sampleGroundEffectiveHeightRegion } from './groundMesh'

export const GROUND_OPTIMIZED_MESH_VERSION = 1 as const

export type GroundOptimizedMeshData = {
  version: typeof GROUND_OPTIMIZED_MESH_VERSION
  positions: number[]
  uvs: number[]
  indices: number[]
  vertexCount: number
  triangleCount: number
  sourceVertexCount: number
  sourceTriangleCount: number
  optimizedRowCount: number
  optimizedColumnCount: number
}

type GroundOptimizedMeshBuildOptions = {
  tolerance?: number
  maxSamplesPerAxis?: number
  maxSubdivisionDepth?: number
}

type GroundOptimizedHeightGrid = {
  rows: number
  columns: number
  values: Float32Array
}

type GroundOptimizedRegionGrid = {
  rows: number[]
  columns: number[]
}

function clampFinite(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value as number))
}

function computeVertexX(definition: GroundDynamicMesh, column: number): number {
  return -definition.width * 0.5 + column * definition.cellSize
}

function computeVertexZ(definition: GroundDynamicMesh, row: number): number {
  return -definition.depth * 0.5 + row * definition.cellSize
}

function buildHeightGrid(definition: GroundDynamicMesh): GroundOptimizedHeightGrid {
  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
  const region = sampleGroundEffectiveHeightRegion(
    definition as GroundDynamicMesh & { manualHeightMap: Float64Array; planningHeightMap: Float64Array },
    0,
    rows,
    0,
    columns,
  )
  return {
    rows,
    columns,
    values: region.values,
  }
}

function getGridHeight(grid: GroundOptimizedHeightGrid, row: number, column: number): number {
  return grid.values[row * (grid.columns + 1) + column] ?? 0
}

function samplePlaneHeight(
  definition: GroundDynamicMesh,
  grid: GroundOptimizedHeightGrid,
  rowStart: number,
  rowEnd: number,
  columnStart: number,
  columnEnd: number,
  row: number,
  column: number,
): number {
  const x0 = computeVertexX(definition, columnStart)
  const z0 = computeVertexZ(definition, rowStart)
  const x1 = computeVertexX(definition, columnEnd)
  const z1 = computeVertexZ(definition, rowEnd)
  const width = Math.max(1e-6, x1 - x0)
  const depth = Math.max(1e-6, z1 - z0)

  const h00 = getGridHeight(grid, rowStart, columnStart)
  const h10 = getGridHeight(grid, rowStart, columnEnd)
  const h01 = getGridHeight(grid, rowEnd, columnStart)
  const slopeX = (h10 - h00) / width
  const slopeZ = (h01 - h00) / depth

  return h00 + slopeX * (computeVertexX(definition, column) - x0) + slopeZ * (computeVertexZ(definition, row) - z0)
}

function patchMatchesPlane(
  definition: GroundDynamicMesh,
  grid: GroundOptimizedHeightGrid,
  rowStart: number,
  rowEnd: number,
  columnStart: number,
  columnEnd: number,
  tolerance: number,
): boolean {
  const cornerPlane = samplePlaneHeight(definition, grid, rowStart, rowEnd, columnStart, columnEnd, rowEnd, columnEnd)
  const cornerHeight = getGridHeight(grid, rowEnd, columnEnd)
  if (Math.abs(cornerHeight - cornerPlane) > tolerance) {
    return false
  }

  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = columnStart; column <= columnEnd; column += 1) {
      const actual = getGridHeight(grid, row, column)
      const expected = samplePlaneHeight(definition, grid, rowStart, rowEnd, columnStart, columnEnd, row, column)
      if (Math.abs(actual - expected) > tolerance) {
        return false
      }
    }
  }

  return true
}

function collectAdaptiveGridLines(
  definition: GroundDynamicMesh,
  grid: GroundOptimizedHeightGrid,
  rowStart: number,
  rowEnd: number,
  columnStart: number,
  columnEnd: number,
  depth: number,
  options: Required<GroundOptimizedMeshBuildOptions>,
  rows: Set<number>,
  columns: Set<number>,
): void {
  const rowSpan = rowEnd - rowStart
  const columnSpan = columnEnd - columnStart
  if (rowSpan <= 0 || columnSpan <= 0) {
    return
  }

  if (patchMatchesPlane(definition, grid, rowStart, rowEnd, columnStart, columnEnd, options.tolerance)) {
    return
  }

  if (depth >= options.maxSubdivisionDepth || (rowSpan <= 1 && columnSpan <= 1)) {
    for (let row = rowStart; row <= rowEnd; row += 1) {
      rows.add(row)
    }
    for (let column = columnStart; column <= columnEnd; column += 1) {
      columns.add(column)
    }
    return
  }

  if (rowSpan >= columnSpan && rowSpan > 1) {
    const middleRow = rowStart + Math.floor(rowSpan * 0.5)
    rows.add(middleRow)
    collectAdaptiveGridLines(definition, grid, rowStart, middleRow, columnStart, columnEnd, depth + 1, options, rows, columns)
    collectAdaptiveGridLines(definition, grid, middleRow, rowEnd, columnStart, columnEnd, depth + 1, options, rows, columns)
    return
  }

  if (columnSpan > 1) {
    const middleColumn = columnStart + Math.floor(columnSpan * 0.5)
    columns.add(middleColumn)
    collectAdaptiveGridLines(definition, grid, rowStart, rowEnd, columnStart, middleColumn, depth + 1, options, rows, columns)
    collectAdaptiveGridLines(definition, grid, rowStart, rowEnd, middleColumn, columnEnd, depth + 1, options, rows, columns)
    return
  }

  rows.add(rowStart)
  rows.add(rowEnd)
  columns.add(columnStart)
  columns.add(columnEnd)
}

function isRedundantRow(
  grid: GroundOptimizedHeightGrid,
  rows: number[],
  columns: number[],
  rowIndex: number,
  tolerance: number,
): boolean {
  if (rowIndex <= 0 || rowIndex >= rows.length - 1) {
    return false
  }
  const previousRow = rows[rowIndex - 1]!
  const currentRow = rows[rowIndex]!
  const nextRow = rows[rowIndex + 1]!
  const span = nextRow - previousRow
  if (span <= 0) {
    return false
  }
  const factor = (currentRow - previousRow) / span
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex]!
    const start = getGridHeight(grid, previousRow, column)
    const end = getGridHeight(grid, nextRow, column)
    const actual = getGridHeight(grid, currentRow, column)
    const expected = start + (end - start) * factor
    if (Math.abs(actual - expected) > tolerance) {
      return false
    }
  }
  return true
}

function isRedundantColumn(
  grid: GroundOptimizedHeightGrid,
  rows: number[],
  columns: number[],
  columnIndex: number,
  tolerance: number,
): boolean {
  if (columnIndex <= 0 || columnIndex >= columns.length - 1) {
    return false
  }
  const previousColumn = columns[columnIndex - 1]!
  const currentColumn = columns[columnIndex]!
  const nextColumn = columns[columnIndex + 1]!
  const span = nextColumn - previousColumn
  if (span <= 0) {
    return false
  }
  const factor = (currentColumn - previousColumn) / span
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!
    const start = getGridHeight(grid, row, previousColumn)
    const end = getGridHeight(grid, row, nextColumn)
    const actual = getGridHeight(grid, row, currentColumn)
    const expected = start + (end - start) * factor
    if (Math.abs(actual - expected) > tolerance) {
      return false
    }
  }
  return true
}

function pruneAdaptiveGridLines(
  grid: GroundOptimizedHeightGrid,
  rows: number[],
  columns: number[],
  tolerance: number,
): { rows: number[]; columns: number[] } {
  const prunedRows = [...rows]
  const prunedColumns = [...columns]

  let changed = true
  while (changed) {
    changed = false

    for (let rowIndex = prunedRows.length - 2; rowIndex >= 1; rowIndex -= 1) {
      if (!isRedundantRow(grid, prunedRows, prunedColumns, rowIndex, tolerance)) {
        continue
      }
      prunedRows.splice(rowIndex, 1)
      changed = true
    }

    for (let columnIndex = prunedColumns.length - 2; columnIndex >= 1; columnIndex -= 1) {
      if (!isRedundantColumn(grid, prunedRows, prunedColumns, columnIndex, tolerance)) {
        continue
      }
      prunedColumns.splice(columnIndex, 1)
      changed = true
    }
  }

  return { rows: prunedRows, columns: prunedColumns }
}

function createSequentialGridLines(count: number): number[] {
  return Array.from({ length: count + 1 }, (_value, index) => index)
}

function deriveNonPlanarAxisBounds(
  grid: GroundOptimizedHeightGrid,
  rows: number[],
  columns: number[],
  tolerance: number,
): GroundContourBounds | null {
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minColumn = Number.POSITIVE_INFINITY
  let maxColumn = Number.NEGATIVE_INFINITY

  for (let row = 1; row < rows.length - 1; row += 1) {
    if (isRedundantRow(grid, rows, columns, row, tolerance)) {
      continue
    }
    minRow = Math.min(minRow, row)
    maxRow = Math.max(maxRow, row)
  }

  for (let column = 1; column < columns.length - 1; column += 1) {
    if (isRedundantColumn(grid, rows, columns, column, tolerance)) {
      continue
    }
    minColumn = Math.min(minColumn, column)
    maxColumn = Math.max(maxColumn, column)
  }

  const hasRowBounds = Number.isFinite(minRow) && Number.isFinite(maxRow)
  const hasColumnBounds = Number.isFinite(minColumn) && Number.isFinite(maxColumn)
  if (!hasRowBounds && !hasColumnBounds) {
    return null
  }

  return {
    minRow: hasRowBounds ? minRow : 0,
    maxRow: hasRowBounds ? maxRow : grid.rows,
    minColumn: hasColumnBounds ? minColumn : 0,
    maxColumn: hasColumnBounds ? maxColumn : grid.columns,
  }
}

function padBounds(bounds: GroundContourBounds, grid: GroundOptimizedHeightGrid, padding: number): GroundContourBounds {
  const clampedPadding = Math.max(0, Math.trunc(padding))
  return {
    minRow: Math.max(0, bounds.minRow - clampedPadding),
    maxRow: Math.min(grid.rows, bounds.maxRow + clampedPadding),
    minColumn: Math.max(0, bounds.minColumn - clampedPadding),
    maxColumn: Math.min(grid.columns, bounds.maxColumn + clampedPadding),
  }
}

function deriveActiveBounds(
  definition: GroundDynamicMesh,
  grid: GroundOptimizedHeightGrid,
  tolerance: number,
): GroundContourBounds | null {
  const rows = createSequentialGridLines(Math.max(1, Math.trunc(definition.rows)))
  const columns = createSequentialGridLines(Math.max(1, Math.trunc(definition.columns)))
  const derived = deriveNonPlanarAxisBounds(grid, rows, columns, tolerance)
  if (!derived) {
    return null
  }
  return padBounds(derived, grid, 1)
}

function boundsCoverFullTerrain(bounds: GroundContourBounds, rows: number, columns: number): boolean {
  return bounds.minRow <= 0
    && bounds.maxRow >= rows
    && bounds.minColumn <= 0
    && bounds.maxColumn >= columns
}

function buildAdaptiveRegionGrid(
  definition: GroundDynamicMesh,
  grid: GroundOptimizedHeightGrid,
  bounds: GroundContourBounds,
  options: Required<GroundOptimizedMeshBuildOptions>,
): GroundOptimizedRegionGrid {
  const selectedRows = new Set<number>([bounds.minRow, bounds.maxRow])
  const selectedColumns = new Set<number>([bounds.minColumn, bounds.maxColumn])
  collectAdaptiveGridLines(
    definition,
    grid,
    bounds.minRow,
    bounds.maxRow,
    bounds.minColumn,
    bounds.maxColumn,
    0,
    options,
    selectedRows,
    selectedColumns,
  )

  const initialRows = Array.from(selectedRows.values()).sort((left, right) => left - right)
  const initialColumns = Array.from(selectedColumns.values()).sort((left, right) => left - right)
  return pruneAdaptiveGridLines(grid, initialRows, initialColumns, options.tolerance)
}

function appendBoundedValue(target: number[], start: number, end: number): void {
  if (end <= start) {
    return
  }
  if (target[target.length - 1] !== start) {
    target.push(start)
  }
  if (target[target.length - 1] !== end) {
    target.push(end)
  }
}

function createStripLines(start: number, end: number): number[] {
  const values: number[] = []
  appendBoundedValue(values, start, end)
  return values
}

function buildCartesianOptimizedMeshData(
  definition: GroundDynamicMesh,
  grid: GroundOptimizedHeightGrid,
  rows: number[],
  columns: number[],
  sourceVertexCount: number,
  sourceTriangleCount: number,
): GroundOptimizedMeshData {
  const rowsCount = Math.max(1, Math.trunc(definition.rows))
  const columnsCount = Math.max(1, Math.trunc(definition.columns))
  const vertexCount = rows.length * columns.length
  const positions = new Array<number>(vertexCount * 3)
  const uvs = new Array<number>(vertexCount * 2)
  const indices = new Array<number>((rows.length - 1) * (columns.length - 1) * 6)

  let vertexOffset = 0
  let uvOffset = 0
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!
    const z = computeVertexZ(definition, row)
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const column = columns[columnIndex]!
      positions[vertexOffset + 0] = computeVertexX(definition, column)
      positions[vertexOffset + 1] = getGridHeight(grid, row, column)
      positions[vertexOffset + 2] = z
      uvs[uvOffset + 0] = columnsCount === 0 ? 0 : column / columnsCount
      uvs[uvOffset + 1] = rowsCount === 0 ? 0 : 1 - row / rowsCount
      vertexOffset += 3
      uvOffset += 2
    }
  }

  let indexOffset = 0
  for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns.length - 1; columnIndex += 1) {
      const a = rowIndex * columns.length + columnIndex
      const b = a + 1
      const c = (rowIndex + 1) * columns.length + columnIndex
      const d = c + 1
      indices[indexOffset + 0] = a
      indices[indexOffset + 1] = c
      indices[indexOffset + 2] = b
      indices[indexOffset + 3] = b
      indices[indexOffset + 4] = c
      indices[indexOffset + 5] = d
      indexOffset += 6
    }
  }

  return {
    version: GROUND_OPTIMIZED_MESH_VERSION,
    positions,
    uvs,
    indices,
    vertexCount,
    triangleCount: indices.length / 3,
    sourceVertexCount,
    sourceTriangleCount,
    optimizedRowCount: rows.length,
    optimizedColumnCount: columns.length,
  }
}

function buildBoundedOptimizedMeshData(
  definition: GroundDynamicMesh,
  grid: GroundOptimizedHeightGrid,
  bounds: GroundContourBounds,
  adaptiveRegion: GroundOptimizedRegionGrid,
  sourceVertexCount: number,
  sourceTriangleCount: number,
): GroundOptimizedMeshData {
  const rowsCount = Math.max(1, Math.trunc(definition.rows))
  const columnsCount = Math.max(1, Math.trunc(definition.columns))
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const vertexLookup = new Map<string, number>()
  const selectedRows = new Set<number>()
  const selectedColumns = new Set<number>()

  const ensureVertex = (row: number, column: number): number => {
    const key = `${row}:${column}`
    const cached = vertexLookup.get(key)
    if (cached !== undefined) {
      return cached
    }
    const vertexIndex = positions.length / 3
    positions.push(
      computeVertexX(definition, column),
      getGridHeight(grid, row, column),
      computeVertexZ(definition, row),
    )
    uvs.push(
      columnsCount === 0 ? 0 : column / columnsCount,
      rowsCount === 0 ? 0 : 1 - row / rowsCount,
    )
    selectedRows.add(row)
    selectedColumns.add(column)
    vertexLookup.set(key, vertexIndex)
    return vertexIndex
  }

  const appendRegion = (regionRows: number[], regionColumns: number[]): void => {
    if (regionRows.length < 2 || regionColumns.length < 2) {
      return
    }
    for (let rowIndex = 0; rowIndex < regionRows.length - 1; rowIndex += 1) {
      const rowStart = regionRows[rowIndex]!
      const rowEnd = regionRows[rowIndex + 1]!
      if (rowEnd <= rowStart) {
        continue
      }
      for (let columnIndex = 0; columnIndex < regionColumns.length - 1; columnIndex += 1) {
        const columnStart = regionColumns[columnIndex]!
        const columnEnd = regionColumns[columnIndex + 1]!
        if (columnEnd <= columnStart) {
          continue
        }
        const a = ensureVertex(rowStart, columnStart)
        const b = ensureVertex(rowStart, columnEnd)
        const c = ensureVertex(rowEnd, columnStart)
        const d = ensureVertex(rowEnd, columnEnd)
        indices.push(a, c, b, b, c, d)
      }
    }
  }

  const topRows = createStripLines(0, bounds.minRow)
  const bottomRows = createStripLines(bounds.maxRow, rowsCount)
  const leftColumns = createStripLines(0, bounds.minColumn)
  const rightColumns = createStripLines(bounds.maxColumn, columnsCount)

  appendRegion(topRows, leftColumns)
  appendRegion(topRows, adaptiveRegion.columns)
  appendRegion(topRows, rightColumns)
  appendRegion(adaptiveRegion.rows, leftColumns)
  appendRegion(adaptiveRegion.rows, adaptiveRegion.columns)
  appendRegion(adaptiveRegion.rows, rightColumns)
  appendRegion(bottomRows, leftColumns)
  appendRegion(bottomRows, adaptiveRegion.columns)
  appendRegion(bottomRows, rightColumns)

  return {
    version: GROUND_OPTIMIZED_MESH_VERSION,
    positions,
    uvs,
    indices,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    sourceVertexCount,
    sourceTriangleCount,
    optimizedRowCount: selectedRows.size,
    optimizedColumnCount: selectedColumns.size,
  }
}

export function hasGroundOptimizedMeshData(definition: GroundDynamicMesh | null | undefined): boolean {
  const mesh = definition?.optimizedMesh
  return Boolean(
    mesh
    && mesh.version === GROUND_OPTIMIZED_MESH_VERSION
    && Array.isArray(mesh.positions)
    && Array.isArray(mesh.uvs)
    && Array.isArray(mesh.indices)
    && mesh.positions.length >= 12
    && mesh.uvs.length >= 8
    && mesh.indices.length >= 6,
  )
}

export function buildGroundOptimizedMeshData(
  definition: GroundDynamicMesh,
  options: GroundOptimizedMeshBuildOptions = {},
): GroundOptimizedMeshData {
  const grid = buildHeightGrid(definition)
  const rowsCount = Math.max(1, Math.trunc(definition.rows))
  const columnsCount = Math.max(1, Math.trunc(definition.columns))
  const sourceVertexCount = (rowsCount + 1) * (columnsCount + 1)
  const sourceTriangleCount = rowsCount * columnsCount * 2
  const normalizedOptions: Required<GroundOptimizedMeshBuildOptions> = {
    tolerance: clampFinite(options.tolerance, 0.02, 0.0001, 10),
    maxSamplesPerAxis: Math.trunc(clampFinite(options.maxSamplesPerAxis, 6, 2, 16)),
    maxSubdivisionDepth: Math.trunc(clampFinite(options.maxSubdivisionDepth, 10, 1, 24)),
  }

  const activeBounds = deriveActiveBounds(definition, grid, normalizedOptions.tolerance)
  if (activeBounds && !boundsCoverFullTerrain(activeBounds, rowsCount, columnsCount)) {
    const adaptiveRegion = buildAdaptiveRegionGrid(definition, grid, activeBounds, normalizedOptions)
    return buildBoundedOptimizedMeshData(
      definition,
      grid,
      activeBounds,
      adaptiveRegion,
      sourceVertexCount,
      sourceTriangleCount,
    )
  }

  const selectedRows = new Set<number>([0, rowsCount])
  const selectedColumns = new Set<number>([0, columnsCount])
  collectAdaptiveGridLines(
    definition,
    grid,
    0,
    rowsCount,
    0,
    columnsCount,
    0,
    normalizedOptions,
    selectedRows,
    selectedColumns,
  )

  const initialRows = Array.from(selectedRows.values()).sort((left, right) => left - right)
  const initialColumns = Array.from(selectedColumns.values()).sort((left, right) => left - right)
  const { rows, columns } = pruneAdaptiveGridLines(
    grid,
    initialRows,
    initialColumns,
    normalizedOptions.tolerance,
  )
  return buildCartesianOptimizedMeshData(
    definition,
    grid,
    rows,
    columns,
    sourceVertexCount,
    sourceTriangleCount,
  )
}

export function buildGroundOptimizedGeometry(mesh: GroundOptimizedMeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.positions), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(mesh.uvs), 2))
  const indexArray = mesh.positions.length / 3 > 65535
    ? new Uint32Array(mesh.indices)
    : new Uint16Array(mesh.indices)
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
