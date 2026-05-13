export type AmmoRoadHeightfieldDebugSurface = {
  matrix: number[][]
  elementSize: number
  offset: [number, number, number]
}

export function extractAmmoRoadHeightfieldDebugSurfaces(bodies: any[]): AmmoRoadHeightfieldDebugSurface[] {
  const segments: AmmoRoadHeightfieldDebugSurface[] = []
  bodies.forEach((body) => {
    const bindings = body?.__harmonyShapeBindings as Array<{ definition?: any }> | undefined
    if (!Array.isArray(bindings)) {
      return
    }
    bindings.forEach((binding) => {
      const definition = binding?.definition
      if (!definition || definition.kind !== 'heightfield' || !Array.isArray(definition.matrix)) {
        return
      }
      const matrix = definition.matrix.map((column: any) => (Array.isArray(column) ? column.map((value) => Number(value) || 0) : []))
      const elementSize = Number(definition.elementSize)
      if (!(elementSize > 0) || matrix.length < 2 || (matrix[0]?.length ?? 0) < 2) {
        return
      }
      const width = (matrix.length - 1) * elementSize
      const depth = ((matrix[0]?.length ?? 0) - 1) * elementSize
      segments.push({
        matrix,
        elementSize,
        offset: definition.offset ?? ([-width * 0.5, -depth * 0.5, 0] as [number, number, number]),
      })
    })
  })
  return segments
}
