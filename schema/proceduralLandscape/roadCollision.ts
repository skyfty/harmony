import * as THREE from 'three'

import type { RoadBandRow } from './roadBandRows'

export interface RoadCollisionGeometryOptions {
  rows: ReadonlyArray<RoadBandRow>
  columnHeights?: ReadonlyArray<ReadonlyArray<number>> | null
  halfWidth: number
  rowSpacing: number
  columnCount?: number
  lift?: number
  hostInverse?: THREE.Matrix4 | null
}

export interface RoadCollisionGeometryResult {
  geometry: THREE.BufferGeometry
  sourceRowCount: number
  rowCount: number
  columnCount: number
  triangleCount: number
}

function sampleColumns(
  columns: ReadonlyArray<number> | null | undefined,
  t: number,
  fallback: number,
): number {
  if (!columns || columns.length < 2) {
    return fallback
  }
  const scaled = Math.min(columns.length - 1, Math.max(0, t * (columns.length - 1)))
  const low = Math.floor(scaled)
  const high = Math.min(columns.length - 1, low + 1)
  const fraction = scaled - low
  return columns[low]! + (columns[high]! - columns[low]!) * fraction
}

/**
 * Collision-only road ribbon.
 *
 * The rendered road band uses dense 2m x 0.5m sampling for smooth shading.
 * Feeding that same dense ribbon to a capsule/character motor creates a lot of
 * trimesh contact edges. This helper decimates the same centerline and lateral
 * profile so physics follows the design surface with far fewer triangles.
 */
export function createRoadCollisionGeometry(
  options: RoadCollisionGeometryOptions,
): RoadCollisionGeometryResult | null {
  const rows = options.rows
  if (rows.length < 2) {
    return null
  }
  const columnCount = Math.max(2, Math.round(options.columnCount ?? 5))
  const rowSpacing = Math.max(0.5, options.rowSpacing)
  const baseSpacing = Math.max(
    0.1,
    Math.hypot(rows[1]!.x - rows[0]!.x, rows[1]!.z - rows[0]!.z),
  )
  const rowStride = Math.max(1, Math.round(rowSpacing / baseSpacing))
  const selectedRows: number[] = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += rowStride) {
    selectedRows.push(rowIndex)
  }
  const lastRowIndex = rows.length - 1
  if (selectedRows[selectedRows.length - 1] !== lastRowIndex) {
    selectedRows.push(lastRowIndex)
  }
  const vertexCount = selectedRows.length * columnCount
  const triangleCount = (selectedRows.length - 1) * (columnCount - 1) * 2
  const positions = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(triangleCount * 3)
  const lift = options.lift ?? 0
  const halfWidth = Math.max(0.05, options.halfWidth)
  let vertexCursor = 0

  selectedRows.forEach((sourceRowIndex) => {
    const row = rows[sourceRowIndex]!
    const sourceColumns = options.columnHeights?.[sourceRowIndex] ?? null
    const normalX = -Math.sin(row.heading)
    const normalZ = Math.cos(row.heading)
    for (let column = 0; column < columnCount; column += 1) {
      const t = column / (columnCount - 1)
      const side = t * 2 - 1
      positions[vertexCursor * 3] = row.x + normalX * halfWidth * side
      positions[vertexCursor * 3 + 1] = sampleColumns(sourceColumns, t, row.y) + lift
      positions[vertexCursor * 3 + 2] = row.z + normalZ * halfWidth * side
      vertexCursor += 1
    }
  })

  let indexCursor = 0
  for (let row = 0; row < selectedRows.length - 1; row += 1) {
    const currentBase = row * columnCount
    const nextBase = (row + 1) * columnCount
    for (let column = 0; column < columnCount - 1; column += 1) {
      indices[indexCursor++] = currentBase + column
      indices[indexCursor++] = currentBase + column + 1
      indices[indexCursor++] = nextBase + column
      indices[indexCursor++] = currentBase + column + 1
      indices[indexCursor++] = nextBase + column + 1
      indices[indexCursor++] = nextBase + column
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  if (options.hostInverse) {
    geometry.applyMatrix4(options.hostInverse)
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return {
    geometry,
    sourceRowCount: rows.length,
    rowCount: selectedRows.length,
    columnCount,
    triangleCount,
  }
}
