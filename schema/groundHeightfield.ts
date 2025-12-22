import type { SceneNode, GroundDynamicMesh } from '@harmony/schema'
import type { RigidbodyPhysicsShape } from './components'

export type GroundHeightfieldData = {
  matrix: number[][]
  elementSize: number
  width: number
  depth: number
  halfWidth: number
  halfDepth: number
  offset: [number, number, number]
  signature: string
}

const MIN_ELEMENT_SIZE = 1e-4

export function isGroundDynamicMesh(value: SceneNode['dynamicMesh'] | null | undefined): value is GroundDynamicMesh {
  return Boolean(value && value.type === 'Ground')
}

function resolveNodeScaleVector(scaleLike: SceneNode['scale'] | null | undefined): {
  scaleX: number
  scaleY: number
  scaleZ: number
} {
  if (!scaleLike || typeof scaleLike !== 'object') {
    return { scaleX: 1, scaleY: 1, scaleZ: 1 }
  }
  const source = scaleLike as Record<'x' | 'y' | 'z', unknown>
  const scaleX = typeof source.x === 'number' && Number.isFinite(source.x) ? source.x : 1
  const scaleY = typeof source.y === 'number' && Number.isFinite(source.y) ? source.y : 1
  const scaleZ = typeof source.z === 'number' && Number.isFinite(source.z) ? source.z : 1
  return { scaleX, scaleY, scaleZ }
}

function getPositiveNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : NaN
  if (numeric > 0) {
    return numeric
  }
  return fallback > 0 ? fallback : 1
}

export function buildGroundHeightfieldData(
  node: SceneNode,
  mesh: GroundDynamicMesh,
): GroundHeightfieldData | null {
  const rawRows = Number.isFinite(mesh.rows) ? Math.floor(mesh.rows) : 0
  const rawColumns = Number.isFinite(mesh.columns) ? Math.floor(mesh.columns) : 0
  const rows = Math.max(1, rawRows)
  const columns = Math.max(1, rawColumns)
  const pointsX = columns + 1
  const pointsZ = rows + 1
  if (pointsX <= 1 || pointsZ <= 1) {
    return null
  }

  const rawCellSize = getPositiveNumber(mesh.cellSize, 1)
  const { scaleX, scaleY, scaleZ } = resolveNodeScaleVector(node.scale)
  const uniformHorizontalScale = Math.max(MIN_ELEMENT_SIZE, (Math.abs(scaleX) + Math.abs(scaleZ)) * 0.5)
  const elementSize = Math.max(MIN_ELEMENT_SIZE, rawCellSize * uniformHorizontalScale)
  const heightMap = mesh.heightMap ?? {}
  const matrix: number[][] = []
  let heightHash = 0

  for (let column = 0; column < pointsX; column += 1) {
    const columnValues: number[] = []

    // Cannon heightfields use the first index for the X axis and the second for Y.
    // Our ground grid increases Z when row increases, so we need to flip the row
    // order to keep the physics heightfield aligned with the rendered geometry.
    for (let row = pointsZ - 1; row >= 0; row -= 1) {
      const key = `${row}:${column}`
      const rawHeight = heightMap[key]
      const baseHeight = typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : 0
      const height = baseHeight * scaleY
      columnValues.push(height)
      const normalized = Math.round(height * 1000)
      heightHash = (heightHash * 31 + normalized) >>> 0
    }

    matrix.push(columnValues)
  }

  const width = Math.max(MIN_ELEMENT_SIZE, columns * elementSize)
  const depth = Math.max(MIN_ELEMENT_SIZE, rows * elementSize)
  const halfWidth = Math.max(0, width * 0.5)
  const halfDepth = Math.max(0, depth * 0.5)
  const offset: [number, number, number] = [-halfWidth, -halfDepth, 0]
  const signature = `${columns}|${rows}|${Math.round(rawCellSize * 1000)}|${Math.round(width * 1000)}|${Math.round(depth * 1000)}|${heightHash.toString(16)}`

  return {
    matrix,
    elementSize,
    width,
    depth,
    halfWidth,
    halfDepth,
    offset,
    signature,
  }
}

export function buildHeightfieldShapeFromGroundNode(node: SceneNode): RigidbodyPhysicsShape | null {
  if (!isGroundDynamicMesh(node.dynamicMesh)) {
    return null
  }
  const data = buildGroundHeightfieldData(node, node.dynamicMesh)
  if (!data) {
    return null
  }
  return {
    kind: 'heightfield',
    matrix: data.matrix,
    elementSize: data.elementSize,
    width: data.width,
    depth: data.depth,
    offset: data.offset,
  }
}
