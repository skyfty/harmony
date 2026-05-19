import { createAmmoShape, type BuiltAmmoShape } from './shapeFactory'
import type { AmmoApi } from './ammoHelpers'
import type {
  PhysicsBackendShapeScaleLike,
  PhysicsShapeDefinition,
  PhysicsShapeScale,
} from '@harmony/physics-bridge'

export type SchemaShapeScaleLike = PhysicsBackendShapeScaleLike

export type SchemaShapeDefinition = PhysicsShapeDefinition

export function createAmmoSchemaShape(
  ammo: AmmoApi,
  definition: SchemaShapeDefinition,
  scaleLike: SchemaShapeScaleLike,
): BuiltAmmoShape | null {
  const safeScale = normalizeShapeScale(scaleLike)
  if (definition.kind === 'box') {
    const scaleX = definition.applyScale === true ? safeScale.x : 1
    const scaleY = definition.applyScale === true ? safeScale.y : 1
    const scaleZ = definition.applyScale === true ? safeScale.z : 1
    return createAmmoShape(ammo, {
      id: -1,
      kind: 'box',
      halfExtents: [
        definition.halfExtents[0] * scaleX,
        definition.halfExtents[1] * scaleY,
        definition.halfExtents[2] * scaleZ,
      ],
    } as any, false)
  }
  if (definition.kind === 'sphere') {
    const scaleFactor = definition.applyScale === true ? Math.max(safeScale.x, safeScale.y, safeScale.z) : 1
    return createAmmoShape(ammo, {
      id: -1,
      kind: 'sphere',
      radius: Number(definition.radius) * scaleFactor,
    } as any, false)
  }
  if (definition.kind === 'cylinder') {
    const radiusScale = definition.applyScale === true ? Math.max(safeScale.x, safeScale.z) : 1
    const heightScale = definition.applyScale === true ? safeScale.y : 1
    return createAmmoShape(ammo, {
      id: -1,
      kind: 'cylinder',
      radiusTop: Number(definition.radiusTop) * radiusScale,
      radiusBottom: Number(definition.radiusBottom) * radiusScale,
      height: Number(definition.height) * heightScale,
      segments: definition.segments,
    } as any, false)
  }
  if (definition.kind === 'convex') {
    const vertices = Array.isArray(definition.vertices)
      ? definition.vertices.map((tuple) => [
        Number(tuple?.[0]) * (definition.applyScale === true ? safeScale.x : 1),
        Number(tuple?.[1]) * (definition.applyScale === true ? safeScale.y : 1),
        Number(tuple?.[2]) * (definition.applyScale === true ? safeScale.z : 1),
      ])
      : []
    const flatVertices = new Float32Array(vertices.flat())
    return createAmmoShape(ammo, {
      id: -1,
      kind: 'convex-hull',
      vertices: flatVertices,
      faces: definition.faces,
    } as any, false)
  }
  if (definition.kind === 'heightfield') {
    const matrix = Array.isArray(definition.matrix) ? definition.matrix : []
    const rows = matrix[0]?.length ?? 0
    const columns = matrix.length
    const heights = new Float32Array(rows * columns)
    let offset = 0
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        heights[offset] = Number(matrix[column]?.[row]) || 0
        offset += 1
      }
    }
    return createAmmoShape(ammo, {
      id: -1,
      kind: 'heightfield',
      rows,
      columns,
      elementSize: Number(definition.elementSize),
      heights,
      localOffset: definition.offset,
    } as any, false)
  }
  return null
}

function normalizeShapeScale(scaleLike: SchemaShapeScaleLike): PhysicsShapeScale {
  const sx = typeof scaleLike?.x === 'number' && Number.isFinite(scaleLike.x) ? Math.abs(scaleLike.x) : 1
  const sy = typeof scaleLike?.y === 'number' && Number.isFinite(scaleLike.y) ? Math.abs(scaleLike.y) : 1
  const sz = typeof scaleLike?.z === 'number' && Number.isFinite(scaleLike.z) ? Math.abs(scaleLike.z) : 1
  return {
    x: sx > 0 ? sx : 1,
    y: sy > 0 ? sy : 1,
    z: sz > 0 ? sz : 1,
  }
}
