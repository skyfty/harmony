import * as CANNON from 'cannon-es'

export type CannonRoadHeightfieldDebugSurface = {
  matrix: number[][]
  elementSize: number
  offset: [number, number, number]
}

export function extractCannonRoadHeightfieldDebugSurfaces(
  bodies: CANNON.Body[],
): CannonRoadHeightfieldDebugSurface[] {
  const segments: CannonRoadHeightfieldDebugSurface[] = []
  bodies.forEach((body) => {
    const heightfieldShape = body.shapes.find((candidate) => candidate instanceof CANNON.Heightfield) as
      | CANNON.Heightfield
      | undefined
    if (!heightfieldShape) {
      return
    }
    const matrixSource = (heightfieldShape as any).data as unknown
    const elementSize = (heightfieldShape as any).elementSize as unknown
    if (!Array.isArray(matrixSource) || typeof elementSize !== 'number' || !Number.isFinite(elementSize) || elementSize <= 0) {
      return
    }
    let rowCount = 0
    matrixSource.forEach((column) => {
      if (Array.isArray(column) && column.length > rowCount) {
        rowCount = column.length
      }
    })
    if (matrixSource.length < 2 || rowCount < 2) {
      return
    }
    const matrix: number[][] = matrixSource.map((column) => {
      if (!Array.isArray(column)) {
        return []
      }
      return column.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0))
    })
    const width = (matrix.length - 1) * elementSize
    const depth = (rowCount - 1) * elementSize
    segments.push({
      matrix,
      elementSize,
      offset: [-width * 0.5, -depth * 0.5, 0],
    })
  })
  return segments
}
